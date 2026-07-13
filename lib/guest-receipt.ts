// lib/guest-receipt.ts — 게스트 정산 내역(영수증) 로더 (T-guest-settlement-receipt)
//
// 체크아웃 정산 완료 예약의 최종 영수증 데이터 — /g/[token]/receipt 전용(RSC).
//   미니바 이용 + 확정 부가서비스 + 보증금 가감산(파손·상계) + 수단별 수납 + 환불액.
//
// ★사업 원칙2(마진 비공개): 원가 필드(costVnd·lineCostVnd·부가서비스 원가·벤더 정산)는
//   Prisma select 단계에서부터 조회하지 않는다. 이 로더가 반환하는 것은 전부 게스트 청구용 판매가·수납액뿐이다.
//   settlementNote(운영 메모)·damageNote·공급자 정보 미포함. 파손은 금액만(사진·메모 없이).
//   토큰 스코프: 자기 예약 하나만(재고 비공개 원칙1). 다른 예약·다른 토큰 데이터 접근 불가.
//   BigInt(VND 동)는 클라 직렬화 경계에서 문자열로 변환(기존 게스트 로더 관례).
import { prisma } from "./prisma";
import { guestTokenState, type GuestTokenState } from "./guest-checkin";
import { parseSelectedOptions, type ResolvedSelectedOption } from "./service-catalog";

// ── 미니바 이용 라인(스냅샷) ──────────────────────────────────────────
export interface GuestReceiptMinibarLine {
  // ★체크아웃 시점 품목명 스냅샷(ko 고정) — 로케일 해석 불가(품목 삭제·개명 대비 저장본). page도 ko 그대로 표기.
  nameKo: string;
  consumedQty: number;
  unitPriceVnd: string; // 판매 단가(VND, 동) — 판매가만
  lineVnd: string; // 판매액 = consumedQty × unitPriceVnd
}

// ── 확정 부가서비스 라인 ──────────────────────────────────────────────
export interface GuestReceiptServiceLine {
  id: string;
  type: string;
  // 카탈로그 표시명 — page에서 pickI18n로 로케일 해석. 카탈로그 미연결(구/운영자 주문)이면 null → type 라벨 폴백.
  nameKo: string | null;
  nameI18n: unknown;
  quantity: number;
  serviceDate: string | null; // 이용일 "YYYY-MM-DD" (테오 요청 2026-07-13)
  serviceTime: string | null; // 이용 시각 "HH:MM"(비TICKET만 존재)
  priceKrw: number | null; // 판매가(KRW 채널)
  priceVnd: string | null; // 판매가(VND 채널)
  // 선택 옵션 라벨 스냅샷만(원가 없음 — ResolvedSelectedOption엔 costVnd 자체가 없음). page에서 언어 해석.
  selectedOptions: ResolvedSelectedOption[];
}

// ── 보증금 정산(가감산) ───────────────────────────────────────────────
export interface GuestReceiptDeposit {
  amount: number | null; // 수취 보증금(depositCurrency 단위). null=보증금 없음
  currency: "KRW" | "VND" | "USD" | null;
  status: string; // DepositStatus(NONE/HELD/REFUNDED/PARTIAL_DEDUCTED)
  damageFound: boolean;
  offsetVnd: string; // 보증금 상계 = ΣDEPOSIT 수납 라인(VND)
  damageDeductVnd: string; // 파손 차감 = max(0, 차감총액 − 상계)(VND)
  totalDeductVnd: string; // 보증금에서 빠진 총액 = record.deductionVnd(VND). 구 데이터 표기용
  refundAmount: string | null; // 환불액 = max(0, amount − 차감총액). 보증금 없으면 null
  hasSettlementLines: boolean; // 신 데이터(수납 라인 존재)=상계/파손 분리 표기, 구 데이터=차감 총액만
}

// ── 수납 라인(수단×통화) ──────────────────────────────────────────────
export interface GuestReceiptSettlementLine {
  method: string; // CASH|BANK_TRANSFER|OTHER|DEPOSIT (page에서 라벨 해석)
  currency: string; // VND|KRW|USD
  amount: string; // 원본 통화 최소단위 정수(문자열)
}

export interface GuestReceiptData {
  state: GuestTokenState;
  /** status=CHECKED_OUT && CheckOutRecord 존재. false면 page는 /g/[token]으로 redirect. */
  ready: boolean;
  booking: {
    villaName: string;
    complex: string | null;
    checkIn: string; // ISO
    checkOut: string; // ISO
    nights: number;
    guestName: string;
  } | null;
  minibar: GuestReceiptMinibarLine[];
  services: GuestReceiptServiceLine[];
  usage: {
    guestChargeVnd: string | null; // 미니바 + VND옵션 합계(record 캐시)
    guestChargeKrw: number | null; // KRW옵션 합계(record 캐시)
    fxVndPerKrw: number | null; // settlementFx.vndPerKrw — 있으면 환산 합계 표시
    fxVndPerUsd: number | null; // settlementFx.vndPerUsd — USD 수납 라인 환산(미수납 잔액 계산)
  };
  deposit: GuestReceiptDeposit | null;
  settlement: {
    lines: GuestReceiptSettlementLine[]; // 신 데이터(수단별 원장)
    // 구 데이터 폴백(라인 0건) — 통화별 실수납 합계만
    settledVnd: string | null;
    settledKrw: number | null;
    settledUsd: number | null;
    method: string | null; // settlementMethod(대표 수단)
    settledAt: string | null; // ISO — 정산 일시
  };
}

