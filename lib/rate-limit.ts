// 인메모리 슬라이딩 윈도우 rate limiter (T-sec-auth-ratelimit, Phase 1 보안)
// 무차별 대입·크리덴셜 스터핑·가입 스팸 방어. 순수 로직(now 주입 가능 → 결정적 테스트).
//
// 한계: 프로세스 메모리 — Railway 단일 인스턴스 가정. 다중 인스턴스/오토스케일 확장 시
// Redis 등 공유 스토어로 교체 필요(후속 백로그). 단일 인스턴스에서는 무제한보다 월등.

export interface RateLimitOptions {
  /** 윈도우 내 허용 최대 횟수 */
  max: number;
  /** 윈도우 길이(ms) */
  windowMs: number;
  /** 테스트·일관성용 현재 시각 주입 (기본 Date.now()) */
  now?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** 남은 허용 횟수 (차단 시 0) */
  remaining: number;
  /** 차단 시 재시도까지 남은 ms (허용 시 0) */
  retryAfterMs: number;
}

// key → 윈도우 내 hit 타임스탬프(ms) 배열
const buckets = new Map<string, number[]>();

/**
 * 한 번의 시도를 기록하며 한도 검사. 한도 초과면 기록하지 않고 차단 반환.
 * - allowed=true: 이번 시도를 카운트에 포함(remaining 갱신)
 * - allowed=false: 카운트 미증가, retryAfterMs 후 재시도 가능
 */
export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = opts.now ?? Date.now();
  const windowStart = now - opts.windowMs;
  // 윈도우 밖(만료) hit 제거
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);

  if (hits.length >= opts.max) {
    buckets.set(key, hits); // 프루닝 결과 보존
    const oldest = hits[0];
    const retryAfterMs = Math.max(0, oldest + opts.windowMs - now);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, remaining: opts.max - hits.length, retryAfterMs: 0 };
}

/** 성공 시 카운터 초기화 (예: 로그인 성공 → 해당 전화번호 잠금 카운트 리셋) */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** 테스트 격리용 — 전체 초기화 */
export function clearAllRateLimits(): void {
  buckets.clear();
}

/**
 * 클라이언트 IP 추출 — IP 한도(rate limit)의 **best-effort** 키 용도.
 *
 * x-forwarded-for(쉼표 구분 첫 IP=원 클라이언트 주장값) → x-real-ip → null.
 * 주의: leftmost 값은 클라이언트가 위조 가능 → IP 한도는 스푸핑으로 우회될 수 있다.
 * **무차별 대입의 1차 방어는 스푸핑 불가능한 전화번호 한도(login:phone:)** 이며,
 * IP 한도는 단순 봇을 거르는 보조 계층이다.
 * (정석은 신뢰 프록시 홉 기준 rightmost 채택이나, Railway XFF 토폴로지를 프로덕션에서
 *  실측하기 전에는 전원이 한 IP로 묶여 정상 사용자를 과잉 차단할 위험이 있어 보류 — 후속 백로그)
 */
export function clientIp(headers: Headers | null | undefined): string | null {
  if (!headers) return null;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  return real?.trim() || null;
}
