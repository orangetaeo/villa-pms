// 유튜브 쇼츠 발행(업로드) cron (youtube-shorts-s1)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(첫 줄 게이트).
// 흐름: QUEUED && scheduledAt<=now → updateMany로 PUBLISHING 선점(중복 업로드 락) → videos.insert
//   → 성공: PUBLISHED+ytVideoId+ytPrivacyStatus+publishedAt / 실패: FAILED+failReason+운영자 경보(YT_PUBLISH_FAILED). AuditLog.
//
// ★ 동시성 락: updateMany where {status:QUEUED} → data {status:PUBLISHING} 원자 선점. affected 0이면 다른 실행이 가져감(스킵).
// ★ 킬스위치/상한 스킵 시 QUEUED 복구(인스타 패턴) — 선점 후 uploadYoutubeShort가 skipped면 되돌린다.
import { YtShortStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyMarketing } from "@/lib/marketing-notify";
import { uploadYoutubeShort } from "@/lib/youtube/upload";
import { isYoutubeAutopostPaused } from "@/lib/youtube/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 영상 업로드 × 도래분 — 여유 상한

function toTags(json: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x): x is string => typeof x === "string");
}

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "youtube-publish");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  // 킬스위치가 켜져 있으면 아무 것도 PUBLISHING로 선점하지 않는다(복구 로직 불필요).
  if (await isYoutubeAutopostPaused()) {
    return Response.json({ status: "ok", paused: true, published: 0 });
  }

  const now = new Date();
  const due = await prisma.youtubeShort.findMany({
    where: { status: YtShortStatus.QUEUED, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true },
  });

  const published: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  let skipped = 0;

  for (const { id } of due) {
    // 원자 선점: QUEUED → PUBLISHING. 0건이면 다른 실행이 가져감(스킵).
    const claim = await prisma.youtubeShort.updateMany({
      where: { id, status: YtShortStatus.QUEUED },
      data: { status: YtShortStatus.PUBLISHING },
    });
    if (claim.count === 0) continue;

    const short = await prisma.youtubeShort.findUnique({
      where: { id },
      select: { id: true, title: true, description: true, tags: true, videoUrl: true },
    });
    if (!short) continue;

    try {
      const result = await uploadYoutubeShort({
        videoUrl: short.videoUrl,
        title: short.title,
        description: short.description,
        tags: toTags(short.tags),
      });

      if (result.ok) {
        await prisma.youtubeShort.update({
          where: { id },
          data: {
            status: YtShortStatus.PUBLISHED,
            ytVideoId: result.ytVideoId,
            ytPrivacyStatus: result.privacyStatus,
            publishedAt: new Date(),
            failReason: null,
          },
        });
        await writeAuditLog({
          userId: null,
          action: "UPDATE",
          entity: "YoutubeShort",
          entityId: id,
          changes: {
            status: { old: "PUBLISHING", new: "PUBLISHED" },
            ytVideoId: { new: result.ytVideoId },
            ytPrivacyStatus: { new: result.privacyStatus },
          },
        });
        published.push(id);
      } else if ("skipped" in result && result.skipped) {
        // 킬스위치가 직전 켜졌거나 일 상한 도달 — QUEUED로 되돌려 다음 실행 재시도.
        await prisma.youtubeShort.update({ where: { id }, data: { status: YtShortStatus.QUEUED } });
        skipped++;
      } else {
        throw new Error(result.reason);
      }
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await prisma.youtubeShort.update({
        where: { id },
        data: { status: YtShortStatus.FAILED, failReason: reason },
      });
      await writeAuditLog({
        userId: null,
        action: "UPDATE",
        entity: "YoutubeShort",
        entityId: id,
        changes: { status: { old: "PUBLISHING", new: "FAILED" }, failReason: { new: reason } },
      });
      failed.push({ id, reason });
    }
  }

  // 실패분 운영자 경보(장애 축 — 인앱 벨 + Zalo 그룹, 킬스위치는 Zalo에만 적용).
  if (failed.length > 0) {
    await notifyMarketing({
      kind: "YT_PUBLISH_FAILED",
      summary: `유튜브 쇼츠 ${failed.length}건 업로드가 실패했습니다. 마케팅 큐에서 사유를 확인하세요.`,
      href: "/marketing/youtube",
    });
  }

  return Response.json({ status: "ok", published: published.length, failed: failed.length, skipped, failures: failed });
}

export { handle as GET, handle as POST };
