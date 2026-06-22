import {
  CleaningStatus,
  CleaningType,
  PrismaClient,
  VillaStatus,
} from "@prisma/client";
import { writeAuditLog } from "./audit-log";

/**
 * ADMIN 강제 판매가능 처리 (ADR-0012) — 검수 게이트 오버라이드
 *
 * 배경: 테오 팀이 빌라를 직접 검수·촬영해 올리는 직접 온보딩 모델로 전환되면서,
 * 기존 검수 게이트(공급자 청소사진 제출 → ADMIN 승인)가 초기 등록을 막는다.
 * 이 모듈은 **사업 핵심 원칙 3(검수 게이트)을 의식적으로 푸는 ADMIN 전용 오버라이드**다.
 * 전량 감사 로그(reason 필수 권장)로 정당화한다.
 *
 * - 게이트 단일 setter 원칙(`approveCleaningTask`)을 의도적으로 보완하는 별도 경로 (ADR-0012).
 * - lib/cleaning.ts(게이트 단일 소스)는 절대 수정하지 않는다 — 본 모듈이 독립 경로.
 * - CHECKOUT 태스크(실 청소 필요분)는 절대 건드리지 않는다 — 미결 시 경고만 기록.
 */

export class VillaGateError extends Error {
  constructor(
    message: string,
    readonly kind: "NOT_FOUND" | "INVALID_STATUS",
    readonly current?: VillaStatus
  ) {
    super(message);
    this.name = "VillaGateError";
  }
}

// ===================== 순수 가드 층 (단위 테스트 대상) =====================

/**
 * 강제 개방을 허용하는 빌라 상태 판정 — ACTIVE만 허용.
 * PENDING_REVIEW·REJECTED·INACTIVE·DRAFT는 승인되지 않았거나 운영 중이 아니므로
 * 판매가능으로 만들면 안 된다.
 */
export function canForceOpenForStatus(status: VillaStatus): boolean {
  return status === VillaStatus.ACTIVE;
}

/** 강제 개방 시 인박스 큐에서 정리(APPROVED)할 미결 검수 상태 — CHECKOUT 정리에는 쓰지 않음 */
export const RESOLVABLE_INSPECTION_STATUSES = [
  CleaningStatus.PENDING,
  CleaningStatus.PHOTOS_SUBMITTED,
  CleaningStatus.REJECTED,
] as const;

// ===================== DB 층 =====================

export interface ForceOpenResult {
  villaId: string;
  isSellable: true;
  /** 호출 시점에 이미 isSellable=true였으면 true (멱등 no-op) */
  gateAlreadyOpen: boolean;
  /** APPROVED로 정리된 초기/정기 검수 태스크 수 */
  resolvedTaskCount: number;
  /** 미결 CHECKOUT 태스크가 남아 있으면 true (운영자 인지용 — 정리는 안 함) */
  openCheckoutWarning: boolean;
}

/**
 * ADMIN 강제 판매가능 처리 — 단일 트랜잭션.
 *
 * 가드: 빌라 존재 + status === ACTIVE. 그 외는 VillaGateError(route가 404/409 매핑).
 * 멱등: 이미 isSellable === true면 no-op(gateAlreadyOpen=true). 변경 없으니 AuditLog도 미기록.
 *
 * 동작:
 *  - villa.isSellable = true
 *  - 미결 초기/정기(PERIODIC, bookingId=null, status ∈ {PENDING, PHOTOS_SUBMITTED, REJECTED})
 *    태스크를 APPROVED로 정리 (인박스 큐 정리, 검수 생략) — CHECKOUT은 보존
 *  - 미결 CHECKOUT(OPEN 상태)이 있으면 openCheckoutWarning=true 기록 (정리하지 않음)
 *  - AuditLog: Villa UPDATE(FORCED_OPEN) + 정리한 CleaningTask 묶음 UPDATE
 */
export async function forceOpenSellableGate(
  prisma: PrismaClient,
  input: { villaId: string; actorUserId: string; reason: string }
): Promise<ForceOpenResult> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id: input.villaId },
      select: { id: true, status: true, isSellable: true },
    });
    if (!villa) {
      throw new VillaGateError(
        `빌라를 찾을 수 없습니다: ${input.villaId}`,
        "NOT_FOUND"
      );
    }
    if (!canForceOpenForStatus(villa.status)) {
      throw new VillaGateError(
        `강제 판매가능 처리는 ACTIVE 빌라만 가능합니다 (현재: ${villa.status})`,
        "INVALID_STATUS",
        villa.status
      );
    }

    // 미결 CHECKOUT 경고 — 실 청소 필요분은 보존, 운영자에게만 인지시킨다
    const openCheckoutCount = await tx.cleaningTask.count({
      where: {
        villaId: villa.id,
        type: CleaningType.CHECKOUT,
        status: { in: [...RESOLVABLE_INSPECTION_STATUSES] },
      },
    });
    const openCheckoutWarning = openCheckoutCount > 0;

    // 멱등 no-op — 이미 열려 있으면 변경·로그 없이 반환
    if (villa.isSellable) {
      return {
        villaId: villa.id,
        isSellable: true as const,
        gateAlreadyOpen: true,
        resolvedTaskCount: 0,
        openCheckoutWarning,
      };
    }

    // 게이트 강제 개방
    await tx.villa.update({
      where: { id: villa.id },
      data: { isSellable: true },
    });

    // 미결 초기/정기 검수 태스크 정리 (CHECKOUT 제외) — 인박스 큐 청소
    const resolvableTasks = await tx.cleaningTask.findMany({
      where: {
        villaId: villa.id,
        type: CleaningType.PERIODIC,
        bookingId: null,
        status: { in: [...RESOLVABLE_INSPECTION_STATUSES] },
      },
      select: { id: true, status: true },
    });

    if (resolvableTasks.length > 0) {
      await tx.cleaningTask.updateMany({
        where: { id: { in: resolvableTasks.map((t) => t.id) } },
        data: {
          status: CleaningStatus.APPROVED,
          approvedBy: input.actorUserId,
          approvedAt: now,
          rejectNote: "강제 판매가능 — 검수 생략",
        },
      });

      // 정리분 묶음 AuditLog (CleaningTask)
      for (const task of resolvableTasks) {
        await writeAuditLog({
          db: tx,
          userId: input.actorUserId,
          action: "UPDATE",
          entity: "CleaningTask",
          entityId: task.id,
          changes: {
            status: { old: task.status, new: CleaningStatus.APPROVED },
            forcedResolution: { new: "강제 판매가능 — 검수 생략" },
          },
        });
      }
    }

    // 게이트 강제 개방 감사 로그 (Villa)
    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "Villa",
      entityId: villa.id,
      changes: {
        isSellableGate: { old: "CLOSED", new: "FORCED_OPEN" },
        reason: { new: input.reason },
        resolvedInspectionTasks: { new: resolvableTasks.length },
        ...(openCheckoutWarning ? { openCheckoutWarning: { new: true } } : {}),
      },
    });

    return {
      villaId: villa.id,
      isSellable: true as const,
      gateAlreadyOpen: false,
      resolvedTaskCount: resolvableTasks.length,
      openCheckoutWarning,
    };
  });
}
