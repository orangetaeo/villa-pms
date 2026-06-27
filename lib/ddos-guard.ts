// L7 DDoS/플러드 하드닝 — 미들웨어 전역 가드의 순수 결정 로직 (보안 P1-S11)
//
// ⚠ 범위: 볼류메트릭(L3/L4) DDoS는 앱 코드로 못 막는다 — Cloudflare/Railway 등 **인프라 앞단**이 1차 방어선
//   (docs/ops/ddos-protection.md). 여기서는 단일 IP의 L7 플러드와 초대형 본문을 **넉넉한 한도**로 거르는
//   백스톱이다. 자기-DoS(정상 사용자 과잉 차단) 방지를 위해 한도는 넉넉하게, env로 튜닝, 킬스위치 제공.
//
// 한계: 미들웨어 인메모리 카운터는 **인스턴스별**(Railway 단일 컨테이너 가정). 다중 인스턴스/분산 플러드는
//   인프라 레이어가 담당. checkRateLimit 재사용(순수·Edge 호환).

import { checkRateLimit } from "@/lib/rate-limit";

// 전역 IP 플러드 한도 — 기본 1000회/분(≈16/s 지속). 정상 사용자(피크 ~100-300/분)보다 한참 위, 봇 플러드만 차단.
const GLOBAL_MAX = Number(process.env.RATE_LIMIT_GLOBAL_MAX ?? "1000");
const GLOBAL_WINDOW_MS = 60_000;
// 킬스위치 — 오작동 시 즉시 비활성(env만 바꾸면 코드 배포 없이 끔).
const FLOOD_DISABLED = process.env.RATE_LIMIT_GLOBAL_DISABLED === "1";
// 본문 크기 상한 — 기본 30MB(정상 업로드 최대 20MB보다 위). 초대형 페이로드 메모리 공격 차단.
const MAX_BODY_BYTES = Number(process.env.MAX_REQUEST_BODY_BYTES ?? String(30 * 1024 * 1024));

// 장수명 연결(SSE 등)은 플러드 카운트 제외 — 한 번 열고 유지하는 정상 패턴.
const EXCLUDED_PREFIXES = ["/api/zalo/stream"];

export interface GuardInput {
  pathname: string;
  ip: string | null;
  contentLength: number | null;
  now?: number;
}

export interface GuardDecision {
  status: number; // 413 | 429
  reason: "body_too_large" | "rate_limited";
  retryAfterMs?: number;
}

/** 요청을 평가해 차단 결정을 반환(통과면 null). 미들웨어가 이 결정으로 응답을 만든다. */
export function evaluateRequest(input: GuardInput): GuardDecision | null {
  if (EXCLUDED_PREFIXES.some((p) => input.pathname.startsWith(p))) return null;

  // 1) 본문 크기 상한 — content-length 헤더 기준 조기 차단(킬스위치와 무관, 항상 적용).
  if (input.contentLength != null && input.contentLength > MAX_BODY_BYTES) {
    return { status: 413, reason: "body_too_large" };
  }

  // 2) 전역 IP 플러드 — 킬스위치 OFF이고 IP를 알 때만.
  if (FLOOD_DISABLED || !input.ip) return null;
  const r = checkRateLimit(`global:ip:${input.ip}`, {
    max: GLOBAL_MAX,
    windowMs: GLOBAL_WINDOW_MS,
    now: input.now,
  });
  if (!r.allowed) return { status: 429, reason: "rate_limited", retryAfterMs: r.retryAfterMs };
  return null;
}

// 테스트·관측용 현재 설정 노출.
export const __config = { GLOBAL_MAX, GLOBAL_WINDOW_MS, FLOOD_DISABLED, MAX_BODY_BYTES, EXCLUDED_PREFIXES };
