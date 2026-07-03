// 공급자 빌라 이벤트 → 운영자 통지 (T-admin-supplier-visibility)
// 신규 등록/재제출(VILLA_PENDING_REVIEW)·승인 후 콘텐츠 수정(VILLA_CONTENT_UPDATED).
// 판매가·마진·원가 등 금액 정보는 payload에 절대 미포함.
import { NotificationType, type Prisma, type PrismaClient } from "@prisma/client";
import { enqueueNotification } from "@/lib/zalo";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** 운영자 통지 대상 — 직접예약 통지(roster-reminder 패턴)와 동일하게 STAFF 포함 */
const OPERATOR_ROLES = ["OWNER", "MANAGER", "STAFF", "ADMIN"] as const;

export async function findNotifiableOperators(db: DbClient): Promise<{ id: string }[]> {
  return db.user.findMany({
    where: {
      role: { in: [...OPERATOR_ROLES] },
      isActive: true,
      zaloUserId: { not: null },
    },
    select: { id: true },
  });
}

/** 빌라 신규 등록·반려 후 재제출 → 운영자 전원 통지. 운영자 0명(미연결)이어도 정상(정보성). */
export async function notifyOperatorsVillaPendingReview(
  db: DbClient,
  params: { villaId: string; villaName: string; supplierName: string; resubmitted: boolean }
): Promise<void> {
  const operators = await findNotifiableOperators(db);
  for (const op of operators) {
    await enqueueNotification({
      db,
      userId: op.id,
      type: NotificationType.VILLA_PENDING_REVIEW,
      payload: {
        villaId: params.villaId,
        villaName: params.villaName,
        supplierName: params.supplierName,
        resubmitted: params.resubmitted,
      },
    });
  }
}

export type VillaContentKind = "PHOTOS" | "AMENITIES" | "INFO";

/**
 * 라우트용 래퍼 — 공급자(SUPPLIER)가 승인(ACTIVE)된 빌라를 수정했을 때만 통지.
 * PENDING_REVIEW(마법사·재제출 중)·운영자 자신의 수정은 스킵. best-effort(throw 안 함).
 */
export async function maybeNotifyVillaContentUpdated(
  db: DbClient,
  params: { villaId: string; kind: VillaContentKind; actorRole: string }
): Promise<void> {
  if (params.actorRole !== "SUPPLIER") return;
  try {
    const villa = await db.villa.findUnique({
      where: { id: params.villaId },
      select: { status: true, name: true },
    });
    if (!villa || villa.status !== "ACTIVE") return;
    await notifyOperatorsVillaContentUpdated(db, {
      villaId: params.villaId,
      villaName: villa.name,
      kind: params.kind,
    });
  } catch {
    // 통지는 정보성 — 실패해도 본 mutation 성공에 영향 없음
  }
}

/**
 * 승인(ACTIVE)된 빌라의 공급자 콘텐츠 수정 → 운영자 통지.
 * 스팸 방지: 같은 빌라·같은 항목(kind)의 미발송(PENDING) 알림이 이미 있으면 스킵
 * (사진 연속 업로드 등 1건으로 수렴). 발송 후 재수정은 새 알림.
 */
export async function notifyOperatorsVillaContentUpdated(
  db: DbClient,
  params: { villaId: string; villaName: string; kind: VillaContentKind }
): Promise<void> {
  const pending = await db.notification.findFirst({
    where: {
      type: NotificationType.VILLA_CONTENT_UPDATED,
      status: "PENDING",
      AND: [
        { payload: { path: ["villaId"], equals: params.villaId } },
        { payload: { path: ["kind"], equals: params.kind } },
      ],
    },
    select: { id: true },
  });
  if (pending) return;

  const operators = await findNotifiableOperators(db);
  for (const op of operators) {
    await enqueueNotification({
      db,
      userId: op.id,
      type: NotificationType.VILLA_CONTENT_UPDATED,
      payload: {
        villaId: params.villaId,
        villaName: params.villaName,
        kind: params.kind,
      },
    });
  }
}
