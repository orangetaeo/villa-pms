// [SHARED-MODULE] from traveldiary-mvp lib/utils/image-compress.ts
/**
 * 클라이언트 측 이미지 압축 — File → base64 data URL.
 *
 * canvas로 이미지 리사이즈(max 1280px) + JPEG 압축(quality 0.7) → DB 부담 최소화.
 * 사진 1장 ~200~400KB 범위로 정착. browser-only (window/document 의존).
 */

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.7;
const ACCEPTED_PREFIX = "image/";

export type CompressResult =
  | { ok: true; dataUrl: string; sizeBytes: number; mimeType: string }
  | { ok: false; reason: "not_image" | "load_failed" | "encode_failed" };

/**
 * File을 1280px 이하로 리사이즈 + JPEG 압축 후 base64 data URL 반환.
 *
 * 비율 보존(aspect ratio). max(width, height) > 1280 일 때만 축소.
 * GIF/SVG/animated WebP는 첫 프레임만 추출(원본 손실).
 */
export async function compressImageToDataUrl(file: File): Promise<CompressResult> {
  if (!file.type.startsWith(ACCEPTED_PREFIX)) {
    return { ok: false, reason: "not_image" };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const { canvas, mimeType } = drawScaledCanvas(img);
    const dataUrl = canvas.toDataURL(mimeType, JPEG_QUALITY);
    if (!dataUrl || dataUrl === "data:,") {
      return { ok: false, reason: "encode_failed" };
    }
    return {
      ok: true,
      dataUrl,
      sizeBytes: dataUrl.length,
      mimeType,
    };
  } catch {
    return { ok: false, reason: "load_failed" };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

function drawScaledCanvas(
  img: HTMLImageElement,
): { canvas: HTMLCanvasElement; mimeType: string } {
  const { naturalWidth: w, naturalHeight: h } = img;
  const longSide = Math.max(w, h);
  const scale = longSide > MAX_DIMENSION ? MAX_DIMENSION / longSide : 1;
  const targetW = Math.round(w * scale);
  const targetH = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");

  // PNG 투명도 보존이 아닌, JPEG로 일관 압축 (DB 부담 최소화)
  // PNG/WebP 파일이라도 결과는 JPEG. 원본 PNG의 투명 영역은 검은색으로 채워짐.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // GIF/SVG는 단일 프레임 + JPEG 강제. PNG/JPEG/WebP는 JPEG로 통일.
  return { canvas, mimeType: "image/jpeg" };
}
