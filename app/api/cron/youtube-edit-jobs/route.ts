// 유튜브 편집 잡 러너 cron (marketing-s2 §A-3 → villa-clip-narration-p2에서 **주 실행 경로로 승격**).
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(첫 줄 게이트).
// 흐름:
//   ① PROCESSING 고아(크래시 잔재) → FAILED + editError(경보).
//   ② 전역 렌더 락 — 살아있는 PROCESSING이 있으면 이번 주기는 렌더를 건너뛴다(RENDER_BUSY).
//   ③ PENDING 대기분 → 1건씩 렌더. PENDING→PROCESSING 원자 락 후 실행.
//
// ★ 2026-07-22 역할 변경: 예전엔 run 라우트(동기)가 정상 경로고 이 cron이 안전망이었다.
//   나레이션 투어 영상은 렌더가 2.5~8분이라 동기 실행이 브라우저 타임아웃에 걸린다
//   → run 라우트는 큐잉만(202) 하고, **실제 렌더는 여기서 한다.**
//
// ★ 배치 1건 고정: 렌더 1건이 최대 8분이라 2건이면 한 실행에서 절대 못 끝낸다.
//   여러 건이 밀리면 다음 주기가 이어받는다(주기 5분 권장 — docs/ops/cron-registration.md).
// ★ 2026-07-22 전역 락 추가(QA M-7): 배치 1건은 "한 주기 안에서 1건"만 보장할 뿐,
//   **주기 5분 < 렌더 8분**이라 다음 주기가 아직 도는 렌더 옆에서 새 잡을 집어 ffmpeg가 겹쳤다.
//   컨테이너 1대에서 ffmpeg가 2~3개 돌면 렌더끼리 굶고 같은 컨테이너의 웹 요청까지 느려진다
//   → 살아있는 PROCESSING(=고아 아님)이 있으면 이번 주기는 아예 새 잡을 집지 않는다.
// ★ 고아 판정 25분: 정상 렌더(최대 8분)를 실행 중에 죽이면 안 된다. 여유를 3배로 둔다.
//   예전 10분은 동기 렌더 기준이라 긴 렌더가 살아있는데도 FAILED로 회수될 수 있었다.
import { YtShortStatus, YtEditJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyMarketing } from "@/lib/marketing-notify";
import { validateEditParams, runYoutubeEditJob } from "@/lib/youtube/edit";
import { canRerender } from "@/lib/youtube/rerender-guard";
import { buildIntroSpecs } from "@/lib/youtube/narration";
import { isRenderBusy, winsRenderRace } from "@/lib/youtube/render-lock";

export const dynamic = "force-dynamic";
export const maxDuration = 900; // 렌더 최대 8분 + 여유

const ORPHAN_TIMEOUT_MS = 25 * 60 * 1000; // PROCESSING 25분 초과 = 고아(정상 렌더 최대 8분의 3배 여유)
const BATCH_MAX = 1; // 한 실행 = 한 렌더. 2건이면 한 주기에 못 끝난다(렌더 1건 최대 8분)

