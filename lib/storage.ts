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

export const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime])
);
