// lib/seo/watermark-server.ts — 블로그·마케팅 이미지 서버 워터마크 (T-blog-visual)
//
// 왜 서버인가: 기존 워터마크(lib/watermark.ts)는 **브라우저 canvas 전용**이라 업로드 시점에만 적용되고,
// 이미 올라간 사진(메오키친 12장)에는 소급되지 않는다. 블로그에 나가는 이미지는 워터마크가 **필수**이므로
// (테오 지시 2026-07-23) 서버에서 한 번 구워 R2에 파생본을 만들고 그 URL을 본문에 쓴다.
//
// ★ 원본은 건드리지 않는다 — 파생본을 따로 만들고 SeoMedia.watermarkedUrl에 캐시한다.
//   같은 사진을 여러 글·인스타에서 재사용해도 워터마크 렌더는 한 번뿐이다.
// ★ 디자인은 클라이언트 워터마크와 동일한 규칙: 대각선 반복 타일(모서리 자르기로 제거 불가) + 저투명도.
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { saveFile } from "@/lib/storage";

const TEXT = "Villa Go";
const OPACITY = 0.16;
const JPEG_QUALITY = 86;

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;"
  );
}

/** 대각선 반복 타일 SVG — 이미지 크기에 비례해 밀도를 일정하게 유지한다. */
export function buildWatermarkSvg(width: number, height: number, text = TEXT, opacity = OPACITY): string {
  const diag = Math.hypot(width, height);
  const fontSize = Math.max(14, Math.round(diag / 28));
  const stepX = Math.round(fontSize * 9);
  const stepY = Math.round(fontSize * 5);
  const t = escapeXml(text);

  const rows: string[] = [];
  for (let y = -height; y < height * 2; y += stepY) {
    for (let x = -width; x < width * 2; x += stepX) {
      rows.push(
        `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${fontSize}" ` +
          `fill="#ffffff" fill-opacity="${opacity}" stroke="#000000" stroke-opacity="${opacity * 0.5}" ` +
          `stroke-width="${Math.max(1, fontSize / 24)}">${t}</text>`
      );
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<g transform="rotate(-30 ${width / 2} ${height / 2})">${rows.join("")}</g></svg>`
  );
}

/** 버퍼에 워터마크를 굽어 JPEG 버퍼로 반환. 실패 시 throw — 호출부가 원본 URL로 폴백한다. */
export async function watermarkBuffer(input: Buffer): Promise<Buffer> {
  const img = sharp(input, { failOn: "none" });
  const meta = await img.metadata();
  const width = meta.width ?? 1200;
  const height = meta.height ?? 800;
  const svg = Buffer.from(buildWatermarkSvg(width, height));
  return img
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/**
 * 워터마크 파생본 URL을 보장한다 — 없으면 만들어 R2에 올리고 SeoMedia에 캐시한다.
 * ★ 실패해도 throw하지 않는다: 워터마크가 없다고 글 생성을 멈추면 손해가 더 크다 →
 *   원본 URL을 돌려주고 로그만 남긴다(다음 회차에 다시 시도된다).
 */
export async function ensureWatermarkedUrl(
  media: { id: string; url: string; watermarkedUrl?: string | null },
  db: DbClient = prisma
): Promise<string> {
  if (media.watermarkedUrl) return media.watermarkedUrl;
  try {
    const res = await fetch(media.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`원본 다운로드 실패 ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const stamped = await watermarkBuffer(buf);
    const { url } = await saveFile(stamped, "image/jpeg", "system", "villa-go-wm");
    // ★ 캐시 갱신 실패가 워터마크 적용 자체를 되돌리면 안 된다 — 파일은 이미 만들어졌다.
    //   (id 없이 호출되는 경우도 있어 updateMany로 조용히 흘려보낸다. 실측 2026-07-23: id 누락으로
    //    update가 throw → catch가 원본 URL을 돌려주면서 워터마크가 통째로 무력화됐다.)
    if (media.id) {
      await db.seoMedia
        .updateMany({ where: { id: media.id }, data: { watermarkedUrl: url } })
        .catch(() => undefined);
    }
    return url;
  } catch (e) {
    console.error(`[watermark] ${media.id} 실패 — 원본 사용:`, e instanceof Error ? e.message : String(e));
    return media.url;
  }
}
