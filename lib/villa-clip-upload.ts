// 빌라 영상 업로드 클라이언트 공통 판정 (admin-villa-clip-upload).
//
// 업로드 흐름 자체(presign → R2 PUT → 커밋)는 화면마다 UI가 달라 각자 구현하지만,
// **무엇을 거절하고 오류를 어떻게 보여줄지**는 한 곳에서 정하고 테스트로 고정한다.
//
// 최종 판정은 언제나 서버다(커밋 시 HeadObject + ffprobe 실측). 여기 검사는
// "올리기 전에 뻔한 위반을 걸러 데이터·시간을 아끼는" 용도이므로 **의심스러우면 통과**시킨다
// — 브라우저가 메타데이터를 못 읽는 코덱(iOS .mov HEVC 등)에서 과잉 거절하면
// 정상 파일을 못 올리게 되고, 그건 서버가 걸러주는 위반보다 훨씬 나쁘다.

export const CLIP_ALLOWED_MIME = ["video/mp4", "video/quicktime"] as const;

/** 화면에 한국어·베트남어 문구가 준비된 오류 코드. 그 외는 generic으로 수렴시킨다. */
export const CLIP_KNOWN_ERRORS = [
  "TOO_LARGE",
  "TOO_LONG",
  "TOO_SHORT",
  "RESOLUTION_TOO_LOW",
  "QUOTA_EXCEEDED",
  "DISALLOWED_TYPE",
] as const;

export type ClipErrorKey = (typeof CLIP_KNOWN_ERRORS)[number] | "generic";

/**
 * 서버 오류코드 → 화면 문구 키.
 * ★ 서버는 UPLOAD_NOT_FOUND_OR_INVALID·INVALID_KEY·R2_NOT_CONFIGURED·ALREADY_COMMITTED 등도
 *   반환한다. 그대로 t()에 넣으면 화면에 **원시 키**가 노출된다(QA L-8과 같은 클래스의 결함).
 */
export function toClipErrorKey(code: string | null | undefined): ClipErrorKey {
  return code && (CLIP_KNOWN_ERRORS as readonly string[]).includes(code)
    ? (code as ClipErrorKey)
    : "generic";
}

export interface ClipUploadPolicy {
  maxBytes: number;
  maxDurationSec: number;
  maxPerVilla: number;
}

/** 업로드 전 로컬 판정 입력. meta는 브라우저가 읽어낸 값(못 읽으면 null). */
export interface ClipPreflightInput {
  type: string;
  size: number;
  meta?: { durationSec: number; width: number; height: number } | null;
  currentCount: number;
}

/**
 * 업로드를 시작해도 되는지 판정. 거절 사유가 있으면 코드, 없으면 null.
 *
 * 길이 판정에 **0.5초 여유**를 두는 이유: 브라우저가 읽는 duration과 서버 ffprobe 값이
 * 컨테이너 메타 차이로 소수점 단위로 어긋난다. 여유가 없으면 서버는 통과시킬 파일을
 * 화면이 먼저 막아버린다.
 */
export function preflightClipFile(
  input: ClipPreflightInput,
  policy: ClipUploadPolicy
): ClipErrorKey | null {
  if (input.currentCount >= policy.maxPerVilla) return "QUOTA_EXCEEDED";
  if (!(CLIP_ALLOWED_MIME as readonly string[]).includes(input.type)) return "DISALLOWED_TYPE";
  if (input.size > policy.maxBytes) return "TOO_LARGE";
  // 메타를 못 읽었으면 여기서 판정하지 않는다 — 서버 실측에 위임.
  if (input.meta && input.meta.durationSec > policy.maxDurationSec + 0.5) return "TOO_LONG";
  return null;
}

/** 남은 업로드 가능 개수(음수 방지). */
export function remainingClipSlots(policy: ClipUploadPolicy, currentCount: number): number {
  return Math.max(0, policy.maxPerVilla - currentCount);
}
