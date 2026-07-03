import {
  CleaningStatus,
  CleaningType,
  NotificationType,
  PrismaClient,
  type CleaningTask,
} from "@prisma/client";
import type { DbClient } from "./availability";
import { writeAuditLog } from "./audit-log";

/**
 * 청소·검수 게이트 단일 소스 (SPEC F4, 사업 핵심 원칙 3)
 *
 * - 체크아웃 완료 → CleaningTask(CHECKOUT) 자동 생성 + villa.isSellable=false (게이트 닫기)
 * - 사진 제출(PHOTOS_SUBMITTED) → ADMIN 승인(APPROVED) 시에만 게이트 열기 —
 *   단, 같은 빌라에 미결 CHECKOUT 태스크가 남아 있으면 열지 않는다 (PERIODIC 승인 우회 차단)
 * - 반려(REJECTED) → 재업로드 → 재승인 — 게이트는 닫힌 채 유지
 * - 정기 방역(PERIODIC)은 게이트에 영향 없음 (생성·승인 모두)
 * - 알림은 Notification PENDING 큐 적재만 (실발송 T3.5). 기본 수신자는 공급자,
 *   청소자(assignee) 배정 시 청소자 (SPEC CLEANER 운영 방식)
 */

export class CleaningTransitionError extends Error {
  constructor(current: CleaningStatus, next: CleaningStatus) {
    super(`허용되지 않는 상태 전이: ${current} → ${next}`);
    this.name = "CleaningTransitionError";
  }
}

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/** 상태기계 — PENDING→제출, REJECTED→재제출, 제출→승인|반려 외 전이 금지 */
const ALLOWED_TRANSITIONS: Record<CleaningStatus, CleaningStatus[]> = {
  [CleaningStatus.PENDING]: [CleaningStatus.PHOTOS_SUBMITTED],
  [CleaningStatus.PHOTOS_SUBMITTED]: [CleaningStatus.APPROVED, CleaningStatus.REJECTED],
  [CleaningStatus.REJECTED]: [CleaningStatus.PHOTOS_SUBMITTED],
  [CleaningStatus.APPROVED]: [],
};

export function assertCleaningTransition(current: CleaningStatus, next: CleaningStatus): void {
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new CleaningTransitionError(current, next);
  }
}

/** 미결(게이트를 잡고 있는) 상태 — APPROVED만 게이트에서 해제됨 */
export const OPEN_CLEANING_STATUSES = [
  CleaningStatus.PENDING,
  CleaningStatus.PHOTOS_SUBMITTED,
  CleaningStatus.REJECTED,
] as const;

/**
 * 게이트 규칙: 해당 빌라의 미결 CHECKOUT 태스크가 0건일 때만 isSellable=true 허용.
 * (지금 승인하는 태스크는 카운트에서 제외하고 호출할 것)
 */
export function canOpenSellableGate(openCheckoutTaskCount: number): boolean {
  return openCheckoutTaskCount === 0;
}

/**
 * 빌라 품질점수(0~100) — 청소 검수 통과율 (Phase 2, 테오 2026-06-26).
 * 결정된 검수가 0건이면 100(신규 빌라 중립 상위), 아니면 round(100 * 승인 / (승인+반려)).
 * 판매 후순위 정렬 키. 순수 함수(통과율 정의) — 데이터 소스는 recompute가 결정한다.
 */
export function computeQualityScore(approvedCount: number, rejectedCount: number): number {
  const decided = approvedCount + rejectedCount;
  if (decided <= 0) return 100;
  return Math.round((approvedCount / decided) * 100);
}

/**
 * 빌라 qualityScore 재계산·저장 (트랜잭션 주입).
 * v2(누적 반려 이력 가중) — **현재 상태**가 아니라 **AuditLog 누적 검수 이벤트**로 산정한다.
 * 빌라의 CleaningTask가 받은 모든 승인·반려 이벤트(approve/reject가 남긴
 * `changes.status.new` = APPROVED/REJECTED)를 센다. 반려된 검수를 고쳐 재승인해도
 * 과거 반려 이벤트가 분모에 영구히 남으므로, "첫 검수 통과"와 "여러 번 반려 후 통과"가 구분된다.
 * (v1은 현재 status 카운트라 재승인 시 과거 반려가 사라졌음.)
 *
 * ⚠️ approve/reject 트랜잭션에서는 이 이벤트의 writeAuditLog **뒤**에 호출해야
 *    이번 승인·반려가 카운트에 포함된다(같은 tx 내 insert가 후속 count에 보임).
 */
