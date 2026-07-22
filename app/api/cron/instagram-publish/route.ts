// 인스타그램 발행 cron (instagram-marketing-p1, 기획 §3-4)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(첫 줄 게이트).
// 흐름: QUEUED && scheduledAt<=now → updateMany로 PUBLISHING 선점(중복 발행 락) → Graph API 발행
//   → 성공: PUBLISHED+igMediaId+igPermalink+publishedAt / 실패: FAILED+failReason+운영자 경보. AuditLog.
//
// ★ 동시성 락: updateMany where {status:QUEUED} → data {status:PUBLISHING} 가 원자적 선점.
//   affected 0이면 다른 실행이 이미 가져간 것(스킵). PUBLISHING로 바뀐 행만 이 실행이 발행한다.
// ★ 고아 회수(T-publish-orphan-reaper): 발행 도중 프로세스가 죽으면 그 행이 PUBLISHING에 갇히므로,
//   본 처리 전에 45분 초과 PUBLISHING을 FAILED로 자동 회수한다(QUEUED 복귀 없음 — 중복 게시 방지).
import { IgPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyMarketing } from "@/lib/marketing-notify";
import { reapStalePublishing } from "@/lib/marketing/reap-stale-publishing";
import { publishInstagramPost, publishInstagramReel } from "@/lib/instagram/publish";
import { isAutopostPaused } from "@/lib/instagram/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 컨테이너 폴링(이미지 60s·릴스 최대 300s/컨테이너) × 도래분

interface MediaEntry {
  renderedUrl?: unknown;
  videoUrl?: unknown;
}

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "instagram-publish");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  // 발행 고아 자가 치유 — **킬스위치 검사보다 먼저** 돈다. 킬스위치를 켠 채로 두면 이미 갇힌 행이
  // 영영 회수되지 않기 때문이다(정지 중에도 회수는 계속돼야 한다). 회수 실패가 발행을 막지 않도록 격리.
  let reaped = { instagram: 0, youtube: 0 };
  try {
    reaped = await reapStalePublishing();
  } catch (e) {
    console.error("[instagram-publish] 고아 회수 실패:", e instanceof Error ? e.message : String(e));
  }

  // 킬스위치가 켜져 있으면 아무 것도 PUBLISHING로 선점하지 않는다(선점 후 스킵 시 QUEUED 복구 로직 불필요).
  if (await isAutopostPaused()) {
    return Response.json({ status: "ok", paused: true, published: 0, reaped });
  }

  const now = new Date();
  const due = await prisma.instagramPost.findMany({
    where: { status: IgPostStatus.QUEUED, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true },
  });

  const published: string[] = [];
  const failed: { id: string; reason: string }[] = [];

  for (const { id } of due) {
    // 원자 선점: QUEUED → PUBLISHING. 0건이면 다른 실행이 가져감(스킵).
    const claim = await prisma.instagramPost.updateMany({
      where: { id, status: IgPostStatus.QUEUED },
      data: { status: IgPostStatus.PUBLISHING },
    });
    if (claim.count === 0) continue;

    const post = await prisma.instagramPost.findUnique({
      where: { id },
      select: { id: true, kind: true, caption: true, mediaJson: true },
    });
    if (!post) continue;

    const media = (Array.isArray(post.mediaJson) ? (post.mediaJson as MediaEntry[]) : []);

    try {
      let result;
      if (post.kind === "REELS") {
        // 릴스 발행 경로 — mediaJson[0].videoUrl. 이미지 캐러셀 경로와 분리.
        const videoUrl = media.map((m) => (typeof m?.videoUrl === "string" ? m.videoUrl : null)).find((u): u is string => !!u);
        if (!videoUrl) throw new Error("릴스 동영상 URL이 없습니다(mediaJson.videoUrl 비정상)");
        result = await publishInstagramReel({ videoUrl, caption: post.caption });
      } else {
        const imageUrls = media
          .map((m) => (typeof m?.renderedUrl === "string" ? m.renderedUrl : null))
          .filter((u): u is string => !!u);
        if (imageUrls.length === 0) throw new Error("렌더 이미지 URL이 없습니다(mediaJson 비정상)");
        result = await publishInstagramPost({ imageUrls, caption: post.caption });
      }

      if (result.ok) {
        await prisma.instagramPost.update({
          where: { id },
          data: {
            status: IgPostStatus.PUBLISHED,
            igMediaId: result.mediaId,
            igPermalink: result.permalink,
            publishedAt: new Date(),
            failReason: null,
          },
        });
        await writeAuditLog({
          userId: null,
          action: "UPDATE",
          entity: "InstagramPost",
          entityId: id,
          changes: {
            status: { old: "PUBLISHING", new: "PUBLISHED" },
            igMediaId: { new: result.mediaId },
            igPermalink: { new: result.permalink },
          },
        });
        published.push(id);
      } else if ("skipped" in result && result.skipped) {
        // 킬스위치가 발행 직전 켜진 경우 — QUEUED로 되돌려 다음 실행 재시도.
        await prisma.instagramPost.update({
          where: { id },
          data: { status: IgPostStatus.QUEUED },
        });
      } else {
        throw new Error(result.reason);
      }
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await prisma.instagramPost.update({
        where: { id },
        data: { status: IgPostStatus.FAILED, failReason: reason },
      });
      await writeAuditLog({
        userId: null,
        action: "UPDATE",
        entity: "InstagramPost",
        entityId: id,
        changes: { status: { old: "PUBLISHING", new: "FAILED" }, failReason: { new: reason } },
      });
      failed.push({ id, reason });
    }
  }

  // 실패분 운영자 경보(장애 축 — 인앱 벨 + Zalo 그룹, 킬스위치는 Zalo에만 적용).
  if (failed.length > 0) {
    await notifyMarketing({
      kind: "IG_PUBLISH_FAILED",
      summary: `인스타 발행 ${failed.length}건이 실패했습니다. 마케팅 큐에서 사유를 확인하세요.`,
      href: "/marketing/instagram",
    });
  }

  return Response.json({
    status: "ok",
    published: published.length,
    failed: failed.length,
    failures: failed,
    reaped, // 이번 실행에서 FAILED로 회수한 고아 건수(instagram/youtube)
  });
}

export { handle as GET, handle as POST };
