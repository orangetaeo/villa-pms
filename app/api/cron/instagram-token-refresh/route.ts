// 인스타그램 장기 토큰 자동 갱신 cron
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(첫 줄 게이트).
// 스케줄: 매일 실행 가능(멱등). 실제 갱신은 IG_TOKEN_REFRESHED_AT 기준 주 1회만 시도(7일 게이트).
//   - 토큰 미설정 → { skipped: "no_token" }
//   - 갱신 자격 미충족(24h 미경과 등) → { skipped: "cooldown_24h" } (경보 아님)
//   - 아직 7일 미경과 → { skipped: "not_due" }
//   - 성공 → { refreshed: true, expiresAt }
//   - 실패(skip 제외) → 운영자 인앱 경보(IG_TOKEN_REFRESH_FAILED, 만료 7일 이내면 긴급 표시) + AuditLog.
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { enqueueInAppForOperators } from "@/lib/inapp-notification";
import { refreshInstagramToken } from "@/lib/instagram/token-refresh";
import {
  getIgAccessTokenMeta,
  getIgTokenRefreshedAt,
  getIgTokenExpiresAt,
} from "@/lib/instagram/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 주 1회
const URGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 만료 7일 이내 = 긴급

/** ISO 문자열 → 만료까지 남은 일수(내림). 파싱 실패·미설정 시 null. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / (24 * 60 * 60 * 1000));
}

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "instagram-token-refresh");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  // 토큰 미설정 → 갱신 대상 없음.
  const meta = await getIgAccessTokenMeta();
  if (!meta.set) return Response.json({ status: "ok", skipped: "no_token" });

  // 주 1회 게이트: 최근 갱신 후 7일 미경과면 스킵.
  const refreshedAtIso = await getIgTokenRefreshedAt();
  if (refreshedAtIso) {
    const last = Date.parse(refreshedAtIso);
    if (!Number.isNaN(last) && Date.now() - last < REFRESH_INTERVAL_MS) {
      return Response.json({ status: "ok", skipped: "not_due", lastRefreshedAt: refreshedAtIso });
    }
  }

  const result = await refreshInstagramToken();

  if (result.ok) {
    return Response.json({ status: "ok", refreshed: true, expiresAt: result.expiresAt });
  }

  // 스킵(경보 아님) — no_token / cooldown_24h.
  if (result.skipped) {
    return Response.json({ status: "ok", skipped: result.reason });
  }

  // 실제 실패 → 운영자 경보 + 감사. 만료 임박 시 긴급 표시.
  const expiresAtIso = await getIgTokenExpiresAt();
  const remainingDays = daysUntil(expiresAtIso);
  const urgent =
    expiresAtIso != null &&
    !Number.isNaN(Date.parse(expiresAtIso)) &&
    Date.parse(expiresAtIso) - Date.now() <= URGENT_WINDOW_MS;

  const failReason = result.reason.slice(0, 500);

  await writeAuditLog({
    userId: null,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: "IG_ACCESS_TOKEN",
    changes: {
      tokenRefresh: { new: "FAILED" },
      failReason: { new: failReason },
      ...(remainingDays != null ? { daysUntilExpiry: { new: remainingDays } } : {}),
    },
  });

  try {
    const urgentPrefix = urgent ? "🚨 [긴급] " : "⚠️ ";
    const expiryNote =
      remainingDays != null
        ? remainingDays >= 0
          ? ` 만료까지 D-${remainingDays}.`
          : " 이미 만료됨."
        : "";
    await enqueueInAppForOperators({
      type: "IG_TOKEN_REFRESH_FAILED",
      title: `${urgentPrefix}인스타 토큰 갱신 실패`,
      body: `인스타그램 액세스 토큰 자동 갱신에 실패했습니다.${expiryNote} 연동 설정에서 토큰을 재발급·저장하세요. (사유: ${failReason})`,
      href: "/marketing/instagram",
    });
  } catch (e) {
    console.error(
      "[cron/instagram-token-refresh] 실패 경보 적재 실패:",
      e instanceof Error ? e.message : String(e)
    );
  }

  return Response.json({
    status: "ok",
    refreshed: false,
    failReason,
    urgent,
    daysUntilExpiry: remainingDays,
  });
}

export { handle as GET, handle as POST };