export async function recomputeVillaQualityScore(
  db: DbClient,
  villaId: string
): Promise<number> {
  const tasks = await db.cleaningTask.findMany({
    where: { villaId },
    select: { id: true },
  });
  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length === 0) {
    await db.villa.update({ where: { id: villaId }, data: { qualityScore: 100 } });
    return 100;
  }
  const auditWhere = (decision: CleaningStatus) => ({
    entity: "CleaningTask",
    entityId: { in: taskIds },
    changes: { path: ["status", "new"], equals: decision } as const,
  });
  const [approved, rejected] = await Promise.all([
    db.auditLog.count({ where: auditWhere(CleaningStatus.APPROVED) }),
    db.auditLog.count({ where: auditWhere(CleaningStatus.REJECTED) }),
  ]);
  const qualityScore = computeQualityScore(approved, rejected);
  await db.villa.update({ where: { id: villaId }, data: { qualityScore } });
  return qualityScore;
}

/** 정기 방역 멱등 키 — Asia/Ho_Chi_Minh 기준 YYYY-MM */
export function monthKeyVn(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  })
    .format(date)
    .slice(0, 7);
}

// ===================== DB 층 =====================

/** 알림 수신자 — 청소자 배정 시 청소자, 없으면 공급자 (SPEC CLEANER 운영 방식) */
function notifyTargetUserId(task: { assigneeId: string | null }, supplierId: string): string {
  return task.assigneeId ?? supplierId;
}

/**
 * 체크아웃 청소 태스크 생성 + 게이트 닫기 — T3.3 체크아웃 트랜잭션 안에서 호출 (tx 주입).
 * SPEC F4 체크아웃 4: "CleaningTask(CHECKOUT) 자동 생성 + villa.isSellable=false"
 */
export async function createCheckoutCleaningTask(
  db: DbClient,
  input: { bookingId: string; actorUserId: string | null; now: Date }
): Promise<CleaningTask> {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      villaId: true,
      checkOut: true,
      // cleanerId: 빌라 청소 담당자(있으면 배정·알림 대상). 없으면 공급자 폴백.
      villa: { select: { supplierId: true, cleanerId: true, name: true } },
    },
  });
  if (!booking) throw new Error(`예약을 찾을 수 없습니다: ${input.bookingId}`);

  const task = await db.cleaningTask.create({
    data: {
      villaId: booking.villaId,
      bookingId: booking.id,
      type: CleaningType.CHECKOUT,
      status: CleaningStatus.PENDING,
      dueDate: booking.checkOut,
      // 빌라 청소 담당자에게 자동 배정(없으면 null = 공급자 담당 폴백).
      assigneeId: booking.villa.cleanerId,
    },
  });

  // 게이트 닫기 — 검수 승인 전 판매 금지
  await db.villa.update({
    where: { id: booking.villaId },
    data: { isSellable: false },
  });

  await db.notification.create({
    data: {
      // 청소 요청 알림 — 담당자(cleanerId) 있으면 담당자, 없으면 공급자.
      userId: booking.villa.cleanerId ?? booking.villa.supplierId,
      type: NotificationType.CLEANING_REQUEST,
      payload: {
        cleaningTaskId: task.id,
        villaId: booking.villaId,
        villaName: booking.villa.name,
        dueDate: booking.checkOut.toISOString().slice(0, 10),
      },
    },
  });

  await writeAuditLog({
    db,
    userId: input.actorUserId,
    action: "CREATE",
    entity: "CleaningTask",
    entityId: task.id,
    changes: {
      type: { new: CleaningType.CHECKOUT },
      bookingId: { new: booking.id },
      isSellableGate: { old: undefined, new: "CLOSED" },
    },
  });

  return task;
}

