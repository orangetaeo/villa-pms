// 슬라이딩 윈도우 rate limiter (T-sec-auth-ratelimit, Phase 1 보안 / 추상화 P1-S4)
// 무차별 대입·크리덴셜 스터핑·가입 스팸 방어. 순수 로직(now 주입 가능 → 결정적 테스트).
//
// 스토어 추상화(P1-S4): 기본은 인메모리(MemoryRateLimitStore). 다중 인스턴스/오토스케일 확장 시
// Redis 등 공유 스토어를 RateLimitStore로 구현해 setRateLimitStore()로 주입하면 본 모듈을 쓰는
// 전 호출부(로그인·게스트·가입 등)가 자동으로 분산 한도를 따른다(호출부 무변경). 교체점은 이 한 곳.

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

/** rate-limit 백엔드 계약 — 메모리(기본)·Redis(후속)가 구현. */
export interface RateLimitStore {
  /** 한 번의 시도를 기록하며 한도 검사. */
  check(key: string, opts: RateLimitOptions): RateLimitResult;
  /** 특정 키 카운터 초기화. */
  reset(key: string): void;
  /** 전체 초기화(테스트 격리용). */
  clear(): void;
}

/** 인메모리 슬라이딩 윈도우 구현 — Railway 단일 인스턴스 기본값. */
export class MemoryRateLimitStore implements RateLimitStore {
  // key → 윈도우 내 hit 타임스탬프(ms) 배열
  private buckets = new Map<string, number[]>();

  check(key: string, opts: RateLimitOptions): RateLimitResult {
    const now = opts.now ?? Date.now();
    const windowStart = now - opts.windowMs;
    // 윈도우 밖(만료) hit 제거
    const hits = (this.buckets.get(key) ?? []).filter((t) => t > windowStart);

    if (hits.length >= opts.max) {
      this.buckets.set(key, hits); // 프루닝 결과 보존
      const oldest = hits[0];
      const retryAfterMs = Math.max(0, oldest + opts.windowMs - now);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    hits.push(now);
    this.buckets.set(key, hits);
    return { allowed: true, remaining: opts.max - hits.length, retryAfterMs: 0 };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }
}

// 현재 활성 스토어 — 기본 메모리. 후속 Redis는 setRateLimitStore로 주입.
let store: RateLimitStore = new MemoryRateLimitStore();

/** rate-limit 백엔드 교체(후속 Redis 등). 부팅 시 1회 호출 가정. */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

/**
 * 한 번의 시도를 기록하며 한도 검사. 한도 초과면 기록하지 않고 차단 반환.
 * - allowed=true: 이번 시도를 카운트에 포함(remaining 갱신)
 * - allowed=false: 카운트 미증가, retryAfterMs 후 재시도 가능
 */
export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  return store.check(key, opts);
}

/** 성공 시 카운터 초기화 (예: 로그인 성공 → 해당 전화번호 잠금 카운트 리셋) */
export function resetRateLimit(key: string): void {
  store.reset(key);
}

/** 테스트 격리용 — 전체 초기화 */
export function clearAllRateLimits(): void {
  store.clear();
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