// ── 보증금 파생 계산(순수 — 단위 테스트 대상) ─────────────────────────
export interface DepositDerivationInput {
  depositAmount: number | null; // 수취 보증금(depositCurrency 단위)
  deductionVnd: bigint | null; // record.deductionVnd = 보증금에서 빠진 총액(파손차감 + 상계)
  depositOffsetVnd: bigint; // ΣDEPOSIT 수납 라인(보증금 상계, VND)
}

export interface DepositDerivationResult {
  offsetVnd: bigint; // 보증금 상계(음수 방지)
  damageDeductVnd: bigint; // 파손 차감 = max(0, 총액 − 상계)
  totalDeductVnd: bigint; // 보증금에서 빠진 총액(= deductionVnd)
  refundAmount: number | null; // 환불액 = max(0, amount − 총액). 보증금 없으면 null
}

/**
 * 보증금 정산 파생 — 순수. (SPEC: T-guest-settlement-receipt 파생 규칙)
 *   - 보증금 상계 = ΣDEPOSIT 라인(offsetVnd, 음수 방지)
 *   - 파손 차감 = max(0, 차감총액 − 상계)  ← 차감총액(record.deductionVnd) = 파손 + 상계 합(checkout.ts outcome)
 *   - 환불액 = max(0, 수취보증금 − 차감총액). 보증금 없으면 null
 *   ⚠ 보증금 상계는 보증금이 VND일 때만 발생(checkout.ts가 depositCurrency=VND 강제) → 차감·환불 산술은 VND 단위 정합.
 */
export function deriveDepositSettlement(input: DepositDerivationInput): DepositDerivationResult {
  const total = input.deductionVnd != null && input.deductionVnd > 0n ? input.deductionVnd : 0n;
  const offset = input.depositOffsetVnd > 0n ? input.depositOffsetVnd : 0n;
  const damage = total - offset > 0n ? total - offset : 0n;
  let refund: number | null = null;
  if (input.depositAmount != null) {
    const r = input.depositAmount - Number(total);
    refund = r > 0 ? r : 0;
  }
  return { offsetVnd: offset, damageDeductVnd: damage, totalDeductVnd: total, refundAmount: refund };
}

