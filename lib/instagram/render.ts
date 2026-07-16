// lib/instagram/render.ts — 캐러셀 이미지 렌더 파이프라인 (sharp + satori)
//
// 파이프라인(기획 §3-2):
//   VillaPhoto 원본(R2/디스크) → sharp 1080×1350(4:5) cover-crop
//   → satori 오버레이(한글 텍스트=path 변환) → sharp로 SVG 래스터화(알파)
//   → sharp composite 합성 → JPEG(품질 85) → R2 instagram-renders/ 공개 업로드.
// CTA 슬라이드는 사진 없이 satori 불투명 카드를 바로 JPEG 래스터화.
//
// 폰트: assets/fonts/ 의 NanumMyeongjo(감성 헤드라인 세리프)·NanumGothic(정보 고딕) TTF를 Buffer로 로드.
//   satori는 텍스트를 path로 변환하므로 래스터화(sharp)엔 폰트 불필요 — 한글 글리프는 이 폰트들에 포함(확인됨).
import { readFileSync } from "fs";
import path from "path";
import satori from "satori";
import sharp from "sharp";
import { saveInstagramRender } from "@/lib/storage";
import {
  coverTemplate,
  infoTemplate,
  serviceTemplate,
  ctaTemplate,
  FONT_SANS,
  FONT_SERIF,
  CANVAS,
  type SatoriNode,
  type TemplateId,
  type CoverData,
  type InfoData,
  type ServiceData,
  type CtaData,
} from "@/lib/instagram/templates";
import { reelCover916, reelCta916, REEL_CANVAS } from "@/lib/instagram/reel-templates";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const JPEG_QUALITY = 85;

// ── 폰트 로드 (프로세스 캐시) ──
type FontSpec = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };
let _fonts: FontSpec[] | null = null;
function loadFonts(): FontSpec[] {
  if (_fonts) return _fonts;
  _fonts = [
    { name: FONT_SERIF, data: readFileSync(path.join(FONT_DIR, "NanumMyeongjo-Regular.ttf")), weight: 400, style: "normal" },
    { name: FONT_SERIF, data: readFileSync(path.join(FONT_DIR, "NanumMyeongjo-Bold.ttf")), weight: 700, style: "normal" },
    { name: FONT_SANS, data: readFileSync(path.join(FONT_DIR, "NanumGothic-Regular.ttf")), weight: 400, style: "normal" },
    { name: FONT_SANS, data: readFileSync(path.join(FONT_DIR, "NanumGothic-Bold.ttf")), weight: 700, style: "normal" },
    // 글리프 폴백 — Nanum 폰트에 없는 베트남어 라틴 확장(Phú Quốc의 ú·ố 등)을 NotoSans가 채운다.
    // satori는 지정 fontFamily에 없는 글자를 fonts 배열의 다른 폰트에서 글자 단위로 폴백한다.
    { name: "Noto", data: readFileSync(path.join(FONT_DIR, "NotoSans-Regular.ttf")), weight: 400, style: "normal" },
    { name: "Noto", data: readFileSync(path.join(FONT_DIR, "NotoSans-Bold.ttf")), weight: 700, style: "normal" },
  ];
  return _fonts;
}

/**
 * satori 노드 → SVG 문자열. 기본 캔버스는 1080×1350(캐러셀), 릴스(9:16)는 width/height를 넘겨 오버라이드.
 * satori 타입은 ReactNode를 기대하므로 unknown 캐스팅.
 */
async function nodeToSvg(
  node: SatoriNode,
  width: number = CANVAS.width,
  height: number = CANVAS.height
): Promise<string> {
  return satori(node as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: loadFonts(),
  });
}

