// 게스트(/g) 비인증 mutation 라우트 rate-limit (보안 P0-3)
//
// /g 라우트는 토큰만으로 호출되는 비인증 POST(주문·서명·동의·여권업로드)다. rate-limit가 없으면
// 토큰 1개로 무제한 호출 → 스팸·자원/스토리지 고갈. /p hold와 동일 패턴(토큰+IP 양 윈도우)으로 막는다.
// 차단 시 SecurityEvent(RATE_LIMIT) 기록.

import { NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security-event";

export interface GuestRlConfig {
  token: { max: number; windowMs: number };
  ip: { max: number; windowMs: number };
}

const WINDOW = 10 * 60_000; // 10분

/** 일반 게스트 mutation(주문·서명·동의) 기본 한도 — 토큰 30 / IP 60 per 10분. */
export const GUEST_RL_DEFAULT: GuestRlConfig = {
  token: { max: 30, windowMs: WINDOW },
  ip: { max: 60, windowMs: WINDOW },
};

/** 여권 업로드 — 파일이라 더 낮게(자원·스토리지 보호). 토큰 10 / IP 20 per 10분. */
export const GUEST_RL_UPLOAD: GuestRlConfig = {
  token: { max: 10, windowMs: WINDOW },
  ip: { max: 20, windowMs: WINDOW },
};

/**
 * 게스트 라우트 rate-limit 검사. 초과 시 429 NextResponse(+RATE_LIMIT 기록) 반환, 통과 시 null.
 * @param scope 키·로그 구분 (예: "g-service-orders")
 */
export async function guestRateLimit(
  scope: string,
  token: string,
  req: Request,
  cfg: GuestRlConfig = GUEST_RL_DEFAULT,
): Promise<NextResponse | null> {
  const ip = clientIp(req.headers);
  const tokenOk = checkRateLimit(`${scope}:token:${token}`, cfg.token).allowed;
  const ipOk = ip ? checkRateLimit(`${scope}:ip:${ip}`, cfg.ip).allowed : true;
  if (!tokenOk || !ipOk) {
    await recordSecurityEvent({
      type: "RATE_LIMIT",
      ip,
      path: `/g/${scope}`,
      meta: { scope, by: !tokenOk ? "token" : "ip" },
    });
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }
  return null;
}
