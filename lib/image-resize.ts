// 클라이언트 이미지 리사이즈 — 업로드 전 긴 변 기준 축소 + JPEG 재인코딩 (T0.4)
// 브라우저 전용 (canvas). 마법사 사진 단계 등 업로드 UI에서 사용:
//   const blob = await resizeImage(file);
//   formData.append("file", blob, file.name);

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.82;
const SKIP_BELOW_BYTES = 300 * 1024; // 300KB 미만은 원본 그대로

// 증빙(여권·종이서류) 고품질 프리셋 — 신원·서류 가독성 필수(여권번호·MRZ·서명·도장).
// 일반 1600/0.82는 과압축 위험. 2400px/0.90은 통상 1~3MB로 5MB 상한 이내(img-compress-coverage 계약 §2-1).
// ⚠ additive 상수 — resizeImage 시그니처·기본값·로직은 무변경(기존 7개 호출처 회귀 방지).
export const EVIDENCE_MAX_EDGE = 2400;
export const EVIDENCE_QUALITY = 0.9;
export const EVIDENCE_PRESET = { maxEdge: EVIDENCE_MAX_EDGE, quality: EVIDENCE_QUALITY } as const;

// 브라우저·서버·관리인 뷰어가 못 여는 포맷 — resizeImage가 디코딩에 실패하면 원본을 그대로 반환하므로
// HEIC/HEIF가 그대로 남는다(아이폰 기본 포맷). 이 경우 silent 저장 금지(못 여는 증빙 사고 차단).
const UNVIEWABLE_EVIDENCE_TYPES = new Set(["image/heic", "image/heif"]);

/**
 * 증빙(여권·종이서류) 업로드 거부 여부 — resizeImage 출력 Blob을 검사.
 * 거부(=재촬영 안내) 조건: ① 변환 실패로 HEIC/HEIF가 남음 ② 이미지가 아님(type 누락 등) ③ maxBytes 초과.
 * JPEG는 물론 PNG/WebP(소형 원본 스킵 케이스)도 뷰어가 지원하므로 통과시킨다.
 * 컴포넌트·테스트가 이 단일 함수를 공유한다(판정 규칙 동기화).
 */
export function isUnprocessableEvidenceBlob(blob: { type: string; size: number }, maxBytes: number): boolean {
  if (UNVIEWABLE_EVIDENCE_TYPES.has(blob.type)) return true; // HEIC 디코딩 실패 폴백
  if (!blob.type.startsWith("image/")) return true; // type 미설정 등 — 뷰어 보장 불가
  if (blob.size > maxBytes) return true; // 리사이즈 후에도 상한 초과
  return false;
}

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
