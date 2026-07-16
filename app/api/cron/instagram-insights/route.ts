// 인스타그램 인사이트 수집 cron (instagram-marketing-p2 §C, 일 1회)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(첫 줄 게이트).
//
// 대상: PUBLISHED && igMediaId 있는 포스트.
//   - 최근 30일 발행분: 매일 수집(지표 변동 큼)
//   - 그 이전 발행분: insightsSyncedAt 없음 or 7일 경과 시에만(주 1회 — 오래된 포스트는 변화 미미, 비용 절약)
//   - 계정 스냅샷 1건(팔로워·reach·profile_views) — 미디어 0건이어도 팔로워 추이 수집
//
// 안전장치: 토큰 미설정=skipped, PUBLISHED 0건이어도 크래시 없이 {status:"ok", media:0}.
//   개별 미디어 실패는 계속 진행(failCount 집계), 전체 실패급(대상>0 & 성공 0)만 인앱 경보.
//   AuditLog는 쓰기 발생 시 요약 1건(entity=InstagramInsightSnapshot, entityId=수집일 — 포스트별 남발 금지).
import { IgPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyMarketing } from "@/lib/marketing-notify";
import { parseUtcDateOnly, todayVnDateString } from "@/lib/date-vn";
import { loadInsightsContext, syncMediaInsights, syncAccountInsights } from "@/lib/instagram/insights";
import { syncYoutubeShortStats } from "@/lib/youtube/stats";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 미디어 다건 × Graph API 콜

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "instagram-insights");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  // 토큰/IG_USER_ID 미설정 → 수집 스킵(경보 아님).
  const ctx = await loadInsightsContext();
  if (!ctx) return Response.json({ status: "ok", skipped: "no_token", media: 0 });

  const vnToday = todayVnDateString();
  const capturedOn = parseUtcDateOnly(vnToday) ?? new Date();

  const now = Date.now();
  const thirtyDaysAgo = new Date(now - THIRTY_DAYS_MS);
  const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS);

  // 최근 30일분(매일) OR 오래된분 중 주간 게이트 통과분(미수집 or 7일 경과).
  const posts = await prisma.instagramPost.findMany({
    where: {
      status: IgPostStatus.PUBLISHED,
      igMediaId: { not: null },
      OR: [
        { publishedAt: { gte: thirtyDaysAgo } },
        { publishedAt: null },
        { insightsSyncedAt: null },
        { insightsSyncedAt: { lt: sevenDaysAgo } },
      ],
    },
    orderBy: { publishedAt: "desc" },
    select: { id: true, igMediaId: true, kind: true },
  });

  let mediaOk = 0;
  let failCount = 0;
  const failures: { id: string; reason: string }[] = [];

  for (const p of posts) {
    if (!p.igMediaId) continue; // 방어(where에서 이미 제외)
    try {
      const r = await syncMediaInsights(
        ctx,
        { id: p.id, igMediaId: p.igMediaId, kind: p.kind },
        capturedOn
      );
      if (r.ok) {
        mediaOk++;
      } else {
        failCount++;
        failures.push({ id: p.id, reason: r.reason ?? "unknown" });
      }
    } catch (e) {
      failCount++;
      failures.push({ id: p.id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
    }
  }

  // 계정 스냅샷 1건(미디어 유무 무관).
  let accountOk = false;
  let accountReason: string | undefined;
  try {
    const a = await syncAccountInsights(ctx, capturedOn);
    accountOk = a.ok;
    if (!a.ok) accountReason = a.reason;
  } catch (e) {
    accountReason = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }

  // 쓰기 발생 시 요약 AuditLog 1건(포스트별 남발 금지 — SYSTEM 성 수집).
  const wrote = mediaOk > 0 || accountOk;
  if (wrote) {
    await writeAuditLog({
      userId: null,
      action: "CREATE",
      entity: "InstagramInsightSnapshot",
      entityId: vnToday,
      changes: {
        capturedOn: { new: vnToday },
        mediaOk: { new: mediaOk },
        mediaFail: { new: failCount },
        account: { new: accountOk ? "ok" : accountReason ?? "fail" },
      },
    });
  }

  // 전체 실패급 경보: 미디어 대상이 있는데 전부 실패(토큰·권한 이상 의심). 인앱 벨 + Zalo 그룹.
  if (posts.length > 0 && mediaOk === 0) {
    await notifyMarketing({
      kind: "IG_INSIGHTS_FAILED",
      summary: `인스타 지표 수집이 전부 실패했습니다(대상 ${posts.length}건). 연동 설정에서 토큰·권한을 확인하세요.`,
      href: "/marketing/instagram",
    });
  }

  // ── 유튜브 쇼츠 성과 수집(marketing-s2 §B) — 인스타 블록과 완전 격리(try/catch). ──
  //   토큰 미연결/미설정이면 fetchYoutubeVideoStats가 실패 사유 반환(targeted>0 && ok=0 → 경보).
  //   대상 0건(발행 쇼츠 없음)이면 no-op. 쓰기 발생 시 요약 AuditLog 1건.
  let yt: { targeted: number; ok: number; reason?: string } = { targeted: 0, ok: 0 };
  try {
    yt = await syncYoutubeShortStats(capturedOn);
    if (yt.ok > 0) {
      await writeAuditLog({
        userId: null,
        action: "CREATE",
        entity: "YoutubeShort",
        entityId: vnToday,
        changes: {
          capturedOn: { new: vnToday },
          statsOk: { new: yt.ok },
          targeted: { new: yt.targeted },
        },
      });
    }
    // 대상이 있는데 전부 실패(토큰·쿼터 이상 의심) — 경보.
    if (yt.targeted > 0 && yt.ok === 0) {
      await notifyMarketing({
        kind: "YT_STATS_FAILED",
        summary:
          `유튜브 쇼츠 성과 수집이 전부 실패했습니다(대상 ${yt.targeted}건).` +
          (yt.reason ? ` 사유: ${yt.reason}` : " 유튜브 연결·쿼터를 확인하세요."),
        href: "/marketing/youtube",
      });
    }
  } catch (e) {
    console.error(
      "[cron/instagram-insights] 유튜브 성과 수집 실패(격리):",
      e instanceof Error ? e.message : String(e)
    );
  }

  return Response.json({
    status: "ok",
    media: posts.length,
    mediaOk,
    failCount,
    account: accountOk ? "ok" : "fail",
    youtube: { targeted: yt.targeted, ok: yt.ok, ...(yt.reason ? { reason: yt.reason } : {}) },
    ...(failures.length > 0 ? { failures } : {}),
  });
}

export { handle as GET, handle as POST };