/** 토큰 없음 → null(404). 만료·회수 → state만 채워 반환(page는 만료 안내). 체크아웃 전 → ready=false(page redirect). */
export async function loadGuestReceipt(
  token: string,
  now: Date = new Date()
): Promise<GuestReceiptData | null> {
  const t = await prisma.guestCheckinToken.findUnique({
    where: { token },
    select: { bookingId: true, expiresAt: true, revokedAt: true },
  });
  if (!t) return null;
  const state = guestTokenState(t, now);

  const notReady = (): GuestReceiptData => ({
    state,
    ready: false,
    booking: null,
    minibar: [],
    services: [],
    usage: { guestChargeVnd: null, guestChargeKrw: null, fxVndPerKrw: null, fxVndPerUsd: null },
    deposit: null,
    settlement: {
      lines: [],
      settledVnd: null,
      settledKrw: null,
      settledUsd: null,
      method: null,
      settledAt: null,
    },
  });

  if (state !== "OK") return notReady();

  const booking = await prisma.booking.findUnique({
    where: { id: t.bookingId },
    select: {
      status: true,
      guestName: true,
      checkIn: true,
      checkOut: true,
      nights: true,
      // 보증금 — 수취액·통화·상태만(가감산 표기). 파손 사진·메모 미포함.
      depositAmount: true,
      depositCurrency: true,
      depositStatus: true,
      villa: { select: { name: true, complex: true } },
      checkOutRecord: {
        select: {
          deductionVnd: true, // 보증금에서 빠진 총액(파손 + 상계)
          damageFound: true, // 파손 여부(금액만 표기 — 사진·메모 select 안 함)
          settledAt: true,
          guestChargeVnd: true,
          guestChargeKrw: true,
          settledVnd: true,
          settledKrw: true,
          settledUsd: true,
          settlementFx: true, // { date, vndPerKrw, vndPerUsd } — 환산 표시 근거
          settlementMethod: true,
          // ★settlementNote·damageNote·damagePhotoUrls·photoUrls는 select 안 함(운영 메모·증빙 비노출)
          // ★minibarLines에서 costVnd·lineCostVnd는 select 자체 금지(마진 비공개)
          minibarLines: {
            orderBy: { createdAt: "asc" },
            select: { nameKo: true, consumedQty: true, unitPriceVnd: true, lineVnd: true },
          },
          settlementLines: {
            orderBy: { createdAt: "asc" },
            select: { method: true, currency: true, amount: true },
          },
        },
      },
    },
  });
  if (!booking) return null;

  const record = booking.checkOutRecord;
  const ready = booking.status === "CHECKED_OUT" && record != null;
  if (!ready || !record) return notReady();

  // 확정 부가서비스(CONFIRMED|DELIVERED) — record.guestChargeVnd/Krw 합계와 정합(checkout.ts computeGuestBill과 동일 필터).
  //   ★원가·벤더 정보 select 안 함 — 표시명·판매가·옵션 라벨만.
  const svcOrders = await prisma.serviceOrder.findMany({
    where: {
      bookingId: t.bookingId,
      status: { in: ["CONFIRMED", "DELIVERED"] },
    },
    // 이용일 오름차순(미지정은 뒤로) → 생성순 — 영수증은 이용 시간순이 자연스럽다(테오 요청 2026-07-13)
    orderBy: [{ serviceDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: {
      id: true,
      type: true,
      catalogItemId: true,
      quantity: true,
      serviceDate: true,
      serviceTime: true,
      priceKrw: true,
      priceVnd: true,
      selectedOptions: true,
    },
  });

  // 카탈로그 표시명 해석용 — catalogItemId → {nameKo, nameI18n}. nameKo·nameI18n만(원가 select 안 함).
  const itemIds = [...new Set(svcOrders.map((o) => o.catalogItemId).filter((id): id is string => id != null))];
  const catItems = itemIds.length
    ? await prisma.serviceCatalogItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, nameKo: true, nameI18n: true },
      })
    : [];
  const nameById = new Map(catItems.map((c) => [c.id, { nameKo: c.nameKo, nameI18n: c.nameI18n }]));

  const services: GuestReceiptServiceLine[] = svcOrders.map((o) => {
    const cat = o.catalogItemId ? nameById.get(o.catalogItemId) : undefined;
    return {
      id: o.id,
      type: o.type,
      nameKo: cat?.nameKo ?? null,
      nameI18n: cat?.nameI18n ?? null,
      quantity: o.quantity,
      serviceDate: o.serviceDate ? o.serviceDate.toISOString().slice(0, 10) : null,
      serviceTime: o.serviceTime ?? null,
      priceKrw: o.priceKrw,
      priceVnd: o.priceVnd?.toString() ?? null,
      selectedOptions: parseSelectedOptions(o.selectedOptions),
    };
  });

  const minibar: GuestReceiptMinibarLine[] = record.minibarLines.map((m) => ({
    nameKo: m.nameKo,
    consumedQty: m.consumedQty,
    unitPriceVnd: m.unitPriceVnd.toString(),
    lineVnd: m.lineVnd.toString(),
  }));

  // 보증금 상계 = ΣDEPOSIT 라인(항상 VND — checkout.ts 검증). 파생 계산은 순수 함수로.
  const depositOffsetVnd = record.settlementLines
    .filter((l) => l.method === "DEPOSIT")
    .reduce((acc, l) => acc + l.amount, 0n);
  const dep = deriveDepositSettlement({
    depositAmount: booking.depositAmount,
    deductionVnd: record.deductionVnd,
    depositOffsetVnd,
  });
  const hasSettlementLines = record.settlementLines.length > 0;
  const hasDeposit = booking.depositStatus !== "NONE" || booking.depositAmount != null;
  const deposit: GuestReceiptDeposit | null = hasDeposit
    ? {
        amount: booking.depositAmount,
        currency: booking.depositCurrency,
        status: booking.depositStatus,
        damageFound: record.damageFound,
        offsetVnd: dep.offsetVnd.toString(),
        damageDeductVnd: dep.damageDeductVnd.toString(),
        totalDeductVnd: dep.totalDeductVnd.toString(),
        refundAmount: dep.refundAmount != null ? dep.refundAmount.toString() : null,
        hasSettlementLines,
      }
    : null;

  const fx = record.settlementFx as { vndPerKrw?: number; vndPerUsd?: number } | null;
  const fxVndPerKrw = fx && typeof fx.vndPerKrw === "number" && fx.vndPerKrw > 0 ? fx.vndPerKrw : null;
  const fxVndPerUsd = fx && typeof fx.vndPerUsd === "number" && fx.vndPerUsd > 0 ? fx.vndPerUsd : null;

  return {
    state,
    ready: true,
    booking: {
      villaName: booking.villa.name,
      complex: booking.villa.complex,
      checkIn: booking.checkIn.toISOString(),
      checkOut: booking.checkOut.toISOString(),
      nights: booking.nights,
      guestName: booking.guestName,
    },
    minibar,
    services,
    usage: {
      guestChargeVnd: record.guestChargeVnd?.toString() ?? null,
      guestChargeKrw: record.guestChargeKrw,
      fxVndPerKrw,
      fxVndPerUsd,
    },
    deposit,
    settlement: {
      lines: record.settlementLines.map((l) => ({
        method: l.method,
        currency: l.currency,
        amount: l.amount.toString(),
      })),
      settledVnd: record.settledVnd?.toString() ?? null,
      settledKrw: record.settledKrw,
      settledUsd: record.settledUsd,
      method: record.settlementMethod,
      settledAt: record.settledAt?.toISOString() ?? null,
    },
  };
}
