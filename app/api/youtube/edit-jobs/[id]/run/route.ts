// POST /api/youtube/edit-jobs/[id]/run — 편집 잡 **대기열 등록**(비동기). admin.
//
// 권한(첫 줄): isOperator만. body {retry?:true} → FAILED를 PENDING으로 리셋.
//
// ★ 2026-07-22 동기 실행 → 큐잉으로 전환:
//   나레이션 투어 영상(11컷+CTA)은 렌더에 2.5~8분이 걸린다(실측 148~461초).
//   동기 실행은 브라우저·프록시 타임아웃에 걸려 **운영자가 버튼을 눌러도 실패**한다.
//   더 나쁜 건 서버는 계속 렌더 중인데 클라이언트만 끊겨서, 사용자가 재시도하면
//   PROCESSING 락에 막혀 409를 보고 "고장났다"고 판단하게 되는 것.
//   → 이 라우트는 상태만 PENDING으로 만들고 **202로 즉시 반환**한다.
//     실제 렌더는 cron(`/api/cron/youtube-edit-jobs`)이 수행한다(주 실행 경로).
//
// ★ 편집 잡 ≠ 발행 축: editJobStatus(렌더)와 status(발행 라이프사이클)는 분리 유지(TDA).
//   DONE 전이·승인 큐 합류는 cron이 담당한다.
import { NextResponse } from "next/server";
import { YtEditJobStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { canRerender } from "@/lib/youtube/rerender-guard";

export const dynamic = "force-dynamic";


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

  const short = await prisma.youtubeShort.findUnique({
    where: { id },
    select: { id: true, editJobStatus: true, status: true },
  });
  if (!short || short.editJobStatus == null) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // ★ 발행 축 가드(QA H-1): editJobStatus만 보면 **이미 발행된 쇼츠도 재렌더**된다.
  //   그러면 cron 완료 시 status가 PUBLISHED → PENDING_APPROVAL로 되돌아가고 videoUrl이 교체돼,
  //   운영자가 다시 승인하면 **같은 쇼츠가 유튜브에 두 번 업로드**된다(기존 ytVideoId는 덮어써져 고아).
  //   채널이 API 감사 대기 중이라 중복 업로드는 비용이 크다 → 발행 파이프라인에 올라간 건 거부.
  if (!canRerender(short.status)) {
    return NextResponse.json(
      { error: "ALREADY_PUBLISHED", status: short.status },
      { status: 409 }
    );
  }

  // 렌더 진행 중에 다시 큐에 넣으면 산출물과 파라미터가 어긋난다.
  if (short.editJobStatus === YtEditJobStatus.PROCESSING) {
    return NextResponse.json(
      { error: "INVALID_STATE", editJobStatus: short.editJobStatus },
      { status: 409 }
    );
  }

  // 이미 대기 중이면 그대로 둔다(중복 클릭 흡수 — 사용자에겐 성공으로 보인다).
  if (short.editJobStatus === YtEditJobStatus.PENDING) {
    return NextResponse.json({ ok: true, queued: true, editJobStatus: "PENDING" }, { status: 202 });
  }

  // FAILED 재실행은 retry 플래그가 있어야 한다(실수로 실패분을 되살리지 않게).
  // DONE 재렌더는 항상 허용 — 대본을 고친 뒤 다시 만드는 정상 흐름.
  if (short.editJobStatus === YtEditJobStatus.FAILED && !retry) {
    return NextResponse.json(
      { error: "INVALID_STATE", editJobStatus: short.editJobStatus },
      { status: 409 }
    );
  }

  const claim = await prisma.youtubeShort.updateMany({
    where: { id, editJobStatus: { in: [YtEditJobStatus.FAILED, YtEditJobStatus.DONE] } },
    data: { editJobStatus: YtEditJobStatus.PENDING, editError: null },
  });
  if (claim.count === 0) {
    // 그 사이 다른 요청이 상태를 바꿨다(경합) — 현재 상태를 그대로 알려준다.
    const now = await prisma.youtubeShort.findUnique({
      where: { id },
      select: { editJobStatus: true },
    });
    return NextResponse.json(
      { error: "INVALID_STATE", editJobStatus: now?.editJobStatus ?? null },
      { status: 409 }
    );
  }

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "YoutubeShort",
    entityId: id,
    changes: {
      editJobStatus: { old: short.editJobStatus, new: "PENDING" },
      queuedBy: { new: retry ? "retry" : "rerender" },
    },
  });

  return NextResponse.json(
    { ok: true, queued: true, editJobStatus: "PENDING" },
    { status: 202 }
  );
}
