// ADR-0009 D1/D7.3 — 대화 상대 타입·번역모드 기본값 규칙 (순수 함수, 단위 테스트 대상)
//
// S0 백필 + 신규 대화 분류의 단일 진실원. SQL 백필 스크립트와 의미를 일치시킨다:
//  - 기존 대화(전부 공급자 전제): userId 있으면 SUPPLIER, 없으면 UNKNOWN(공유 잠금 — 보수적).
//  - translateMode: SUPPLIER → VI(베트남인 전제), 그 외 → OFF(오버트랜슬레이션 방지).
import type { ZaloCounterpartyType, ZaloTranslateMode } from "@prisma/client";

/**
 * 기존/신규 대화의 counterpartyType 추론 (ADR D1.5 — 보수적 변형).
 * @param hasMatchedUser ZaloConversation.userId 연결 여부(매칭된 공급자 User)
 */
export function inferCounterpartyType(hasMatchedUser: boolean): ZaloCounterpartyType {
  return hasMatchedUser ? "SUPPLIER" : "UNKNOWN";
}

/**
 * counterpartyType → 기본 translateMode (ADR D7.3).
 * SUPPLIER=VI(공급자는 베트남인 전제), CUSTOMER/UNKNOWN=OFF(한국 여행사·여행객 다수 → 번역 끔).
 */
export function defaultTranslateMode(type: ZaloCounterpartyType): ZaloTranslateMode {
  return type === "SUPPLIER" ? "VI" : "OFF";
}