/** 편집 실패·고아 회수 경보(인앱 + Zalo 그룹). 알림 실패는 본 처리와 무관하게 삼킨다. */
async function notifyEditFailed(count: number) {
  try {
    await notifyMarketing({
      kind: "YT_EDIT_FAILED",
      title: "⚠️ 유튜브 편집 실패",
      summary: `편집 ${count}건이 실패했습니다. 마케팅 큐에서 사유를 확인하고 재실행하세요.`,
      href: "/marketing/youtube",
    });
  } catch {
    /* 알림 실패는 본 처리 무관 */
  }
}

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

  // ② 전역 렌더 락(QA M-7) — 살아있는 PROCESSING = 다른 주기가 아직 ffmpeg를 돌리는 중.
  //   ★ 순서가 계약이다: **고아 회수(①) 다음에** 검사한다. 뒤집으면 크래시로 남은 PROCESSING이
  //     락을 영구 점유해 렌더가 영영 안 도는 데드락이 된다.
  //   ★ 리스 만료 = 고아 컷오프(orphanCutoff)를 **그대로 공유**한다. 두 값이 어긋나면
  //     "고아로 회수되지도 않고 락으로 세지도 않는" 구멍이나 그 반대가 생긴다.
  const liveRenders = await prisma.youtubeShort.count({
    where: { editJobStatus: YtEditJobStatus.PROCESSING, updatedAt: { gte: orphanCutoff } },
  });
  if (isRenderBusy(liveRenders)) {
    // ★ 조기 반환이라도 **고아 경보는 반드시 보낸다**. 아래 알림 블록까지 안 내려가므로
    //   여기서 빠뜨리면 "고아를 회수했는데 운영자는 모르는" 조용한 실패가 된다.
    if (orphans.length > 0) await notifyEditFailed(orphans.length);
    // 락에 걸린 것 자체는 정상 동작이다 — 200으로 돌려준다(cron 실패로 보이면 안 된다).
    return Response.json({
      status: "ok",
      orphansReaped: orphans.length,
      skipped: "RENDER_BUSY",
      activeRenders: liveRenders,
      processed: 0,
      done: 0,
      failed: 0,
    });
  }

  // ③ PENDING 잔류분 소량 처리.
  const pending = await prisma.youtubeShort.findMany({
    where: { editJobStatus: YtEditJobStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take: BATCH_MAX,
    select: { id: true },
  });

  const done: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  const yielded: string[] = [];

  for (const { id } of pending) {
    // 원자 락.
    const claim = await prisma.youtubeShort.updateMany({
      where: { id, editJobStatus: YtEditJobStatus.PENDING },
      data: { editJobStatus: YtEditJobStatus.PROCESSING },
    });
    if (claim.count === 0) continue; // 다른 러너 선점

    // 경합 재검사(M-7) — 위 count 검사와 이 claim은 원자적이지 않다. 두 주기가 거의 동시에
    // 기동하면 서로 **다른** 잡을 claim해 락을 통과할 수 있다. claim 후 한 번 더 보고
    // id 최소값 1건만 진행한다(양쪽 다 양보하면 그 주기가 통째로 비므로 결정적 tie-break).
    const others = await prisma.youtubeShort.findMany({
      where: {
        editJobStatus: YtEditJobStatus.PROCESSING,
        updatedAt: { gte: orphanCutoff },
        id: { not: id },
      },
      select: { id: true },
    });
    if (!winsRenderRace(id, others.map((o) => o.id))) {
      // 패자는 잡을 **PENDING으로 반납**한다(FAILED로 태우면 운영자가 수동 재시도해야 한다).
      await prisma.youtubeShort.updateMany({
        where: { id, editJobStatus: YtEditJobStatus.PROCESSING },
        data: { editJobStatus: YtEditJobStatus.PENDING },
      });
      yielded.push(id);
      continue;
    }

    const short = await prisma.youtubeShort.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        editParamsJson: true,
        villa: { select: { name: true, bedrooms: true, hasPool: true, beachDistanceM: true } },
      },
    });
    if (!short) continue;

    try {
      const editParams = validateEditParams(short.editParamsJson);
      const result = await runYoutubeEditJob(editParams, {
        villaName: short.villa?.name ?? null,
        baseName: short.id,
        // ★ 오프닝 스펙 칩(QA M-6) — 나레이션 훅과 같은 정보를 화면에도 띄운다.
        //   음소거 시청자에게 침실 수·수영장·해변 거리를 전달하는 게 오프닝의 핵심이다.
        introSpecs: short.villa
          ? buildIntroSpecs({
              villaName: short.villa.name,
              bedrooms: short.villa.bedrooms,
              hasPool: short.villa.hasPool,
              beachDistanceM: short.villa.beachDistanceM,
              clips: [],
            })
          : undefined,
      });
      // ★ 발행 축은 **재렌더 가능한 상태일 때만** 승인 큐로 되돌린다(QA H-1 심층 방어).
      //   이미 QUEUED/PUBLISHING/PUBLISHED인 건을 PENDING_APPROVAL로 되돌리면 재승인 →
      //   유튜브 중복 업로드로 이어진다. 큐잉 라우트에서 이미 막지만, 경합·수동 DB 조작으로
      //   PENDING이 된 경우에도 마지막 방어선이 필요하다.
      const resetPublishAxis = canRerender(short.status);
      await prisma.youtubeShort.update({
        where: { id },
        data: {
          videoUrl: result.videoUrl,
          posterUrl: result.posterUrl,
          durationSec: result.durationSec,
          editJobStatus: YtEditJobStatus.DONE,
          editError: null,
          ...(resetPublishAxis ? { status: YtShortStatus.PENDING_APPROVAL } : {}),
        },
      });
      await writeAuditLog({
        userId: null,
        action: "UPDATE",
        entity: "YoutubeShort",
        entityId: id,
        changes: {
          editJobStatus: { old: "PROCESSING", new: "DONE" },
          ...(resetPublishAxis ? { status: { new: "PENDING_APPROVAL" } } : {}),
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

  // 실패·고아 경보만 보낸다.
  //
  // ★ 편집 **완료**(YT_EDIT_DONE) 알림은 발송하지 않는다(테오 2026-07-23).
  //   운영자가 직접 눌러 시작한 작업이라 완료를 굳이 알릴 필요가 없고, 편수가 늘수록
  //   인앱 벨·Zalo 그룹방이 "완료됐습니다"로 도배돼 정작 중요한 ⚠️ 실패 경보가 묻힌다.
  //   결과는 /marketing/youtube 승인 화면에서 바로 확인할 수 있다.
  //   ※ 실패 경보는 그대로 유지 — 자동화 장애는 침묵시키지 않는다(docs/NOTIFICATIONS.md 원칙).
  if (failed.length > 0 || orphans.length > 0) {
    await notifyEditFailed(failed.length + orphans.length);
  }

  return Response.json({
    status: "ok",
    orphansReaped: orphans.length,
    processed: pending.length,
    done: done.length,
    failed: failed.length,
    yielded: yielded.length, // 동시 기동 경합에서 양보하고 PENDING으로 반납한 건수
  });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
