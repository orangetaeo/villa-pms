// 취소·환불 정책 — 전 빌라 공용 단일 정책 (#6b). AppSetting JSON 1키로 저장(스키마 무변경).
// 고정 3단계: 체크인 N일 전까지 100% / M일 전까지 P% / 그 이후 환불 불가. 숫자만 가변.
// 순수 모듈 — prisma/next-intl 의존 없음(validators·테스트 공유). DB 읽기는 호출측에서 수행.

export const CANCELLATION_POLICY_KEY = "CANCELLATION_POLICY";

export interface CancellationPolicy {
  /** 체크인 이 일수 이전 취소 → 100% 환불 */
  fullDays: number;
  /** 체크인 이 일수 이전 취소 → partialPct% 환불 (fullDays 미만이어야) */
  partialDays: number;
  /** 부분 환불율 0~100 */
  partialPct: number;
  /** 공개 페이지 표시 여부 — false면 미노출 */
  enabled: boolean;
}

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  fullDays: 30,
  partialDays: 14,
  partialPct: 50,
  enabled: true,
};

/** 정합성: fullDays > partialDays ≥ 0, 0 ≤ partialPct ≤ 100, 정수, enabled bool */
export function isValidCancellationPolicy(p: unknown): p is CancellationPolicy {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  if (typeof o.enabled !== "boolean") return false;
  const { fullDays, partialDays, partialPct } = o;
  if (![fullDays, partialDays, partialPct].every((n) => Number.isInteger(n))) return false;
  const f = fullDays as number;
  const d = partialDays as number;
  const pct = partialPct as number;
  return f > d && d >= 0 && pct >= 0 && pct <= 100;
}

/** AppSetting 문자열 → 정책. 미설정·손상 시 기본값 폴백(공개 표시가 깨지지 않게). */
export function parseCancellationPolicy(value: string | null | undefined): CancellationPolicy {
  if (!value) return DEFAULT_CANCELLATION_POLICY;
  try {
    const parsed = JSON.parse(value);
    if (isValidCancellationPolicy(parsed)) {
      return {
        fullDays: parsed.fullDays,
        partialDays: parsed.partialDays,
        partialPct: parsed.partialPct,
        enabled: parsed.enabled,
      };
    }
  } catch {
    // 손상 JSON — 기본값
  }
  return DEFAULT_CANCELLATION_POLICY;
}

/** 폼/입력 → 검증된 정책 JSON 문자열. 부적합하면 null(저장 거부). */
export function serializeCancellationPolicy(p: unknown): string | null {
  if (!isValidCancellationPolicy(p)) return null;
  const { fullDays, partialDays, partialPct, enabled } = p;
  return JSON.stringify({ fullDays, partialDays, partialPct, enabled });
}

export type CancellationTierKind = "full" | "partial" | "none";

/** 표시용 구조 3단계 — 라벨 문구는 표시측(ko 공개페이지 / i18n 설정폼)에서 생성 */
export function cancellationTiers(
  p: CancellationPolicy
): { kind: CancellationTierKind; days: number; pct: number }[] {
  return [
    { kind: "full", days: p.fullDays, pct: 100 },
    { kind: "partial", days: p.partialDays, pct: p.partialPct },
    { kind: "none", days: p.partialDays, pct: 0 },
  ];
}
