// 인스타그램 발행 cron (instagram-marketing-p1, 기획 §3-4)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(첫 줄 게이트).
// 흐름: QUEUED && scheduledAt<=now → updateMany로 PUBLISHING 선점(중복 발행 락) → Graph API 발행
//   → 성공: PUBLISHED+igMediaId+igPermalink+publishedAt / 실패: FAILED+failReason+운영자 경보. AuditLog.
//
// ★ 동시성 락: updateMany where {status:QUEUED} → data {status:PUBLISHING} 가 원자적 선점.
//   affected 0이면 다른 실행이 이미 가져간 것(스킵). PUBLISHING로 바뀐 행만 이 실행이 발행한다.
import { IgPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { enqueueInAppForOperators } from "@/lib/inapp-notification";
import { publishInstagramPost } from "@/lib/instagram/publish";
import { isAutopostPaused } from "@/lib/instagram/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 컨테이너 폴링(최대 60s/컨테이너) × 도래분

interface MediaEntry {
  renderedUrl?: unknown;
}

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "instagram-publish");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  // 킬스위치가 켜져 있으면 아무 것도 PUBLISHING로 선점하지 않는다(선점 후 스킵 시 QUEUED 복구 로직 불필요).
  if (await isAutopostPaused()) {
    return Response.json({ status: "ok", paused: true, published: 0 });
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
      select: { id: true, caption: true, mediaJson: true },
    });
    if (!post) continue;

    const media = (Array.isArray(post.mediaJson) ? (post.mediaJson as MediaEntry[]) : []);
    const imageUrls = media
      .map((m) => (typeof m?.renderedUrl === "string" ? m.renderedUrl : null))
      .filter((u): u is string => !!u);

    try {
      if (imageUrls.length === 0) throw new Error("렌더 이미지 URL이 없습니다(mediaJson 비정상)");

      const result = await publishInstagramPost({ imageUrls, caption: post.caption });

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

  // 실패분 운영자 경보(장애 축 — 인앱 직접 적재, 킬스위치 무관).
  if (failed.length > 0) {
    try {
      await enqueueInAppForOperators({
        type: "IG_PUBLISH_FAILED",
        title: "⚠️ 인스타 발행 실패",
        body: `인스타 발행 ${failed.length}건이 실패했습니다. 마케팅 큐에서 사유를 확인하세요.`,
        href: "/marketing/instagram",
      });
    } catch (e) {
      console.error("[cron/instagram-publish] 실패 경보 적재 실패:", e instanceof Error ? e.message : String(e));
    }
  }

  return Response.json({ status: "ok", published: published.length, failed: failed.length, failures: failed });
}

export { handle as GET, handle as POST };
