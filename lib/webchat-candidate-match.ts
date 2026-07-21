// 웹챗 세션 ↔ 예약 후보 매칭 순수 함수 (T-webchat-backlog-cleanup)
//
// booking-candidates 라우트와 inbox 라우트가 동일 로직을 인라인 복제하던 것을 단일 원천으로 추출.
// ★순수 함수만 — 로직·임계값(8자 tail·6자 prefix) 변경 금지(동작 100% 불변).

/**
 * 전화 꼬리 매칭 — 정규화 숫자의 마지막 8자리 비교(국가코드/선행0 차이 흡수, 예: 84901234567 ↔ 0901234567).
 * 8자리 미만이면 완전 일치만 인정(오매칭 방지). 운영자가 다이얼로그로 최종 확인하므로 보수적 근사 허용.
 * (원본: booking-candidates/route.ts phoneTailMatch)
 */
export function phoneTailMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const tail = (s: string) => (s.length >= 8 ? s.slice(-8) : s);
  const ta = tail(a);
  const tb = tail(b);
  if (ta.length < 8 || tb.length < 8) return a === b;
  return ta === tb;
}

/**
 * sourcePage `g:<prefix>`에서 토큰 prefix 추출 — 6자 이상만 식별에 사용(그 미만·비-g·null은 null).
 * (원본: inbox/route.ts tokenPrefixOf. booking-candidates도 동일한 `prefix.length >= 6` 가드를 사용했음)
 */
export function tokenPrefixOf(sourcePage: string | null): string | null {
  const m = /^g:(.+)$/.exec(sourcePage ?? "");
  const prefix = m?.[1]?.trim() ?? "";
  return prefix.length >= 6 ? prefix : null;
}
