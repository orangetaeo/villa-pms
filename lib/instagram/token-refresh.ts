// lib/instagram/token-refresh.ts — 장기 액세스 토큰 60일 만료 전 자동 갱신
//
// 기준: "Instagram API with Instagram Login". 장기 토큰은 발급/최종 갱신 후 60일 유효.
//   갱신: GET https://graph.instagram.com/refresh_access_token
//           ?grant_type=ig_refresh_token&access_token=<현재 장기 토큰>
//   ★ refresh_access_token 은 호스트 루트에 위치 — 버전 경로(/vNN.N) 없음.
//     getIgGraphHostRoot 로 base 끝의 버전 세그먼트를 제거해 URL 구성.
//   성공 응답: { access_token, token_type: "bearer", expires_in }  (expires_in = 만료까지 초)
//
// ★ throw 금지: 항상 결과 객체로 반환한다(cron 이 skip/실패 분류). Graph error 는 message 보존.
//   - "최소 24시간 미경과"류(토큰이 아직 갱신 자격 미충족)는 skip 으로 분류 → 경보 아님.
// ★ 누수/보안: 토큰 평문·암호문은 로그·감사·반환 어디에도 넣지 않는다(설정 사실·시각만).
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { writeAuditLog } from "@/lib/audit-log";
import {
  getIgAccessToken,
  setIgAccessToken,
  setIgTokenTimestamps,
  getIgGraphHostRoot,
} from "@/lib/instagram/settings";

const HTTP_TIMEOUT_MS = 30_000;

export type TokenRefreshResult =
  // 새 토큰 저장 + 타임스탬프 갱신 완료.
  | { ok: true; expiresAt: string; refreshedAt: string; expiresInSeconds: number }
  // 갱신 미시도/자격 미충족 — 경보 아님(no_token: 미설정, cooldown_24h: 24h 미경과).
  | { ok: false; skipped: true; reason: "no_token" | "cooldown_24h"; detail?: string }
  // 실제 실패 — 운영자 경보 대상. detail = Graph error.message.
  | { ok: false; skipped: false; reason: string };

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

/**
 * Graph 에러 메시지가 "아직 갱신할 수 없음(최소 24시간 경과 필요)"류인지 판정.
 * 표현이 버전에 따라 다를 수 있어 소문자 부분일치로 관대하게 매칭한다.
 */
function isCooldownError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /24\s*hour/.test(m) ||
    /at least 24/.test(m) ||
    /less than 24/.test(m) ||
    (m.includes("refresh") && m.includes("24"))
  );
}

/**
 * 장기 액세스 토큰 갱신 시도. 성공 시 새 토큰 암호화 저장 + 만료/갱신 타임스탬프 upsert + AuditLog.
 * @returns 결과 객체(throw 하지 않음). 호출부(cron)가 ok/skipped/실패를 분기.
 */
export async function refreshInstagramToken(db: DbClient = prisma): Promise<TokenRefreshResult> {
  const current = await getIgAccessToken(db);
  if (!current) return { ok: false, skipped: true, reason: "no_token" };

  const hostRoot = await getIgGraphHostRoot(db);
  const qs = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: current,
  });

  let json: (Record<string, unknown> & GraphErrorBody) | null = null;
  let httpStatus = 0;
  try {
    const res = await fetch(`${hostRoot}/refresh_access_token?${qs}`, {
      method: "GET",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    httpStatus = res.status;
    json = (await res.json().catch(() => ({}))) as Record<string, unknown> & GraphErrorBody;
  } catch (e) {
    // 네트워크·타임아웃 — 실패(경보). 토큰 미노출.
    return { ok: false, skipped: false, reason: e instanceof Error ? e.message : String(e) };
  }

  // Graph 에러(HTTP 4xx/5xx 또는 error 필드).
  if (httpStatus >= 400 || json?.error) {
    const msg = json?.error?.message ?? `Graph API HTTP ${httpStatus}`;
    if (isCooldownError(msg)) {
      return { ok: false, skipped: true, reason: "cooldown_24h", detail: msg };
    }
    return { ok: false, skipped: false, reason: msg };
  }

  const newToken = typeof json?.access_token === "string" ? json.access_token : null;
  const expiresIn = typeof json?.expires_in === "number" ? json.expires_in : null;
  if (!newToken || !expiresIn || expiresIn <= 0) {
    return { ok: false, skipped: false, reason: "갱신 응답에 access_token/expires_in 이 없습니다" };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresIn * 1000).toISOString();
  const refreshedAt = now.toISOString();

  // 새 토큰 암호화 저장 + 타임스탬프.
  await setIgAccessToken(newToken, db);
  await setIgTokenTimestamps(expiresAt, refreshedAt, db);

  // ★ 감사: 토큰 값·암호문 절대 미기록 — 갱신 사실·시각만.
  await writeAuditLog({
    userId: null,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: "IG_ACCESS_TOKEN",
    changes: {
      accessToken: { new: "***refreshed***" },
      tokenExpiresAt: { new: expiresAt },
      tokenRefreshedAt: { new: refreshedAt },
    },
    db,
  });

  return { ok: true, expiresAt, refreshedAt, expiresInSeconds: expiresIn };
}
