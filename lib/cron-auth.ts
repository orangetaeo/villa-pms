import { timingSafeEqual } from "node:crypto";

/**
 * cron 라우트 공용 인증 헬퍼 (보안 — 타이밍 세이프 Bearer 검증)
 *
 * 기존 각 cron 라우트가 `header !== \`Bearer ${secret}\`` 로 비교하던 것을
 * node:crypto timingSafeEqual 기반 상수시간 비교로 통일한다. 의미(동작)는 동일:
 *  - CRON_SECRET 미설정 → 500
 *  - Authorization 헤더 불일치(또는 부재) → 401
 *  - 일치 → 통과
 *
 * 응답 body는 기존 라우트와 동일 문자열을 유지한다(호출부에서 그대로 반환).
 */

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 500 | 401; body: { error: string } };

/**
 * 상수시간 문자열 비교. 길이가 다르면 즉시 false를 반환하되,
 * 자기 자신과 한 번 비교해 조기 반환에 의한 타이밍 누설을 최소화한다.
 */
function timingSafeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // 길이 불일치 시에도 동일한 연산량을 소모(자기 비교) 후 false.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * @param req   요청
 * @param tag   로그 태그(예: "expire-holds") — 미설정 500 로그에 사용, 기존 로그 문구 유지
 */
export function verifyCronAuth(req: Request, tag: string): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // 미설정 환경에서 무인증 개방 금지 — 명시적 실패
    console.error(`[cron/${tag}] CRON_SECRET 미설정`);
    return { ok: false, status: 500, body: { error: "CRON_SECRET이 설정되지 않았습니다" } };
  }
  const header = req.headers.get("authorization") ?? "";
  if (!timingSafeStrEqual(header, `Bearer ${secret}`)) {
    return { ok: false, status: 401, body: { error: "unauthorized" } };
  }
  return { ok: true };
}
