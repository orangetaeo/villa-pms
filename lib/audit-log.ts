import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";

// 표준 변경 액션 + 공개(게스트)·파트너 특수 신호. AuditLog.action 컬럼은 자유 String이라 스키마 변경 없음.
// GUEST_PAYMENT_NOTICE: 제안 게스트가 계좌이체 후 "입금했어요" 신호(B1). 상태 전이 아님 — 운영자 수동 확정 대조용.
// PARTNER_PAYMENT_NOTICE: 파트너가 청구서/채권 입금 후 "입금했어요" 신호. 동일하게 상태 미변경 — 운영자 수동 확정 대조용.
// PARTNER_CHANGE_REQUEST: 파트너의 예약 취소·변경·홀드연장 "요청" 생성(예약 무변경 — 운영자 승인형 큐).
type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "GUEST_PAYMENT_NOTICE"
  | "PARTNER_PAYMENT_NOTICE"
  | "PARTNER_CHANGE_REQUEST";

interface WriteAuditLogParams {
  userId?: string | null;
  action: AuditAction;
  entity: string;
  entityId: string;
  changes?: Record<string, { old?: unknown; new?: unknown }>;
  /** 트랜잭션 안에서 원자적으로 기록할 때 tx 주입 (기본: 전역 prisma) */
  db?: DbClient;
}

export async function writeAuditLog(params: WriteAuditLogParams): Promise<void> {
  const db = params.db ?? prisma;
  await db.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      // Prisma Json 컬럼: Record<string, ...>를 InputJsonValue로 캐스팅
      changes: params.changes
        ? (params.changes as Parameters<typeof prisma.auditLog.create>[0]["data"]["changes"])
        : undefined,
    },
  });
}