/** 청소 사진 제출 — PENDING·REJECTED → PHOTOS_SUBMITTED. 권한 스코프는 route 책임 */
export async function submitCleaningPhotos(
  prisma: PrismaClient,
  input: {
    taskId: string;
    photoUrls: string[];
    /** photoUrls와 병렬인 슬롯 id — 검수 페어링 정렬용. 구클라이언트는 미전달(빈 배열 저장) */
    photoSlots?: string[];
    actorUserId: string;
  }
): Promise<CleaningTask> {
  if (input.photoUrls.length < 1) throw new RangeError("청소 사진은 1장 이상 필요합니다");
  const photoSlots =
    input.photoSlots && input.photoSlots.length === input.photoUrls.length
      ? input.photoSlots
      : [];

  return prisma.$transaction(async (tx) => {
    const task = await tx.cleaningTask.findUnique({
      where: { id: input.taskId },
      select: { id: true, status: true },
    });
    if (!task) throw new Error(`청소 태스크를 찾을 수 없습니다: ${input.taskId}`);
    assertCleaningTransition(task.status, CleaningStatus.PHOTOS_SUBMITTED);

    // status 가드 — 동시 제출·승인 경합에서 한쪽만 승리
    const guarded = await tx.cleaningTask.updateMany({
      where: { id: task.id, status: task.status },
      data: { status: CleaningStatus.PHOTOS_SUBMITTED, photoUrls: input.photoUrls, photoSlots },
    });
    if (guarded.count !== 1) {
      throw new CleaningTransitionError(task.status, CleaningStatus.PHOTOS_SUBMITTED);
    }
    const updated = await tx.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });

    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "CleaningTask",
      entityId: task.id,
      changes: {
        status: { old: task.status, new: CleaningStatus.PHOTOS_SUBMITTED },
        photoCount: { new: input.photoUrls.length },
      },
    });

    return updated;
  });
}

/**
 * ADMIN 승인 — PHOTOS_SUBMITTED → APPROVED. 게이트 규칙 통과 시 villa.isSellable=true.
 * 게이트 개방 조건 (ADR-0006 개정): ① CHECKOUT 승인 또는 ② 빌라의 첫 APPROVED 승인
 * (초기 검수·기존 ACTIVE 빌라의 첫 월간 검수 — 닭과 달걀 해소). 두 경우 모두
 * 미결 CHECKOUT 0건 조건을 통과해야 한다. 그 외 PERIODIC 승인은 게이트에 영향 없음.
 */
export async function approveCleaningTask(
  prisma: PrismaClient,
  input: { taskId: string; actorUserId: string; now: Date }
): Promise<{ task: CleaningTask; gateOpened: boolean }> {
  return prisma.$transaction(async (tx) => {
    const task = await tx.cleaningTask.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        status: true,
        type: true,
        villaId: true,
        assigneeId: true,
        villa: { select: { supplierId: true, name: true } },
      },
    });
    if (!task) throw new Error(`청소 태스크를 찾을 수 없습니다: ${input.taskId}`);
    assertCleaningTransition(task.status, CleaningStatus.APPROVED);

    const guarded = await tx.cleaningTask.updateMany({
      where: { id: task.id, status: CleaningStatus.PHOTOS_SUBMITTED },
      data: {
        status: CleaningStatus.APPROVED,
        approvedBy: input.actorUserId,
        approvedAt: input.now,
      },
    });
    if (guarded.count !== 1) {
      throw new CleaningTransitionError(task.status, CleaningStatus.APPROVED);
    }

    // 게이트 열기 판정 (ADR-0006 개정) — ① CHECKOUT 승인 또는 ② 빌라의 첫 APPROVED
    // (이번 건 제외 0건 — 초기 검수·기존 ACTIVE 빌라의 첫 검수). PERIODIC만으로는
    // CHECKOUT 게이트를 우회하지 못하도록 미결 CHECKOUT 0건 조건은 공통 적용
    let gateOpened = false;
    const isFirstApproved =
      task.type !== CleaningType.CHECKOUT &&
      (await tx.cleaningTask.count({
        where: {
          villaId: task.villaId,
          status: CleaningStatus.APPROVED,
          id: { not: task.id },
        },
      })) === 0;
    if (task.type === CleaningType.CHECKOUT || isFirstApproved) {
      const openCheckoutCount = await tx.cleaningTask.count({
        where: {
          villaId: task.villaId,
          type: CleaningType.CHECKOUT,
          status: { in: [...OPEN_CLEANING_STATUSES] },
          id: { not: task.id },
        },
      });
      if (canOpenSellableGate(openCheckoutCount)) {
        await tx.villa.update({
          where: { id: task.villaId },
          data: { isSellable: true },
        });
        gateOpened = true;
      }
    }

    await tx.notification.create({
      data: {
        userId: notifyTargetUserId(task, task.villa.supplierId),
        type: NotificationType.CLEANING_APPROVED,
        payload: {
          cleaningTaskId: task.id,
          villaId: task.villaId,
          villaName: task.villa.name,
        },
      },
    });
    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "CleaningTask",
      entityId: task.id,
      changes: {
        status: { old: CleaningStatus.PHOTOS_SUBMITTED, new: CleaningStatus.APPROVED },
        isSellableGate: { new: gateOpened ? "OPENED" : "UNCHANGED" },
      },
    });

    // 품질점수 재계산 — 위 audit 기록 뒤에 호출해야 이번 승인이 누적 카운트에 포함됨(v2)
    await recomputeVillaQualityScore(tx, task.villaId);

    const updated = await tx.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
    return { task: updated, gateOpened };
  });
}

