// 유튜브 편집 잡 보조 cron (marketing-s2 §A-3) — 미실행 PENDING 잔류분 처리 + PROCESSING 고아 회수.
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(첫 줄 게이트).
// 흐름:
//   ① PROCESSING 10분 초과 고아(크래시 잔재) → FAILED + editError(경보).
//   ② PENDING 잔류분(생성 후 수동 미실행) → 소량 배치(≤2건) 렌더. PENDING→PROCESSING 원자 락 후 실행.
// ★ 등록은 OPS 몫(예: 15분 간격). 정상 경로는 run 라우트(운영자 수동)라 이 cron은 안전망.
// ★ 동기 렌더가 무거워 배치 상한을 낮게 유지(maxDuration 300 내 완료 보장).
import { YtShortStatus, YtEditJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { enqueueInAppForOperators } from "@/lib/inapp-notification";
import { validateEditParams, runYoutubeEditJob } from "@/lib/youtube/edit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ORPHAN_TIMEOUT_MS = 10 * 60 * 1000; // PROCESSING 10분 초과 = 고아
const BATCH_MAX = 2; // 한 실행당 렌더 상한(무거운 동기 작업)

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "youtube-edit-jobs");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  // ① PROCESSING 고아 회수 → FAILED.
  const orphanCutoff = new Date(Date.now() - ORPHAN_TIMEOUT_MS);
  const orphans = await prisma.youtubeShort.findMany({
    where: { editJobStatus: YtEditJobStatus.PROCESSING, updatedAt: { lt: orphanCutoff } },
    select: { id: true },
  });
  for (const { id } of orphans) {
    const res = await prisma.youtubeShort.updateMany({
      where: { id, editJobStatus: YtEditJobStatus.PROCESSING, updatedAt: { lt: orphanCutoff } },
      data: { editJobStatus: YtEditJobStatus.FAILED, editError: "PROCESSING 10분 초과 — 고아 회수(크래시 추정)" },
    });
    if (res.count > 0) {
      await writeAuditLog({
        userId: null,
        action: "UPDATE",
        entity: "YoutubeShort",
        entityId: id,
        changes: { editJobStatus: { old: "PROCESSING", new: "FAILED" }, editError: { new: "orphan-reap" } },
      });
    }
  }

  // ② PENDING 잔류분 소량 처리.
  const pending = await prisma.youtubeShort.findMany({
    where: { editJobStatus: YtEditJobStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take: BATCH_MAX,
    select: { id: true },
  });

  const done: string[] = [];
  const failed: { id: string; reason: string }[] = [];

  for (const { id } of pending) {
    // 원자 락.
    const claim = await prisma.youtubeShort.updateMany({
      where: { id, editJobStatus: YtEditJobStatus.PENDING },
      data: { editJobStatus: YtEditJobStatus.PROCESSING },
    });
    if (claim.count === 0) continue; // 다른 러너 선점

    const short = await prisma.youtubeShort.findUnique({
      where: { id },
      select: { id: true, editParamsJson: true, villa: { select: { name: true } } },
    });
    if (!short) continue;

    try {
      const editParams = validateEditParams(short.editParamsJson);
      const result = await runYoutubeEditJob(editParams, {
        villaName: short.villa?.name ?? null,
        baseName: short.id,
      });
      await prisma.youtubeShort.update({
        where: { id },
        data: {
          videoUrl: result.videoUrl,
          posterUrl: result.posterUrl,
          durationSec: result.durationSec,
          editJobStatus: YtEditJobStatus.DONE,
          editError: null,
          status: YtShortStatus.PENDING_APPROVAL,
        },
      });
      await writeAuditLog({
        userId: null,
        action: "UPDATE",
        entity: "YoutubeShort",
        entityId: id,
        changes: {
          editJobStatus: { old: "PROCESSING", new: "DONE" },
          status: { new: "PENDING_APPROVAL" },
          durationSec: { new: result.durationSec },
        },
      });
      done.push(id);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await prisma.youtubeShort.update({
        where: { id },
        data: { editJobStatus: YtEditJobStatus.FAILED, editError: reason },
      });
      await writeAuditLog({
        userId: null,
        action: "UPDATE",
        entity: "YoutubeShort",
        entityId: id,
        changes: { editJobStatus: { old: "PROCESSING", new: "FAILED" }, editError: { new: reason } },
      });
      failed.push({ id, reason });
    }
  }

  // 완료·실패·고아 경보(운영자 인앱).
  if (done.length > 0) {
    try {
      await enqueueInAppForOperators({
        type: "YT_EDIT_DONE",
        title: "🎬 유튜브 편집 완료",
        body: `직접 촬영 편집 ${done.length}건이 완성되었습니다. 승인 화면에서 확인하세요.`,
        href: "/marketing/youtube",
      });
    } catch {
      /* noop */
    }
  }
  if (failed.length > 0 || orphans.length > 0) {
    try {
      await enqueueInAppForOperators({
        type: "YT_EDIT_FAILED",
        title: "⚠️ 유튜브 편집 실패",
        body: `편집 ${failed.length + orphans.length}건이 실패했습니다. 마케팅 큐에서 사유를 확인하고 재실행하세요.`,
        href: "/marketing/youtube",
      });
    } catch {
      /* noop */
    }
  }

  return Response.json({
    status: "ok",
    orphansReaped: orphans.length,
    processed: pending.length,
    done: done.length,
    failed: failed.length,
  });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
