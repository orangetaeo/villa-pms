// 클라이언트 이미지 리사이즈 — 업로드 전 긴 변 기준 축소 + JPEG 재인코딩 (T0.4)
// 브라우저 전용 (canvas). 마법사 사진 단계 등 업로드 UI에서 사용:
//   const blob = await resizeImage(file);
//   formData.append("file", blob, file.name);

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.82;
const SKIP_BELOW_BYTES = 300 * 1024; // 300KB 미만은 원본 그대로

/**
 * 이미지 파일을 긴 변 maxEdge 이하로 축소해 JPEG Blob으로 반환.
 * 디코딩 실패(HEIC 미지원 브라우저 등) 시 원본 File을 그대로 반환 — 서버가 원본 포맷 수용.
 */
export async function resizeImage(
  file: File,
  maxEdge: number = DEFAULT_MAX_EDGE,
  quality: number = DEFAULT_QUALITY
): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;

  let bitmap: ImageBitmap;
  try {
    // imageOrientation: EXIF 회전 자동 반영 (모바일 촬영 사진)
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  const { width, height } = bitmap;
  const longEdge = Math.max(width, height);

  // 충분히 작으면 재인코딩 생략 (품질 손실 방지)
  if (longEdge <= maxEdge && file.size < SKIP_BELOW_BYTES) {
    bitmap.close();
    return file;
  }

  const scale = Math.min(1, maxEdge / longEdge);
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  return blob ?? file;
}
