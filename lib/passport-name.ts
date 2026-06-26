// lib/passport-name.ts — 비공개 증빙 파일명 업로더 매칭 (T10.5, F10 D5)
//
// storage.buildFileName 형식: `${prefix?}${Date.now()}-${safeUploader}-${randomUUID()}.${ext}`
//   - prefix: "" | "sig-" | "doc-"
//   - safeUploader: uploaderId에서 [a-zA-Z0-9_-] 외 제거 (cuid는 영숫자라 보통 원형 유지)
//   - randomUUID: 8-4-4-4-12 hex (하이픈 포함)
//
// 공급자 여권/서명 서빙 스코프(T10.5): "본인이 업로드한 파일만". 파일명에 업로더 id가 박혀 있어
//   상태 조회 없이 결정형으로 소유를 판정한다(타인 여권 도달 차단). DB 상태와 무관하게 안전.

/** storage.savePassportFile의 접두 화이트리스트와 일치해야 함 (route uploads/passport: signature→sig-, paper-doc→doc-) */
const KNOWN_PREFIXES = ["sig-", "doc-"] as const;

/** uploaderId 정규화 — storage.buildFileName의 safeUploader 규칙과 동일해야 매칭됨 */
export function normalizeUploaderId(uploaderId: string): string {
  return uploaderId.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * 파일명에서 업로더 세그먼트를 추출한다. 형식 불일치면 null.
 * `[prefix]<timestamp:digits>-<uploaderId>-<uuid>.<ext>` 에서 <uploaderId> 추출.
 *   timestamp는 선행 숫자 런, uuid는 마지막 5개 하이픈 세그먼트(8-4-4-4-12) + 확장자.
 */
export function extractUploaderId(fileName: string): string | null {
  let name = fileName;
  for (const p of KNOWN_PREFIXES) {
    if (name.startsWith(p)) {
      name = name.slice(p.length);
      break;
    }
  }

  // 선행 timestamp: 숫자 런 + 하이픈
  const tsMatch = /^(\d+)-/.exec(name);
  if (!tsMatch) return null;
  const afterTs = name.slice(tsMatch[0].length);

  // 끝: -<uuid>.<ext> — uuid는 8-4-4-4-12 hex
  const uuidExt =
    /-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.[a-zA-Z0-9]+$/;
  const m = uuidExt.exec(afterTs);
  if (!m) return null;

  const uploader = afterTs.slice(0, afterTs.length - m[0].length);
  return uploader.length > 0 ? uploader : null;
}

/** 파일이 이 업로더의 것인지 — 결정형 소유 판정(공급자 여권/서명 서빙 스코프). */
export function fileBelongsToUploader(fileName: string, uploaderId: string): boolean {
  const extracted = extractUploaderId(fileName);
  if (!extracted) return false;
  return extracted === normalizeUploaderId(uploaderId);
}
