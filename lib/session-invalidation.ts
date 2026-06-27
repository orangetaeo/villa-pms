// 서버측 세션 무효화 헬퍼 (보안 P0-5②) — 비밀번호 변경 시 *타 디바이스* 세션 강제 만료.
//
// 문제: JWT 세션은 stateless라, 비밀번호를 바꿔도 이미 탈취된 다른 디바이스의 토큰은
// maxAge(7일)까지 유효하다. 클라이언트 signOut()은 신뢰 불가(악성/오작동 클라가 호출 안 하면 그만).
//
// 해결: User.passwordChangedAt를 토큰 발급 시점(token.pwdAt)에 박아두고, 후속 요청마다
// (스로틀 적용) DB의 현재 passwordChangedAt와 비교. 토큰 baseline보다 새로우면 = 발급 이후
// 비밀번호가 바뀐 것 → 그 토큰은 무효(jwt 콜백이 null 반환 → 세션 삭제).
//
// 순수 함수로 분리해 단위 테스트로 락아웃 회귀(그랜드파더·null 처리)를 고정한다.

// 후속 요청마다 DB를 때리지 않도록 재조회 간격(스로틀). 무효화 지연 상한이자 DB 부하 상한.
// 60초 = 탈취 세션이 최대 1분 안에 끊김 + 활성 토큰당 분당 1쿼리 이하.
export const PWD_CHECK_THROTTLE_MS = 60_000;

/**
 * 토큰이 비밀번호 변경으로 인해 무효(stale)인지 판정.
 * @param tokenPwdAt 토큰 발급 시 박아둔 passwordChangedAt(ms). 본 기능 이전 토큰은 undefined.
 * @param dbPasswordChangedAtMs 현재 DB의 passwordChangedAt(ms). 한 번도 안 바꿨으면 null.
 *
 * - tokenPwdAt이 undefined면 **그랜드파더**: 기능 도입 전 토큰은 무효화하지 않는다(false).
 *   (도입 직후 멀쩡한 로그인 세션이 한꺼번에 끊기는 락아웃 방지 — 호출처에서 baseline을 채택시킨다.)
 * - DB 값(null=0)이 토큰 baseline보다 **엄격히 크면** 무효(true).
 */
export function isPasswordSessionStale(
  tokenPwdAt: number | undefined,
  dbPasswordChangedAtMs: number | null,
): boolean {
  if (tokenPwdAt === undefined) return false; // 그랜드파더 — 절대 무효화 안 함
  const dbMs = dbPasswordChangedAtMs ?? 0;
  return dbMs > tokenPwdAt;
}

/**
 * 지금 DB를 다시 조회할 때가 됐는지(스로틀). lastCheckMs가 없으면(첫 후속 호출) 즉시 조회.
 */
export function shouldRecheckPassword(
  lastCheckMs: number | undefined,
  nowMs: number,
): boolean {
  if (lastCheckMs === undefined) return true;
  return nowMs - lastCheckMs >= PWD_CHECK_THROTTLE_MS;
}
