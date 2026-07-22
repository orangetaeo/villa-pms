// 계약 조항 협의 알림 (T-contract-negotiation S2)
//   요청(상대방→운영자 ko) / 해소(운영자→상대방 payload.locale) 두 방향.
//   ★ 타입은 CONTRACT_NEGOTIATION 하나 — 방향은 payload.kind로 분기(타입 증식 금지 교훈, MARKETING_ALERT와 동일 원칙).
//   ★ 금액·원가·마진은 payload에 절대 미포함 — 조항 키·사유 코드·상대 이름만.
import { NotificationType, type Prisma, type PrismaClient } from "@prisma/client";
import { enqueueOperatorNotification } from "@/lib/operator-notify";
import { enqueueNotification } from "@/lib/zalo";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** 상대방이 조항 협의를 요청 → 운영자 전원. best-effort(실패해도 요청 자체는 성공 유지). */
export async function notifyOperatorsNegotiationRequested(
  db: DbClient,
  params: {
    contractId: string;
    negotiationId: string;
    contractType: string;
    counterpartName: string;
    clauseKey: string;
    reason: string;
    hasProposal: boolean;
    note: string | null;
  },
): Promise<void> {
  try {
    await enqueueOperatorNotification({
      db,
      type: NotificationType.CONTRACT_NEGOTIATION,
      payload: {
        kind: "REQUEST",
        contractId: params.contractId,
        negotiationId: params.negotiationId,
        contractType: params.contractType,
        counterpartName: params.counterpartName,
        clauseKey: params.clauseKey,
        reason: params.reason,
        hasProposal: params.hasProposal,
        note: params.note,
      },
    });
  } catch (e) {
    console.error("[contract-negotiation] 협의 요청 운영자 알림 실패", e);
  }
}

/** 운영자가 협의를 수용·거절 → 요청자(상대방). locale은 계약 언어를 따른다. */
export async function notifyCounterpartNegotiationResolved(
  db: DbClient,
  params: {
    userId: string;
    contractId: string;
    negotiationId: string;
    clauseKey: string;
    accepted: boolean;
    termsChanged: boolean;
    resolvedNote: string | null;
    locale: string;
  },
): Promise<void> {
  try {
    await enqueueNotification({
      db,
      userId: params.userId,
      type: NotificationType.CONTRACT_NEGOTIATION,
      payload: {
        kind: "RESOLVED",
        contractId: params.contractId,
        negotiationId: params.negotiationId,
        clauseKey: params.clauseKey,
        accepted: params.accepted,
        termsChanged: params.termsChanged,
        resolvedNote: params.resolvedNote,
        locale: params.locale === "ko" ? "ko" : "vi",
      },
    });
  } catch (e) {
    console.error("[contract-negotiation] 협의 해소 상대방 알림 실패", e);
  }
}
