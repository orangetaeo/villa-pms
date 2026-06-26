// 클라이언트 이미지 워터마크 — 빌라 마케팅 사진 도용 방지 (브라우저 canvas 전용)
// 업로드 직전 resizeImage() 다음 단계로 호출해, 저장되는 파일 바이트에 워터마크를 굽는다.
//   const resized = await resizeImage(file);
//   const stamped = await watermarkImage(resized);   // 이걸 업로드
// 공개 제안 페이지에서 원본 URL을 직접 받아도 워터마크가 박힌 이미지만 얻게 된다.
//
// 적용 범위: 빌라 마케팅 사진만(step-photos·photo-manager). 체크인/아웃·청소·여권 등
// 증빙 사진은 원본 무결성이 중요하므로 호출하지 않는다.
//
// 디자인: 대각선 반복 "Villa Go" 타일 — 한쪽 모서리만 자르는 식으로 제거 불가.
// 저투명도(기본 0.16) + 흰 글자 + 얇은 어두운 외곽선으로 밝은/어두운 사진 모두에서 읽히되,
// 판매용 사진의 매력은 최대한 보존한다.

const DEFAULT_TEXT = "Villa Go";
const DEFAULT_OPACITY = 0.16;
const JPEG_QUALITY = 0.85;

export interface WatermarkOptions {
  /** 반복할 문구 (기본 "Villa Go") */
  text?: string;
  /** 워터마크 불투명도 0~1 (기본 0.16 — 은은하게) */
  opacity?: number;
}

/**
 * Blob/File 이미지에 대각선 반복 워터마크를 굽어 JPEG Blob으로 반환.
 * 디코딩 실패 시 원본을 그대로 반환(업로드 자체는 막지 않음 — graceful degrade).
 */
export async function watermarkImage(
  input: Blob,
  opts: WatermarkOptions = {}
): Promise<Blob> {
  const text = opts.text ?? DEFAULT_TEXT;
  const opacity = opts.opacity ?? DEFAULT_OPACITY;

  let bitmap: ImageBitmap;
  try {
    // EXIF 회전 반영(모바일 촬영). resizeImage가 이미 처리했어도 원본 통과분 대비.
    bitmap = await createImageBitmap(input, { imageOrientation: "from-image" });
  } catch {
    return input;
  }

  const { width, height } = bitmap;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return input;
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // 폰트 크기·타일 간격을 이미지 크기에 비례시켜 해상도와 무관하게 일정한 밀도 유지.
  const diag = Math.hypot(width, height);
  const fontSize = Math.max(14, Math.round(diag / 28));
  const stepX = fontSize * 9;
  const stepY = fontSize * 5;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = `700 ${fontSize}px "Be Vietnam Pro", "Noto Sans KR", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = Math.max(1, fontSize / 16);

  // 캔버스 중심을 기준으로 -28° 회전 후, 회전 평면을 넉넉히 덮도록 격자 반복.
  ctx.translate(width / 2, height / 2);
  ctx.rotate((-28 * Math.PI) / 180);
  const reach = Math.ceil(diag / 2) + Math.max(stepX, stepY);
  for (let y = -reach; y <= reach; y += stepY) {
    // 행마다 절반씩 어긋난 벽돌(brick) 배치 — 규칙적 빈틈 방지
    const offset = (Math.round(y / stepY) % 2) * (stepX / 2);
    for (let x = -reach; x <= reach; x += stepX) {
      ctx.strokeText(text, x + offset, y);
      ctx.fillText(text, x + offset, y);
    }
  }
  ctx.restore();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  return blob ?? input;
}
