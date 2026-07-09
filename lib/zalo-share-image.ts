// T-villa-share-photo — 빌라 공유 대표 사진 로더 (best-effort)
//
// VillaPhoto.url(공개 사진 — 금액 정보 무관)을 발송용 Buffer로 읽는다.
// 어떤 실패든 null 반환 — 호출부(share 라우트)는 텍스트만 발송으로 폴백한다(공유 실패 금지).
//
// 보안:
//  - 디스크(/uploads/…): 파일명 화이트리스트 + 경로 탈출 차단 (app/uploads/[name]/route.ts와 동일 규칙)
//  - 원격(https): STORAGE_PUBLIC_URL(R2 공개 도메인) 프리픽스만 fetch — DB 저장값이라도 이중 가드(SSRF)
//  - 매직바이트(sniffImageMime)로 실제 이미지 바이트만 통과 — 위장 파일 발송 차단
import { promises as fs } from "fs";
import path from "path";
import { getUploadDir, sniffImageMime } from "@/lib/storage";

const SAFE_UPLOAD_NAME = /^[a-zA-Z0-9._-]+$/;

/** 공유 이미지 상한 — zca-js 대용량 발송 실패 방지 (사진은 압축 저장돼 통상 수백 KB) */
export const MAX_SHARE_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ShareImage {
  buffer: Buffer;
  fileName: string;
}

export interface LoadShareImageOptions {
  /** 테스트 주입용 — 기본 getUploadDir() */
  uploadDir?: string;
  /** 테스트 주입용 — 기본 process.env.STORAGE_PUBLIC_URL */
  publicBase?: string;
  fetchTimeoutMs?: number;
}

/**
 * VillaPhoto.url → 발송용 이미지. 실패(미존재·비이미지·초과 크기·허용 밖 출처)는 전부 null.
 */
export async function loadVillaShareImage(
  url: string,
  opts: LoadShareImageOptions = {}
): Promise<ShareImage | null> {
  try {
    let buffer: Buffer;
    let fileName: string;

    if (url.startsWith("/uploads/")) {
      const name = url.slice("/uploads/".length);
      if (!SAFE_UPLOAD_NAME.test(name) || name.includes("..")) return null;
      buffer = await fs.readFile(path.join(opts.uploadDir ?? getUploadDir(), name));
      fileName = name;
    } else if (/^https:\/\//i.test(url)) {
      const base = (opts.publicBase ?? process.env.STORAGE_PUBLIC_URL ?? "").replace(/\/$/, "");
      if (!base || !url.startsWith(`${base}/`)) return null;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(opts.fetchTimeoutMs ?? 10_000),
      });
      if (!res.ok) return null;
      buffer = Buffer.from(await res.arrayBuffer());
      const tail = url.slice(base.length + 1).split(/[?#]/)[0];
      fileName = SAFE_UPLOAD_NAME.test(tail) && tail.length > 0 ? tail : "villa.jpg";
    } else {
      return null;
    }

    if (buffer.length === 0 || buffer.length > MAX_SHARE_IMAGE_BYTES) return null;
    if (!sniffImageMime(buffer)) return null;
    return { buffer, fileName };
  } catch {
    return null;
  }
}
