// 이미지 저장소 — Cloudflare R2 (기본) / 로컬 디스크 폴백 (T0.4, ADR-0004)
// 백엔드 자동 선택: STORAGE_* 환경변수가 모두 설정되면 R2, 아니면 디스크.
// 디스크 모드: 기본 ./public/uploads (next 정적 서빙) 또는 UPLOAD_DIR(Railway volume,
//             app/uploads/[name]/route.ts가 서빙) — URL 형태는 두 모드 모두 /uploads/<파일명>
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// 기본: ./public/uploads → next가 /uploads/<파일명>으로 정적 서빙
// Railway volume 사용 시 UPLOAD_DIR을 volume 마운트 경로로 지정
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "public", "uploads");

// 허용 MIME 화이트리스트 — 여기 없는 타입은 업로드 거부 (QA M1: image/svg 위장 → stored XSS 차단)
// svg(스크립트 실행 가능)·gif는 의도적으로 제외 — 빌라 사진은 카메라 촬영물만
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** 업로드 허용 MIME 여부 — route handler에서 저장 전 검사용 */
export function isAllowedImageMime(mimeType: string): boolean {
  return mimeType in MIME_EXT;
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string; // 끝 슬래시 없는 공개 도메인 (예: https://pub-xxx.r2.dev)
}

function getR2Config(): R2Config | null {
  const {
    STORAGE_ACCOUNT_ID: accountId,
    STORAGE_ACCESS_KEY_ID: accessKeyId,
    STORAGE_SECRET_ACCESS_KEY: secretAccessKey,
    STORAGE_BUCKET_NAME: bucket,
    STORAGE_PUBLIC_URL: publicUrl,
  } = process.env;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl: publicUrl.replace(/\/$/, "") };
}

let r2Client: S3Client | null = null;

function getR2Client(config: R2Config): S3Client {
  r2Client ??= new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return r2Client;
}

function buildFileName(mimeType: string, uploaderId: string): string {
  const ext = MIME_EXT[mimeType];
  // 화이트리스트 외 MIME은 확장자 유추 없이 즉시 거부 — 클라이언트 Content-Type 신뢰 금지
  if (!ext) throw new Error(`DISALLOWED_MIME: ${mimeType}`);
  const safeUploader = uploaderId.replace(/[^a-zA-Z0-9_-]/g, "");
  // 파일명에 타임스탬프 + 업로더 기록 (증빙 목적, 수정 불가 규칙)
  return `${Date.now()}-${safeUploader}-${randomUUID()}.${ext}`;
}

/**
 * 파일 저장 — R2 설정이 있으면 R2, 없으면 로컬 디스크
 * @returns 공개 접근 URL (R2: https://…, 디스크: /uploads/…)
 */
export async function saveFile(
  buffer: Buffer,
  mimeType: string,
  uploaderId: string
): Promise<{ url: string }> {
  const fileName = buildFileName(mimeType, uploaderId);
  const r2 = getR2Config();

  if (r2) {
    await getR2Client(r2).send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: fileName,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return { url: `${r2.publicUrl}/${fileName}` };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, fileName), buffer);
  return { url: `/uploads/${fileName}` };
}

/** 디스크 모드 서빙용 — app/uploads/[name]/route.ts에서 사용 */
export function getUploadDir(): string {
  return UPLOAD_DIR;
}

// ===================== 여권 사진 — 비공개 저장 (T3.1, QA 합의 조건 A) =====================
// 공개 업로드 파이프라인(saveFile)과 의도적으로 분리:
// - R2 설정 여부와 무관하게 **항상 디스크(volume)** 의 passports/ 하위에 저장
//   (공개 버킷·CDN 비대상 — R2 전환 후에도 여권은 비공개 유지, 90일 수동 삭제 정책 대상)
// - 반환은 파일명만 — 서빙은 GET /api/passports/[name] (ADMIN 가드 + private,no-store) 전용

function getPassportDirInternal(): string {
  // QA M1: UPLOAD_DIR 미설정 시 기본값이 public/uploads라 그 하위에 두면
  // Next 정적 서빙이 ADMIN 가드를 우회한다 — 미설정이면 public/ 밖 private/로 분리
  const base = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "private");
  return path.join(base, "passports");
}

/** 여권 서빙 라우트용 디렉터리 */
export function getPassportDir(): string {
  return getPassportDirInternal();
}

/**
 * 비공개 증빙 파일 저장 — 항상 디스크, 파일명만 반환 (공개 URL 미생성).
 * prefix로 증빙 종류 구분 (T3.2 — 서명 "sig-": 여권 90일 삭제 정책과 분리,
 * 동의 증빙은 분쟁 대비 보관). prefix는 영숫자·하이픈만 허용
 */
