// 유튜브 편집 잡 러너 cron (marketing-s2 §A-3 → villa-clip-narration-p2에서 **주 실행 경로로 승격**).
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(첫 줄 게이트).
// 흐름:
//   ① PROCESSING 고아(크래시 잔재) → FAILED + editError(경보).
//   ② PENDING 대기분 → 1건씩 렌더. PENDING→PROCESSING 원자 락 후 실행.
//
// ★ 2026-07-22 역할 변경: 예전엔 run 라우트(동기)가 정상 경로고 이 cron이 안전망이었다.
//   나레이션 투어 영상은 렌더가 2.5~8분이라 동기 실행이 브라우저 타임아웃에 걸린다
//   → run 라우트는 큐잉만(202) 하고, **실제 렌더는 여기서 한다.**
//
// ★ 배치 1건 고정: 렌더 1건이 최대 8분이라 2건이면 한 실행에서 절대 못 끝낸다.
//   여러 건이 밀리면 다음 주기가 이어받는다(주기 5분 권장 — docs/ops/cron-registration.md).
// ★ 고아 판정 25분: 정상 렌더(최대 8분)를 실행 중에 죽이면 안 된다. 여유를 3배로 둔다.
//   예전 10분은 동기 렌더 기준이라 긴 렌더가 살아있는데도 FAILED로 회수될 수 있었다.
import { YtShortStatus, YtEditJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyMarketing } from "@/lib/marketing-notify";
import { validateEditParams, runYoutubeEditJob } from "@/lib/youtube/edit";

export const dynamic = "force-dynamic";
export const maxDuration = 900; // 렌더 최대 8분 + 여유

const ORPHAN_TIMEOUT_MS = 25 * 60 * 1000; // PROCESSING 25분 초과 = 고아(정상 렌더 최대 8분의 3배 여유)
const BATCH_MAX = 1; // 한 실행 = 한 렌더. 2건이면 한 주기에 못 끝난다(렌더 1건 최대 8분)

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
      data: {
        editJobStatus: YtEditJobStatus.FAILED,
        editError: `PROCESSING ${ORPHAN_TIMEOUT_MS / 60000}분 초과 — 고아 회수(크래시 추정)`,
      },
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

  // 완료·실패·고아 경보.
  // ★ notifyMarketing(인앱+Zalo 그룹) 사용 — 예전엔 여기서 인앱만 보냈다. 그때는 run 라우트(동기)가
  //   정상 경로라 Zalo 알림은 그쪽이 담당했는데, 이제 렌더가 전부 이 cron에서 일어나므로
  //   인앱만 보내면 **운영자가 Zalo 알림을 조용히 못 받게 된다**(알림 채널 누락).
  if (done.length > 0) {
    try {
      await notifyMarketing({
        kind: "YT_EDIT_DONE",
        title: "🎬 유튜브 편집 완료",
        summary: `직접 촬영 편집 ${done.length}건이 완성되었습니다. 승인 화면에서 미리보기 후 발행하세요.`,
        href: "/marketing/youtube",
      });
    } catch {
      /* 알림 실패는 본 처리 무관 */
    }
  }
  if (failed.length > 0 || orphans.length > 0) {
    try {
      await notifyMarketing({
        kind: "YT_EDIT_FAILED",
        title: "⚠️ 유튜브 편집 실패",
        summary: `편집 ${failed.length + orphans.length}건이 실패했습니다. 마케팅 큐에서 사유를 확인하고 재실행하세요.`,
        href: "/marketing/youtube",
      });
    } catch {
      /* 알림 실패는 본 처리 무관 */
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
