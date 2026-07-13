// 공급자 빌라 이벤트 → 운영자 통지 (T-admin-supplier-visibility)
// 신규 등록/재제출(VILLA_PENDING_REVIEW)·승인 후 콘텐츠 수정(VILLA_CONTENT_UPDATED).
// 판매가·마진·원가 등 금액 정보는 payload에 절대 미포함.
import { NotificationType, type Prisma, type PrismaClient } from "@prisma/client";
import { enqueueOperatorNotification, findNotifiableOperators } from "@/lib/operator-notify";

type DbClient = PrismaClient | Prisma.TransactionClient;

// findNotifiableOperators는 lib/operator-notify로 이동(단일 원천). 기존 import 경로 호환을 위해 재노출.
export { findNotifiableOperators };

/** 빌라 신규 등록·반려 후 재제출 → 운영자 전원 통지. 운영자 0명(미연결)이어도 정상(정보성). */
export async function notifyOperatorsVillaPendingReview(
  db: DbClient,
  params: { villaId: string; villaName: string; supplierName: string; resubmitted: boolean }
): Promise<void> {
  // 규모 요약(단지·침실·욕실·정원·사진 수) — 알림만으로 검토 우선순위 판단용. 금액 필드 미조회.
  const villa = await db.villa.findUnique({
    where: { id: params.villaId },
    select: {
      complex: true,
      bedrooms: true,
      bathrooms: true,
      maxGuests: true,
      _count: { select: { photos: true } },
    },
  });
  // 운영자 알림 — 그룹 설정 시 그룹방 1건, 미설정 시 개별 DM fan-out (ADR-0040)
  await enqueueOperatorNotification({
    db,
    type: NotificationType.VILLA_PENDING_REVIEW,
    payload: {
      villaId: params.villaId,
      villaName: params.villaName,
      supplierName: params.supplierName,
      resubmitted: params.resubmitted,
      ...(villa
        ? {
            complex: villa.complex,
            bedrooms: villa.bedrooms,
            bathrooms: villa.bathrooms,
            maxGuests: villa.maxGuests,
            photoCount: villa._count.photos,
          }
        : {}),
    },
  });
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

  // 운영자 알림 — 그룹 설정 시 그룹방 1건, 미설정 시 개별 DM fan-out (ADR-0040)
  await enqueueOperatorNotification({
    db,
    type: NotificationType.VILLA_CONTENT_UPDATED,
    payload: {
      villaId: params.villaId,
      villaName: params.villaName,
      kind: params.kind,
    },
  });
}