export async function savePassportFile(
  buffer: Buffer,
  mimeType: string,
  uploaderId: string,
  prefix?: string
): Promise<{ fileName: string }> {
  const safePrefix = prefix ? prefix.replace(/[^a-zA-Z0-9-]/g, "") : "";
  const fileName = `${safePrefix}${buildFileName(mimeType, uploaderId)}`;
  const dir = getPassportDirInternal();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buffer);
  return { fileName };
}

export const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime])
);

// ===================== 일반 파일 첨부 (Zalo 채팅 파일 공유) =====================
// 이미지 파이프라인(saveFile)과 분리: 비이미지 일반 파일(문서 등) ADMIN 업로드용.
// 이미지(MIME_EXT 화이트리스트)는 기존 saveFile(photo 경로)로 보내야 하며 여기선 거부한다.

/** 일반 파일 첨부 최대 크기 — Zalo·R2 비용·악용 방지 상한 (20MB). */
export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

// 위험 확장자 블랙리스트 — 실행파일·스크립트·바로가기 등 (Nike 패턴 + 일반 화이트해커 권고).
// 업로더는 ADMIN뿐이지만 다운로드 측(상대) 보호 + 스토어 오염 방지 차원에서 차단한다.
const BLOCKED_ATTACHMENT_EXTS = new Set<string>([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "msc",
  "js", "jse", "vbs", "vbe", "ws", "wsf", "wsh", "ps1", "psm1",
  "sh", "bash", "jar", "app", "apk", "dll", "sys", "lnk", "reg",
  "hta", "msp", "gadget", "vb", "vbscript",
]);

/** 파일명에서 마지막 확장자(소문자, 점 없이) 추출. 확장자 없으면 null. */
function extractExt(fileName: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * 일반 파일 첨부 검증 — 위험 확장자·확장자 누락·이미지(별도 경로) 거부.
 * @returns ok면 정규화된 안전한 확장자, 아니면 사유 코드.
 */
export function validateAttachment(fileName: string, size: number):
  | { ok: true; ext: string }
  | { ok: false; reason: "NO_EXTENSION" | "BLOCKED_TYPE" | "IS_IMAGE" | "TOO_LARGE" } {
  if (size > MAX_ATTACHMENT_SIZE) return { ok: false, reason: "TOO_LARGE" };
  const ext = extractExt(fileName);
  if (!ext) return { ok: false, reason: "NO_EXTENSION" };
  if (BLOCKED_ATTACHMENT_EXTS.has(ext)) return { ok: false, reason: "BLOCKED_TYPE" };
  // 이미지 확장자는 photo 경로(saveFile, EXIF 회전·MIME 검사)로 가야 한다 → 여기선 거부.
  if (ext in EXT_MIME) return { ok: false, reason: "IS_IMAGE" };
  return { ok: true, ext };
}

/** 첨부 파일명 정규화 — 디렉터리·경로 제거, 안전 문자만. 확장자 보존(표시·다운로드용). */
function sanitizeAttachmentName(fileName: string, ext: string): string {
  // 경로 구분자 제거(path traversal 방지) 후 마지막 세그먼트만.
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  // 확장자 떼고 본문만 안전화 — 공백·괄호·한글 등은 보존하되 제어문자·경로문자 제거.
  const stem = base.replace(/\.[a-z0-9]+$/i, "");
  const safeStem = stem.replace(/[ -/\\:*?"<>|]/g, "").trim() || "file";
  return `${safeStem}.${ext}`;
}

/**
 * 일반 파일 첨부 저장 — R2 설정 있으면 R2, 없으면 디스크. saveFile과 동일 백엔드 선택.
 * 이미지 화이트리스트(MIME_EXT)와 무관 — validateAttachment로 사전 검증된 파일만 넘긴다.
 * 저장 키는 충돌 방지 위해 타임스탬프+업로더+uuid, 다운로드 표시명은 displayName으로 반환.
 * @returns url(공개/서빙 URL), displayName(원본 정규화 표시명)
 */
export async function saveAttachmentFile(
  buffer: Buffer,
  fileName: string,
  ext: string,
  mimeType: string,
  uploaderId: string
): Promise<{ url: string; displayName: string }> {
  const safeUploader = uploaderId.replace(/[^a-zA-Z0-9_-]/g, "");
  const storageKey = `${Date.now()}-${safeUploader}-${randomUUID()}.${ext}`;
  const displayName = sanitizeAttachmentName(fileName, ext);
  const r2 = getR2Config();

  if (r2) {
    await getR2Client(r2).send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType || "application/octet-stream",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return { url: `${r2.publicUrl}/${storageKey}`, displayName };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, storageKey), buffer);
  return { url: `/uploads/${storageKey}`, displayName };
}