/** ADMIN 반려 — PHOTOS_SUBMITTED → REJECTED(사유 필수). 게이트는 닫힌 채 유지 */
export async function rejectCleaningTask(
  prisma: PrismaClient,
  input: { taskId: string; rejectNote: string; actorUserId: string }
): Promise<CleaningTask> {
  const note = input.rejectNote.trim();
  if (!note) throw new RangeError("반려 사유(rejectNote)는 필수입니다");

  return prisma.$transaction(async (tx) => {
    const task = await tx.cleaningTask.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        status: true,
        villaId: true,
        assigneeId: true,
        villa: { select: { supplierId: true, name: true } },
      },
    });
    if (!task) throw new Error(`청소 태스크를 찾을 수 없습니다: ${input.taskId}`);
    assertCleaningTransition(task.status, CleaningStatus.REJECTED);

    const guarded = await tx.cleaningTask.updateMany({
      where: { id: task.id, status: CleaningStatus.PHOTOS_SUBMITTED },
      data: { status: CleaningStatus.REJECTED, rejectNote: note },
    });
    if (guarded.count !== 1) {
      throw new CleaningTransitionError(task.status, CleaningStatus.REJECTED);
    }

    await tx.notification.create({
      data: {
        userId: notifyTargetUserId(task, task.villa.supplierId),
        type: NotificationType.CLEANING_REJECTED,
        payload: {
          cleaningTaskId: task.id,
          villaId: task.villaId,
          villaName: task.villa.name,
          rejectNote: note,
        },
      },
    });
    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "CleaningTask",
      entityId: task.id,
      changes: {
        status: { old: CleaningStatus.PHOTOS_SUBMITTED, new: CleaningStatus.REJECTED },
        rejectNote: { new: note },
      },
    });

    // 품질점수 재계산 — 위 audit 기록 뒤에 호출해야 이번 반려가 누적 카운트에 포함됨(v2)
    await recomputeVillaQualityScore(tx, task.villaId);

    return tx.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
  });
}

export interface PeriodicCleaningSummary {
  createdCount: number;
  skippedCount: number;
  monthKey: string;
}

/**
 * 정기 방역 태스크 생성 (cron 월 1회, ADR-0002 주기 고정) — 같은 달(VN 기준)에
 * 이미 PERIODIC이 있는 빌라는 skip (멱등). 게이트(isSellable)에는 영향 없음.
 */
