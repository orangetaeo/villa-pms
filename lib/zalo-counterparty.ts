// ADR-0009 D1/D7.3 — 대화 상대 타입·번역모드 기본값 규칙 (순수 함수, 단위 테스트 대상)
//
// S0 백필 + 신규 대화 분류의 단일 진실원. SQL 백필 스크립트와 의미를 일치시킨다:
//  - 기존 대화(전부 공급자 전제): userId 있으면 SUPPLIER, 없으면 UNKNOWN(공유 잠금 — 보수적).
//  - translateMode: SUPPLIER → VI(베트남인 전제), 그 외 → OFF(오버트랜슬레이션 방지).
import { Currency } from "@prisma/client";
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

// ── ADR-0009 개정2(R2) — 분류 5종 누수 그룹·통화 (BE/FE 공용 단일 진실원) ──
//
// 누수 그룹(R2-2): 원가측={SUPPLIER}, 판매가측={CUSTOMER,TRAVEL_AGENCY,LAND_AGENCY}, UNKNOWN=잠금.
// 통화(R2-3): CUSTOMER=KRW(직접 소비자), TRAVEL_AGENCY/LAND_AGENCY=VND(여행사·랜드사, ADR-0003 채널 정책).
// 마진은 전 그룹·전 공유에 영구 금지(D2 불변식) — 그룹 판정과 무관하게 select에서 제외.

/**
 * 원가측 여부 (R2-2) — 빌라 공유 시 원가(supplierCostVnd)만, 정산 공유 허용.
 * 현재 원가측은 SUPPLIER 단일이나, 그룹 함수로 표현해 분류 확장에 대비.
 */
export function isCostSideType(type: ZaloCounterpartyType): boolean {
  return type === "SUPPLIER";
}

/**
 * 판매가측 여부 (R2-2) — 빌라 공유 시 판매가만, 제안 공유 허용. 정산 금지.
 * {CUSTOMER, TRAVEL_AGENCY, LAND_AGENCY}.
 */
export function isSellSideType(type: ZaloCounterpartyType): boolean {
  return (
    type === "CUSTOMER" || type === "TRAVEL_AGENCY" || type === "LAND_AGENCY"
  );
}

/**
 * 판매가측 분류 → 빌라 공유 본문 통화 (R2-3).
 * CUSTOMER=KRW, TRAVEL_AGENCY/LAND_AGENCY=VND. 원가측·UNKNOWN은 통화 개념이 없어 throw
 * (호출부는 isSellSideType 게이트 통과 후에만 호출 — 방어적 가드).
 */
export function currencyForType(type: ZaloCounterpartyType): Currency {
  switch (type) {
    case "CUSTOMER":
      return Currency.KRW;
    case "TRAVEL_AGENCY":
    case "LAND_AGENCY":
      return Currency.VND;
    default:
      throw new Error(`currencyForType: not a sell-side type: ${type}`);
  }
}

/** 첨부 메뉴에 노출 가능한 공유 종류 (R2-5) — FE 가시성·서버 게이트 공용. */
export type ShareKind = "PHOTO" | "VILLA" | "PROPOSAL" | "SETTLEMENT";

/**
 * 분류별 허용 공유 종류 (R2-5):
 *  - 원가측(SUPPLIER): 사진 + 빌라 + 정산
 *  - 판매가측(CUSTOMER/TRAVEL_AGENCY/LAND_AGENCY): 사진 + 빌라 + 제안
 *  - UNKNOWN: 사진만(분류 후 활성)
 *  - IGNORED(개인/기타, 업무 상대 아님): 사진만 — UNKNOWN과 동일 잠금, 단 분류 배너는 미노출(종착)
 */
export function allowedShareKinds(type: ZaloCounterpartyType): ShareKind[] {
  if (isCostSideType(type)) return ["PHOTO", "VILLA", "SETTLEMENT"];
  if (isSellSideType(type)) return ["PHOTO", "VILLA", "PROPOSAL"];
  return ["PHOTO"]; // UNKNOWN · IGNORED
}
