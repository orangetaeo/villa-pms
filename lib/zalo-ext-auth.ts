// lib/zalo-ext-auth.ts — Nike↔villa ext 읽기/발송 공통 인증 헬퍼 (S1·S2 / ADR-0010 A5)
//
// 목적: ext 라우트(send=S1, threads/messages=S2)가 동일한 시크릿 게이트 + 테오 ownerAdminId
//       서버 결정 로직을 공유한다. S1 send route의 isSecretValid 동작을 그대로 추출 — 동작 불변.
//
// 보안:
//   - 시크릿 게이트: x-zalo-ext-secret 헤더 vs process.env.ZALO_EXT_SHARED_SECRET을
//     crypto.timingSafeEqual로 비교(단순 === 금지). 헤더 없음/불일치/env 미설정 → false(401).
//     시크릿 값·길이는 응답·로그에 절대 미출력.
//   - ownerAdminId(테오)는 요청에서 절대 받지 않는다 — getSystemBotOwnerId()(SYSTEM_BOT DB
//     동적 해석) 1순위, env ZALO_SYSTEM_OWNER_ID 2순위. 둘 다 없으면 null(503). 리터럴 ID 금지.
import { timingSafeEqual } from "node:crypto";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";

export const ZALO_EXT_SECRET_HEADER = "x-zalo-ext-secret";

/**
 * ext 시크릿 게이트 — timingSafeEqual 비교. env 미설정·헤더 없음·불일치 모두 false.
 * S1 send route의 isSecretValid와 동일 동작(추출본).
 */
export function isExtSecretValid(req: Request): boolean {
  const expected = process.env.ZALO_EXT_SHARED_SECRET;
  if (!expected) return false; // env 미설정 → 인증 불가(401). 시크릿 값 미노출.
  const provided = req.headers.get(ZALO_EXT_SECRET_HEADER);
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // 길이 다르면 timingSafeEqual이 throw — 먼저 길이 비교(불일치로 처리)하되,
  // 길이 노출 최소화를 위해 동일 길이일 때만 정밀 비교한다.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 테오(시스템봇 소유자) ownerAdminId 서버 결정. 요청 파라미터 미수용.
 * 1순위 SYSTEM_BOT DB 동적 해석, 2순위 env ZALO_SYSTEM_OWNER_ID. 둘 다 없으면 null(호출부 503).
 */
export async function resolveSystemOwnerId(): Promise<string | null> {
  let ownerAdminId: string | null = null;
  try {
    ownerAdminId = await getSystemBotOwnerId();
  } catch {
    ownerAdminId = null;
  }
  if (!ownerAdminId) {
    ownerAdminId = process.env.ZALO_SYSTEM_OWNER_ID ?? null;
  }
  return ownerAdminId;
}
