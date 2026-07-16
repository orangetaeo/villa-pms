// POST /api/youtube/edit-jobs/[id]/run — 편집 잡 동기 실행 (marketing-s2 §A-3). admin.
// 권한(첫 줄): isOperator만. body {retry?:true} → FAILED를 PENDING으로 리셋 후 실행.
// 흐름: (retry면 FAILED→PENDING) → PENDING→PROCESSING 원자 락(중복 실행 방지) → edit.ts 렌더
//   → 성공: videoUrl/posterUrl/durationSec + editJobStatus=DONE + status=PENDING_APPROVAL 전이 + 완료 알림
//   → 실패: editJobStatus=FAILED + editError + 경보. AuditLog.
// ★ 동기 실행(maxDuration 300): FE가 버튼 클릭 후 대기. 편집 1건 수십 초 예상.
// ★ 편집 잡 ≠ 발행 축: editJobStatus(렌더)와 status(발행 라이프사이클)를 함께 전이하되 관심사 분리(TDA).
import { NextResponse } from "next/server";
import { YtShortStatus, YtEditJobStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyMarketing } from "@/lib/marketing-notify";
import { validateEditParams, runYoutubeEditJob } from "@/lib/youtube/edit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  let retry = false;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    retry = b?.retry === true;
  } catch {
    // body 없음 — retry=false 기본.
  }

  // 재실행: FAILED → PENDING 리셋(editError 클리어).
  if (retry) {
    await prisma.youtubeShort.updateMany({
      where: { id, editJobStatus: YtEditJobStatus.FAILED },
      data: { editJobStatus: YtEditJobStatus.PENDING, editError: null },
    });
  }

  // 원자 락: PENDING → PROCESSING. count 0이면 다른 러너가 선점했거나 상태 부적합.
  const claim = await prisma.youtubeShort.updateMany({
    where: { id, editJobStatus: YtEditJobStatus.PENDING },
    data: { editJobStatus: YtEditJobStatus.PROCESSING },
  });
  if (claim.count === 0) {
    const exists = await prisma.youtubeShort.findUnique({
      where: { id },
      select: { editJobStatus: true },
    });
    if (!exists || exists.editJobStatus == null) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ error: "INVALID_STATE", editJobStatus: exists.editJobStatus }, { status: 409 });
  }

  const short = await prisma.youtubeShort.findUnique({
    where: { id },
    select: { id: true, editParamsJson: true, villa: { select: { name: true } } },
  });
  if (!short) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

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
        status: YtShortStatus.PENDING_APPROVAL, // 승인 큐 합류(발행 축 전이)
      },
    });
    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE",
      entity: "YoutubeShort",
      entityId: id,
      changes: {
        editJobStatus: { old: "PROCESSING", new: "DONE" },
        status: { new: "PENDING_APPROVAL" },
        durationSec: { new: result.durationSec },
      },
    });

    // 완료 알림 — 인앱+Zalo 그룹 병행(notifyMarketing 단일 진입점, §D 정합).
    try {
      await notifyMarketing({
        kind: "YT_EDIT_DONE",
        title: "🎬 유튜브 편집 완료",
        summary: `직접 촬영 편집 영상 1건이 완성되었습니다(${result.durationSec}초). 승인 화면에서 미리보기 후 발행하세요.`,
        href: "/marketing/youtube",
      });
    } catch {
      /* 알림 실패는 본 처리 무관 */
    }

    return NextResponse.json({
      ok: true,
      editJobStatus: "DONE",
      status: "PENDING_APPROVAL",
      videoUrl: result.videoUrl,
      posterUrl: result.posterUrl,
      durationSec: result.durationSec,
    });
  } catch (e) {
    const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.youtubeShort.update({
      where: { id },
      data: { editJobStatus: YtEditJobStatus.FAILED, editError: reason },
    });
    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE",
      entity: "YoutubeShort",
      entityId: id,
      changes: { editJobStatus: { old: "PROCESSING", new: "FAILED" }, editError: { new: reason } },
    });
    try {
      await notifyMarketing({
        kind: "YT_EDIT_FAILED",
        summary: "직접 촬영 편집 1건이 실패했습니다. 마케팅 큐에서 사유를 확인하고 재실행하세요.",
        href: "/marketing/youtube",
      });
    } catch {
      /* 알림 실패는 본 처리 무관 */
    }
    return NextResponse.json({ error: "EDIT_FAILED", reason }, { status: 500 });
  }
}
