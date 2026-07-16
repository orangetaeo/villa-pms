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

export type AllowedImageMime = keyof typeof MIME_EXT;

// HEIC/HEIF(ISO-BMFF) major/compatible brand 집합. heic 계열·heif 계열 모두 허용 이미지.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
const HEIF_BRANDS = new Set(["mif1", "mif2", "msf1", "heif"]);

/**
 * 매직바이트(파일 시그니처)로 **실제** 이미지 포맷을 판별 (보안 P3-S1, 방어심화).
 * 클라이언트가 선언한 Content-Type을 신뢰하지 않는다 — SVG/HTML/실행파일을 image/*로 위장해도
 * 실제 바이트가 허용 이미지(jpeg·png·webp·heic·heif)가 아니면 null을 반환한다.
 * @returns 감지된 허용 MIME, 또는 허용 이미지가 아니면 null.
 */
export function sniffImageMime(buffer: Buffer): AllowedImageMime | null {
  if (buffer.length < 12) return null; // 시그니처 판별 최소 길이 미만

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  // HEIC/HEIF (ISO-BMFF): [size4] "ftyp" [major_brand4] [minor4] [compatible_brands4*]
  // major brand(8-12)뿐 아니라 compatible brands(16~box끝)도 스캔 — 일부 기기는 major가
  // 시퀀스 brand이고 heic/mif1이 compatible에만 있어 가용성 false-reject 방지.
  if (buffer.toString("ascii", 4, 8) === "ftyp") {
    const boxSize = buffer.readUInt32BE(0);
    const end = Math.min(buffer.length, boxSize > 0 ? boxSize : buffer.length, 64);
    // 8(major)부터 4바이트씩, minor(12-16)는 brand가 아니나 Set에 없어 자연히 무시됨
    for (let off = 8; off + 4 <= end; off += 4) {
      if (off === 12) continue; // minor_version 스킵
      const brand = buffer.toString("ascii", off, off + 4).toLowerCase();
      if (HEIC_BRANDS.has(brand)) return "image/heic";
      if (HEIF_BRANDS.has(brand)) return "image/heif";
    }
  }
  return null;
}

/**
 * 업로드 buffer가 허용 이미지의 실제 바이트인지 강제 — 아니면 throw (저장 전 게이트).
 * declared MIME(클라 선언)은 화이트리스트로 이미 걸렀고, 여기선 실제 바이트로 한 번 더 막는다.
 * 허용 포맷 간 불일치(예: jpeg 선언·png 바이트)는 무해하므로 통과시키되, 허용 이미지가
 * 전혀 아니면(SVG/HTML/실행파일/손상) 거부한다.
 */
function assertImageBytes(buffer: Buffer): void {
  if (sniffImageMime(buffer) === null) {
    throw new Error("INVALID_IMAGE_BYTES");
  }
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
  assertImageBytes(buffer); // P3-S1 — 실제 바이트가 허용 이미지인지(위장 차단)
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

// ===================== 인스타그램 렌더 산출물 — 공개 이미지 (instagram-marketing-p1) =====================
// 합성된 JPEG 캐러셀 이미지를 공개 URL로 저장한다. Instagram Graph API 발행은 **공개 접근 URL 필수**
// (image_url을 Meta 서버가 직접 fetch). 빌라 사진과 동일한 공개 R2 버킷/도메인을 재사용하되,
// prefix `instagram-renders/`로 구분(수명·정리 정책 분리 가능). saveFile과 달리 이미 서버에서 합성한
// JPEG이므로 uploaderId·매직바이트 검사 파이프라인이 아니라 결정형 저장만 수행.
//
// ⚠ 공개 URL 형태:
//   - R2 모드(STORAGE_* 설정): `${publicUrl}/instagram-renders/<name>.jpg` = 절대 공개 URL(Meta fetch 가능).
//   - 디스크 폴백: `/uploads/instagram-renders/<name>.jpg` = 상대 경로 → 발행 클라이언트가 앱 origin으로
//     절대화해야 Meta가 접근 가능(publish.ts toAbsoluteMediaUrl 참조). 프로덕션은 R2 경로가 정본.
const INSTAGRAM_RENDER_PREFIX = "instagram-renders";

/**
 * 인스타그램 렌더 JPEG 저장 → 공개 URL 반환.
 * @param buffer 합성 완료된 JPEG 바이트
 * @param baseName 파일명 접두(예: 포스트id-슬롯index) — 영숫자·하이픈만 유지
 * @returns url(공개 or 상대 URL), key(버킷/디스크 키)
 */
export async function saveInstagramRender(
  buffer: Buffer,
  baseName: string
): Promise<{ url: string; key: string }> {
  const safeBase = baseName.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || "render";
  const fileName = `${safeBase}-${Date.now()}-${randomUUID()}.jpg`;
  const key = `${INSTAGRAM_RENDER_PREFIX}/${fileName}`;
  const r2 = getR2Config();

  if (r2) {
    await getR2Client(r2).send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return { url: `${r2.publicUrl}/${key}`, key };
  }

  const dir = path.join(UPLOAD_DIR, INSTAGRAM_RENDER_PREFIX);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buffer);
  return { url: `/uploads/${key}`, key };
}