/** 원본 사진 바이트 확보 — http(s)는 fetch, 그 외(/uploads/ 등 상대·로컬)는 디스크에서 읽는다. */
async function fetchPhotoBuffer(url: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`사진 fetch 실패 HTTP ${res.status}: ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }
  // 디스크 폴백: /uploads/<key> → UPLOAD_DIR/<key>
  const rel = url.replace(/^\/uploads\//, "");
  const base = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "public", "uploads");
  return readFileSync(path.join(base, rel));
}

/** 사진을 1080×1350 cover-crop한 JPEG 베이스 버퍼로. EXIF 회전 자동 반영. */
async function toBaseCanvas(photoBuffer: Buffer): Promise<Buffer> {
  return sharp(photoBuffer)
    .rotate() // EXIF orientation
    .resize(CANVAS.width, CANVAS.height, { fit: "cover", position: "attention" })
    .toBuffer();
}

/** satori 오버레이(투명 배경) SVG → 알파 PNG. */
async function overlayToPng(node: SatoriNode): Promise<Buffer> {
  const svg = await nodeToSvg(node);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** 베이스 사진 위에 오버레이 합성 → JPEG. */
async function compositeToJpeg(photoBuffer: Buffer, overlay: SatoriNode): Promise<Buffer> {
  const [base, overlayPng] = await Promise.all([toBaseCanvas(photoBuffer), overlayToPng(overlay)]);
  return sharp(base)
    .composite([{ input: overlayPng, top: 0, left: 0 }])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** 불투명 카드(CTA) satori → JPEG(합성 없음). */
async function cardToJpeg(node: SatoriNode): Promise<Buffer> {
  const svg = await nodeToSvg(node);
  return sharp(Buffer.from(svg))
    .flatten({ background: "#0F766E" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

// ── 슬라이드 입력 (유니온) ──
export type SlideInput =
  | { templateId: "cover"; srcPhotoId: string; srcPhotoUrl: string; data: CoverData }
  | { templateId: "info"; srcPhotoId: string; srcPhotoUrl: string; data: InfoData }
  | { templateId: "service"; srcPhotoId: string; srcPhotoUrl: string; data: ServiceData }
  | { templateId: "raw"; srcPhotoId: string; srcPhotoUrl: string } // 오버레이 없는 원본(중간 사진)
  | { templateId: "cta"; data: CtaData };

/** mediaJson 원소(InstagramPost.mediaJson) — [{srcPhotoId, renderedUrl, templateId, overlayText}] */
export interface RenderedSlide {
  srcPhotoId: string | null;
  renderedUrl: string;
  templateId: TemplateId | "raw";
  overlayText: string | null;
}

function overlayNodeFor(input: SlideInput): SatoriNode | null {
  switch (input.templateId) {
    case "cover":
      return coverTemplate(input.data);
    case "info":
      return infoTemplate(input.data);
    case "service":
      return serviceTemplate(input.data);
    default:
      return null;
  }
}

function overlayTextFor(input: SlideInput): string | null {
  switch (input.templateId) {
    case "cover":
      return input.data.headline;
    case "info":
      return input.data.facts.join(" · ");
    case "service":
      return input.data.label;
    case "cta":
      return input.data.headline;
    default:
      return null;
  }
}

/**
 * 슬라이드 1장 렌더 → R2 업로드 → mediaJson 원소 반환.
 * @param baseName 파일명 접두(예: `${postSlotKey}-${idx}`)
 */
export async function renderSlide(input: SlideInput, baseName: string): Promise<RenderedSlide> {
  let jpeg: Buffer;
  let srcPhotoId: string | null = null;

  if (input.templateId === "cta") {
    jpeg = await cardToJpeg(ctaTemplate(input.data));
  } else {
    srcPhotoId = input.srcPhotoId;
    const photo = await fetchPhotoBuffer(input.srcPhotoUrl);
    const overlay = overlayNodeFor(input);
    jpeg = overlay ? await compositeToJpeg(photo, overlay) : await toBaseCanvasJpeg(photo);
  }

  const { url } = await saveInstagramRender(jpeg, baseName);
  return {
    srcPhotoId,
    renderedUrl: url,
    templateId: input.templateId,
    overlayText: overlayTextFor(input),
  };
}

/** 오버레이 없는 원본 슬라이드(중간 사진) — 크롭만 하고 JPEG. */
async function toBaseCanvasJpeg(photoBuffer: Buffer): Promise<Buffer> {
  return sharp(await toBaseCanvas(photoBuffer))
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** 캐러셀 전체 렌더 — 슬라이드 순서대로. 개별 실패는 throw(호출부가 FAILED 처리). */
export async function renderCarousel(slides: SlideInput[], baseName: string): Promise<RenderedSlide[]> {
  const out: RenderedSlide[] = [];
  for (let i = 0; i < slides.length; i++) {
    out.push(await renderSlide(slides[i], `${baseName}-${i}`));
  }
  return out;
}

// ═════════════════════ 릴스(9:16, 1080×1920) 프레임 렌더 — additive (P2) ═════════════════════
// P1 캐러셀 경로(renderSlide/renderCarousel)는 전혀 손대지 않는다. 릴스는 캔버스가 1080×1920이라
// 별도 크롭·오버레이·래스터화 경로를 둔다. 산출은 **R2 업로드 없이 JPEG 버퍼 배열** — ffmpeg가
// 로컬에서 소비하고 최종 MP4만 업로드하기 때문(프레임을 개별 업로드하면 R2 낭비).

/** 사진을 1080×1920 cover-crop한 JPEG 베이스 버퍼(EXIF 회전 반영). */
async function toReelBaseCanvas(photoBuffer: Buffer): Promise<Buffer> {
  return sharp(photoBuffer)
    .rotate()
    .resize(REEL_CANVAS.width, REEL_CANVAS.height, { fit: "cover", position: "attention" })
    .toBuffer();
}

/** 릴스 오버레이(투명 배경, 1080×1920) satori → 알파 PNG. */
async function reelOverlayToPng(node: SatoriNode): Promise<Buffer> {
  const svg = await nodeToSvg(node, REEL_CANVAS.width, REEL_CANVAS.height);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** 1080×1920 베이스 사진 위에 릴스 오버레이 합성 → JPEG. */
async function compositeReelJpeg(photoBuffer: Buffer, overlay: SatoriNode): Promise<Buffer> {
  const [base, overlayPng] = await Promise.all([toReelBaseCanvas(photoBuffer), reelOverlayToPng(overlay)]);
  return sharp(base)
    .composite([{ input: overlayPng, top: 0, left: 0 }])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** 오버레이 없는 릴스 사진 프레임 → JPEG(크롭만). */
async function toReelBaseJpeg(photoBuffer: Buffer): Promise<Buffer> {
  return sharp(await toReelBaseCanvas(photoBuffer))
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** 릴스 엔딩 CTA(불투명 teal 카드, 1080×1920) satori → JPEG(합성 없음). */
async function reelCardJpeg(node: SatoriNode): Promise<Buffer> {
  const svg = await nodeToSvg(node, REEL_CANVAS.width, REEL_CANVAS.height);
  return sharp(Buffer.from(svg))
    .flatten({ background: "#0F766E" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/**
 * 릴스 프레임 1장을 1080×1920 JPEG 버퍼로 렌더(업로드 없음).
 *   cover → 사진 + 감성 오버레이 / cta → teal 카드 / info·service·raw → 사진 원본(오버레이 없음).
 */
export async function renderReelFrameBuffer(input: SlideInput): Promise<Buffer> {
  if (input.templateId === "cta") {
    return reelCardJpeg(reelCta916(input.data));
  }
  const photo = await fetchPhotoBuffer(input.srcPhotoUrl);
  if (input.templateId === "cover") {
    return compositeReelJpeg(photo, reelCover916(input.data));
  }
  // info·service·raw: 릴스는 사진 몰입 우선이라 중간 프레임은 오버레이 없이 원본 크롭.
  return toReelBaseJpeg(photo);
}

/** 릴스 슬라이드 배열 → 1080×1920 JPEG 버퍼 배열(순서 유지). ffmpeg 입력용. */
export async function renderReelFrameBuffers(slides: SlideInput[]): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const s of slides) {
    out.push(await renderReelFrameBuffer(s));
  }
  return out;
}

// 테스트/스모크 전용 — 업로드 없이 JPEG 버퍼만 반환.
export const __renderInternals = { compositeToJpeg, cardToJpeg, toBaseCanvasJpeg, nodeToSvg, toReelBaseJpeg, reelCardJpeg };
