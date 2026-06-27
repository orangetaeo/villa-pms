import { describe, it, expect } from "vitest";
import {
  isPasswordSessionStale,
  shouldRecheckPassword,
  PWD_CHECK_THROTTLE_MS,
} from "./session-invalidation";

describe("isPasswordSessionStale — 비밀번호 변경 시 타 디바이스 세션 무효화 (보안 P0-5②)", () => {
  it("토큰 baseline보다 DB passwordChangedAt가 새로우면 무효(true)", () => {
    // 디바이스 A에서 12:00에 로그인(baseline=1000), 이후 12:05에 비번 변경(db=2000)
    // → 디바이스 B의 1000 토큰은 stale
    expect(isPasswordSessionStale(1000, 2000)).toBe(true);
  });

  it("DB 값이 토큰 baseline과 같거나 이전이면 유효(false)", () => {
    expect(isPasswordSessionStale(2000, 2000)).toBe(false); // 같음 = 그 토큰이 변경 결과
    expect(isPasswordSessionStale(2000, 1000)).toBe(false); // 이전(있을 수 없으나 방어)
  });

  it("DB passwordChangedAt가 null(한 번도 안 바꿈)이면 0 취급 → 유효(false)", () => {
    expect(isPasswordSessionStale(0, null)).toBe(false);
    expect(isPasswordSessionStale(1000, null)).toBe(false);
  });

  it("그랜드파더 — 기능 도입 전 토큰(tokenPwdAt undefined)은 절대 무효화 안 함(false)", () => {
    // DB에 값이 있어도(이미 비번 바꾼 적 있어도) 무효화하지 않는다 → 도입 직후 대량 락아웃 방지
    expect(isPasswordSessionStale(undefined, 9999)).toBe(false);
    expect(isPasswordSessionStale(undefined, null)).toBe(false);
  });
});

describe("shouldRecheckPassword — DB 재조회 스로틀", () => {
  it("마지막 조회 기록이 없으면(첫 후속 호출) 즉시 조회(true)", () => {
    expect(shouldRecheckPassword(undefined, 1_000_000)).toBe(true);
  });

  it("스로틀 간격이 지났으면 조회(true)", () => {
    const now = 1_000_000;
    expect(shouldRecheckPassword(now - PWD_CHECK_THROTTLE_MS, now)).toBe(true);
    expect(shouldRecheckPassword(now - PWD_CHECK_THROTTLE_MS - 1, now)).toBe(true);
  });

  it("스로틀 간격 이내면 조회 생략(false) — 매 요청 DB 안 때림", () => {
    const now = 1_000_000;
    expect(shouldRecheckPassword(now - 1, now)).toBe(false);
    expect(shouldRecheckPassword(now - (PWD_CHECK_THROTTLE_MS - 1), now)).toBe(false);
  });
});