// ── 인스타그램 릴스 MP4 — 공개 동영상 (instagram-marketing-p2) ──
// saveInstagramRender와 동일 원칙(Meta가 video_url을 직접 fetch → 공개 절대 URL 필수). prefix
// `instagram-reels/`로 구분(수명·정리 정책 분리). ContentType=video/mp4. R2 없으면 디스크 폴백(상대 URL).
const INSTAGRAM_REEL_PREFIX = "instagram-reels";

/**
 * 인스타그램 릴스 MP4 저장 → 공개 URL 반환.
 * @param buffer H.264/AAC MP4 바이트(lib/instagram/reels.ts buildReelVideo 산출)
 * @param baseName 파일명 접두(예: 포스트id-슬롯) — 영숫자·하이픈만 유지
 * @returns url(공개 or 상대 URL), key
 */
export async function saveInstagramVideo(
  buffer: Buffer,
  baseName: string
): Promise<{ url: string; key: string }> {
  const safeBase = baseName.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || "reel";
  const fileName = `${safeBase}-${Date.now()}-${randomUUID()}.mp4`;
  const key = `${INSTAGRAM_REEL_PREFIX}/${fileName}`;
  const r2 = getR2Config();

  if (r2) {
    await getR2Client(r2).send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: buffer,
        ContentType: "video/mp4",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return { url: `${r2.publicUrl}/${key}`, key };
  }

  const dir = path.join(UPLOAD_DIR, INSTAGRAM_REEL_PREFIX);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buffer);
  return { url: `/uploads/${key}`, key };
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
  assertImageBytes(buffer); // P3-S1 — 여권·서명도 실제 이미지 바이트만(위장 차단)
  const dir = getPassportDirInternal();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buffer);
  return { fileName };
}

export const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime])
);

// ===================== 파트너 청구서 PDF — 비공개 저장 (PARTNER-3b-UI) =====================
// 정산서(P2-4)와 동일 원칙: 항상 디스크(volume), 공개 URL 미생성. 서빙은 게이트 라우트 전용
// (ADMIN canViewFinance). 청구서엔 객실료 잔금이 있어 공개 버킷 금지.
// 파일명은 청구서ID 결정형 → 재생성 시 동일 파일 덮어쓰기(statementUrl 안정).

function getInvoiceDirInternal(): string {
  const base = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "private");
  return path.join(base, "partner-invoices");
}

/** 청구서 서빙 라우트용 디렉터리 */
export function getInvoiceDir(): string {
  return getInvoiceDirInternal();
}

/** 청구서ID 기반 결정형 파일명 — 영숫자만(경로 주입 차단) */
export function invoiceFileName(invoiceId: string): string {
  const safe = invoiceId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `invoice-${safe}.pdf`;
}

/**
 * 청구서 PDF 저장 — 항상 디스크, 결정형 파일명(재생성 덮어쓰기). 공개 URL 미생성.
 * @returns fileName (PartnerInvoice.statementUrl에 보관, 서빙 라우트가 dir+fileName로 읽음)
 */
export async function saveInvoiceFile(
  buffer: Buffer,
  invoiceId: string
): Promise<{ fileName: string }> {
  const fileName = invoiceFileName(invoiceId);
  const dir = getInvoiceDirInternal();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buffer);
  return { fileName };
}

// ===================== 월 정산서 PDF — 비공개 저장 (P2-4) =====================
// 여권과 동일 원칙: 항상 디스크(volume), 공개 URL 미생성. 서빙은 게이트 라우트 전용
// (ADMIN 또는 그 정산의 소유 공급자). 정산서엔 공급자 원가가 있어 공개 버킷 금지.
// 파일명은 정산ID 결정형 → 재생성 시 동일 파일 덮어쓰기(statementUrl 안정).

function getStatementDirInternal(): string {
  // QA M1과 동일: UPLOAD_DIR 미설정 시 public 밖 private/로 (정적 서빙 우회 차단)
  const base = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "private");
  return path.join(base, "statements");
}

/** 정산서 서빙 라우트용 디렉터리 */
export function getStatementDir(): string {
  return getStatementDirInternal();
}

/** 정산ID 기반 결정형 파일명 — 영숫자만(경로 주입 차단) */
export function statementFileName(settlementId: string): string {
  const safe = settlementId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `statement-${safe}.pdf`;
}

/**
 * 정산서 PDF 저장 — 항상 디스크, 결정형 파일명(재생성 덮어쓰기). 공개 URL 미생성.
 * @returns fileName (Settlement.statementUrl에 보관, 서빙 라우트가 dir+fileName로 읽음)
 */
export async function saveStatementFile(
  buffer: Buffer,
  settlementId: string
): Promise<{ fileName: string }> {
  const fileName = statementFileName(settlementId);
  const dir = getStatementDirInternal();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buffer);
  return { fileName };
}

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
