// 비용성 엔드포인트 사용자별 스로틀 (보안 P1-S11) — LLM 번역·여권 OCR·음성 전사 등 호출당 외부 비용(Gemini) 발생.
// 인증 게이트가 있어 외부인은 못 부르지만, 악성/오작동 인증 계정의 **비용 폭주**를 사용자별 한도로 막는다.
// 한도는 넉넉(기본 200/분 — 채팅 스레드 일괄 번역도 충분)하되 런어웨이는 차단. 초과 시 RATE_LIMIT 기록.
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security-event";

const COST_MAX = Number(process.env.COST_ENDPOINT_MAX ?? "200");
const COST_WINDOW_MS = 60_000;

/** 비용 엔드포인트 사용자별 스로틀. 초과 시 429 NextResponse(+RATE_LIMIT 기록), 통과면 null. */
export async function costThrottle(scope: string, userId: string): Promise<NextResponse | null> {
  const r = checkRateLimit(`cost:${scope}:user:${userId}`, { max: COST_MAX, windowMs: COST_WINDOW_MS });
  if (!r.allowed) {
    await recordSecurityEvent({
      type: "RATE_LIMIT",
      actorUserId: userId,
      path: `/cost/${scope}`,
      meta: { scope, kind: "cost" },
    });
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }
  return null;
}