export async function createPeriodicCleaningTasks(
  prisma: PrismaClient,
  now: Date
): Promise<PeriodicCleaningSummary> {
  const monthKey = monthKeyVn(now);
  // VN 기준 이번 달 시작을 UTC로 — monthKey와 동일 기준으로 기존 태스크 판정
  const villas = await prisma.villa.findMany({
    where: { status: "ACTIVE" },
    // cleanerId: 빌라 청소 담당자(있으면 배정·알림 대상). 없으면 공급자 폴백.
    select: { id: true, supplierId: true, cleanerId: true, name: true },
  });

  let createdCount = 0;
  let skippedCount = 0;
  for (const villa of villas) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.cleaningTask.findFirst({
        where: { villaId: villa.id, type: CleaningType.PERIODIC },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (existing && monthKeyVn(existing.createdAt) === monthKey) {
        skippedCount++;
        return;
      }

      const task = await tx.cleaningTask.create({
        data: {
          villaId: villa.id,
          type: CleaningType.PERIODIC,
          status: CleaningStatus.PENDING,
          // 빌라 청소 담당자에게 자동 배정(없으면 null = 공급자 담당 폴백).
          assigneeId: villa.cleanerId,
        },
      });
      await tx.notification.create({
        data: {
          // 담당자(cleanerId) 있으면 담당자, 없으면 공급자.
          userId: villa.cleanerId ?? villa.supplierId,
          type: NotificationType.CLEANING_REQUEST,
          payload: {
            cleaningTaskId: task.id,
            villaId: villa.id,
            villaName: villa.name,
            periodic: true,
          },
        },
      });
      await writeAuditLog({
        db: tx,
        userId: null, // cron 시스템 처리
        action: "CREATE",
        entity: "CleaningTask",
        entityId: task.id,
        changes: { type: { new: CleaningType.PERIODIC }, monthKey: { new: monthKey } },
      });
      createdCount++;
    });
  }

  return { createdCount, skippedCount, monthKey };
}

// ===================== 초기 검수 (T3.4b — ADR-0006) =====================

/**
 * 신규 빌라 초기 검수 태스크 — 빌라 최초 APPROVE 트랜잭션 안에서 호출 (tx 주입).
 * 닭과 달걀 해소: isSellable 기본 false + setter가 청소 승인뿐 → 첫 판매 경로 부재.
 * 공급자가 현 상태 사진 제출 → ADMIN 승인 → 기존 게이트 메커니즘으로 개방.
 * 멱등: 해당 빌라에 CleaningTask가 1건이라도 있으면 미생성(null) — 재승인·중복 APPROVE 안전.
 * isSellable은 건드리지 않는다 — 게이트 setter는 approveCleaningTask 단일 유지.
 */
export async function createInitialInspectionTask(
  db: DbClient,
  input: { villaId: string; actorUserId: string | null; now: Date }
): Promise<CleaningTask | null> {
  const villa = await db.villa.findUnique({
    where: { id: input.villaId },
    select: { id: true, supplierId: true, name: true },
  });
  if (!villa) throw new Error(`빌라를 찾을 수 없습니다: ${input.villaId}`);

  const existingCount = await db.cleaningTask.count({
    where: { villaId: input.villaId },
  });
  if (existingCount > 0) return null; // 검수 이력 있음 — 초기 검수 불필요 (멱등)

  const task = await db.cleaningTask.create({
    data: {
      villaId: villa.id,
      type: CleaningType.PERIODIC, // 스키마 변경 회피 — 구분은 Notification payload·AuditLog (ADR-0006)
      status: CleaningStatus.PENDING,
    },
  });

  await db.notification.create({
    data: {
      userId: villa.supplierId,
      type: NotificationType.CLEANING_REQUEST,
      payload: {
        cleaningTaskId: task.id,
        villaId: villa.id,
        villaName: villa.name,
        initialInspection: true, // 문구 분기용 (T3.5 발송 템플릿)
      },
    },
  });

  await writeAuditLog({
    db,
    userId: input.actorUserId,
    action: "CREATE",
    entity: "CleaningTask",
    entityId: task.id,
    changes: {
      type: { new: CleaningType.PERIODIC },
      initialInspection: { new: true },
      villaId: { new: villa.id },
    },
  });

  return task;
}
