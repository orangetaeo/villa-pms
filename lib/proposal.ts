import { randomBytes } from "node:crypto";
import {
  BookingChannel,
  BookingSeller,
  Currency,
  ProposalStatus,
  type Prisma,
  type PrismaClient,
  type Proposal,
} from "@prisma/client";
import { assertValidStayRange, checkAvailability, type StayRange } from "./availability";
import {
  quoteStayForVilla,
  quoteSupplierSaleForVilla,
  getFxVndPerKrw,
  assertSaleAmountColumns,
  MissingRateError,
  type NightQuote,
} from "./pricing";
import { writeAuditLog } from "./audit-log";

/**
 * 제안(Proposal) 생성 규칙 단일 소스 (SPEC F3 흐름 1~2, ADR-0003)
 *
 * - 채널 → 통화 기본값: DIRECT→KRW, 여행사·랜드사→VND (ADMIN 오버라이드 가능)
 * - 항목 가격은 생성 시점 요율의 박별 합산 스냅샷 — 이후 요율 변경 무영향
 * - 환율(FX_VND_PER_KRW)은 생성 시점 스냅샷 (참고 환산·마진 리포팅용, 미설정 null)
 * - 공개 링크 토큰은 crypto 난수 — 추측 가능성 차단
 *
 * ⚠️ 재고 비공개: 후보 조회(findSellableVillaIds 전체 재고)와 본 모듈 소비 route는
 * 전부 ADMIN 전용. /p/[token](T2.2)은 해당 제안에 포함된 빌라·날짜·판매가만 노출.
 */

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/** 채널 → 결제 통화 기본값 (ADR-0003). ADMIN 오버라이드는 호출부 입력으로 */
export function defaultCurrencyForChannel(channel: BookingChannel): Currency {
  return channel === BookingChannel.DIRECT ? Currency.KRW : Currency.VND;
}

/**
 * 제안 유효 상태 판정 — DB status가 ACTIVE라도 expiresAt 경과면 EXPIRED.
 * cron 없이 시각 기준 단일 판정 (HOLD 거부의 evaluateProposalForHold와 동일 규약,
 * c2 화면의 "서버 판정값으로 1개만 렌더" 소스)
 */
export function effectiveProposalStatus(
  status: ProposalStatus,
  expiresAt: Date,
  now: Date
): ProposalStatus {
  if (status === ProposalStatus.ACTIVE && expiresAt.getTime() <= now.getTime()) {
    return ProposalStatus.EXPIRED;
  }
  return status;
}

/**
 * 박별 요율이 전부 동일하면 그 값, 시즌 경계로 섞이면 null.
 * ProposalItem.price*PerNight은 균일가일 때만 채운다 — 평균 등 가공 금지(money-pattern)
 */
export function uniformNightlyPrice<T extends number | bigint>(
  nightlyPrices: T[]
): T | null {
  if (nightlyPrices.length === 0) return null;
  const first = nightlyPrices[0];
  return nightlyPrices.every((p) => p === first) ? first : null;
}

/** 공개 링크 토큰 — 스키마 default cuid()는 추측 가능성이 있어 명시 난수로 대체 */
export function generateProposalToken(): string {
  return randomBytes(24).toString("base64url");
}

// ===================== DB 층 =====================

export interface ProposalItemInput extends StayRange {
  villaId: string;
}

export interface CreateProposalInput {
  clientName: string;
  channel: BookingChannel;
  /** 미지정 시 채널 기본값 */
  saleCurrency?: Currency;
  /** 링크 유효시간 — 기본 48h */
  expiresInHours?: number;
  note?: string;
  items: ProposalItemInput[];
  actorUserId: string;
  now: Date;
}

/** 생성 거부 — 항목별 사유를 모아 한 번에 반환 (부분 생성 금지) */
export class ProposalRejectedError extends Error {
  constructor(public readonly failures: { villaId: string; reason: string }[]) {
    super(`제안 생성 불가: ${failures.map((f) => `${f.villaId}(${f.reason})`).join(", ")}`);
    this.name = "ProposalRejectedError";
  }
}

const DEFAULT_EXPIRES_HOURS = 48;

export async function createProposal(
  prisma: PrismaClient,
  input: CreateProposalInput
): Promise<Proposal & { items: { id: string; villaId: string }[] }> {
  if (!input.clientName.trim()) throw new RangeError("고객명(여행사명)은 필수입니다");
  if (input.items.length < 1 || input.items.length > 3) {
    throw new RangeError(`제안 항목은 1~3개여야 합니다: ${input.items.length}`);
  }
  const villaIds = input.items.map((i) => i.villaId);
  if (new Set(villaIds).size !== villaIds.length) {
    throw new RangeError("같은 빌라를 중복 선택할 수 없습니다");
  }
  const expiresInHours = input.expiresInHours ?? DEFAULT_EXPIRES_HOURS;
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 336) {
    throw new RangeError(`유효시간은 1~336 정수여야 합니다: ${expiresInHours}`);
  }

  const saleCurrency = input.saleCurrency ?? defaultCurrencyForChannel(input.channel);

  return prisma.$transaction(async (tx) => {
    // 항목별 판매 가능 재검증 + 견적 — 하나라도 불가면 전체 거부
    const failures: { villaId: string; reason: string }[] = [];
    const itemRows: Prisma.ProposalItemCreateWithoutProposalInput[] = [];

    for (const item of input.items) {
      const availability = await checkAvailability(tx, item.villaId, item);
      if (!availability.sellable) {
        failures.push({ villaId: item.villaId, reason: availability.reasons.join(",") });
        continue;
      }
      try {
        const quote = await quoteStayForVilla(tx, item.villaId, item, saleCurrency);
        const isKrw = saleCurrency === Currency.KRW;
        assertSaleAmountColumns(saleCurrency, {
          krw: quote.totalSaleKrw ?? null,
          vnd: quote.totalSaleVnd ?? null,
        });
        itemRows.push({
          villa: { connect: { id: item.villaId } },
          checkIn: item.checkIn,
          checkOut: item.checkOut,
          priceKrwPerNight: isKrw
            ? uniformNightlyPrice(quote.nightly.map((n: NightQuote) => n.saleKrw!))
            : null,
          totalKrw: isKrw ? quote.totalSaleKrw : null,
          priceVndPerNight: !isKrw
            ? uniformNightlyPrice(quote.nightly.map((n: NightQuote) => n.saleVnd!))
            : null,
          totalVnd: !isKrw ? quote.totalSaleVnd : null,
        });
      } catch (e) {
        if (e instanceof MissingRateError) {
          failures.push({ villaId: item.villaId, reason: `요율 미설정(${e.season})` });
          continue;
        }
        throw e;
      }
    }
    if (failures.length > 0) throw new ProposalRejectedError(failures);

    const fx = await getFxVndPerKrw(tx); // 생성 시점 환율 스냅샷 (미설정 null)

    const proposal = await tx.proposal.create({
      data: {
        token: generateProposalToken(),
        clientName: input.clientName.trim(),
        channel: input.channel,
        saleCurrency,
        fxVndPerKrw: fx,
        expiresAt: new Date(input.now.getTime() + expiresInHours * 3_600_000),
        note: input.note?.trim() || null,
        items: { create: itemRows },
      },
      include: { items: { select: { id: true, villaId: true } } },
    });

    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "CREATE",
      entity: "Proposal",
      entityId: proposal.id,
      changes: {
        channel: { new: input.channel },
        saleCurrency: { new: saleCurrency },
        expiresAt: { new: proposal.expiresAt.toISOString() },
        villaIds: { new: villaIds },
      },
    });

    return proposal;
  });
}

// ===================== 공급자 직접 판매 링크 (F10 Phase B, ADR-0021 §7) =====================
//
// 공급자가 자기 빌라를 자기 가격(supplierSalePriceVnd)으로 직접 판매하는 링크.
// 운영자 제안(createProposal)과 분리: 단일 빌라·VND 고정·seller=SUPPLIER·supplierId 스코프.
// 마진 비공개: 운영자 salePrice*/margin*는 어디서도 읽지 않는다(quoteSupplierSaleForVilla가 보장).

/** 공급자 제안 생성 거부 사유 — 라우트가 NOT_FOUND→404, SOLD_OUT→409로 흡수 */
export type SupplierProposalRejectReason = "NOT_FOUND" | "SOLD_OUT";

export class SupplierProposalRejectedError extends Error {
  constructor(public readonly reason: SupplierProposalRejectReason) {
    super(reason);
    this.name = "SupplierProposalRejectedError";
  }
}

export interface CreateSupplierProposalInput {
  villaId: string;
  supplierId: string;
  clientName: string;
  checkIn: Date;
  checkOut: Date;
  /** 링크 유효시간 — 기본 48h */
  expiresInHours?: number;
  now: Date;
}

/**
 * 공급자 직접 판매 링크 생성 (F10 Phase B).
 *
 * - villa는 본인 소유(supplierId 스코프)만 — 미일치/없음은 NOT_FOUND(라우트 404, 존재 비노출).
 * - 단일 빌라·기간 1개. 가용성 미통과면 SOLD_OUT.
 * - 가격 = quoteSupplierSaleForVilla(supplierSalePriceVnd만). 미설정이면 MissingSupplierPriceError 전파(라우트 400).
 * - Proposal: channel=DIRECT, saleCurrency=VND, seller=SUPPLIER, supplierId 세팅. priceKrw/totalKrw=null.
 */
export async function createSupplierProposal(
  prisma: PrismaClient,
  input: CreateSupplierProposalInput
): Promise<Proposal> {
  if (!input.clientName.trim()) throw new RangeError("고객명은 필수입니다");
  if (
    !(input.checkIn instanceof Date) ||
    !(input.checkOut instanceof Date) ||
    isNaN(input.checkIn.getTime()) ||
    isNaN(input.checkOut.getTime())
  ) {
    throw new RangeError("체크인·체크아웃 날짜가 올바르지 않습니다");
  }
  assertValidStayRange({ checkIn: input.checkIn, checkOut: input.checkOut });
  const expiresInHours = input.expiresInHours ?? DEFAULT_EXPIRES_HOURS;
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 336) {
    throw new RangeError(`유효시간은 1~336 정수여야 합니다: ${expiresInHours}`);
  }
  const range: StayRange = { checkIn: input.checkIn, checkOut: input.checkOut };

  return prisma.$transaction(async (tx) => {
    // 소유 스코프 — 본인 빌라가 아니면 존재 비노출(404). select 최소화(id만).
    const villa = await tx.villa.findFirst({
      where: { id: input.villaId, supplierId: input.supplierId },
      select: { id: true },
    });
    if (!villa) throw new SupplierProposalRejectedError("NOT_FOUND");

    const availability = await checkAvailability(tx, input.villaId, range);
    if (!availability.sellable) throw new SupplierProposalRejectedError("SOLD_OUT");

    // 공급자 자기 판매가만 — 미설정이면 MissingSupplierPriceError 전파(라우트 400)
    const quote = await quoteSupplierSaleForVilla(tx, input.villaId, range);
    const priceVndPerNight = uniformNightlyPrice(quote.nightlyVnd);

    const proposal = await tx.proposal.create({
      data: {
        token: generateProposalToken(),
        clientName: input.clientName.trim(),
        channel: BookingChannel.DIRECT,
        saleCurrency: Currency.VND,
        seller: BookingSeller.SUPPLIER,
        supplierId: input.supplierId,
        fxVndPerKrw: null,
        expiresAt: new Date(input.now.getTime() + expiresInHours * 3_600_000),
        items: {
          create: [
            {
              villa: { connect: { id: input.villaId } },
              checkIn: input.checkIn,
              checkOut: input.checkOut,
              priceKrwPerNight: null,
              totalKrw: null,
              priceVndPerNight,
              totalVnd: quote.totalVnd,
            },
          ],
        },
      },
    });

    await writeAuditLog({
      db: tx,
      userId: input.supplierId,
      action: "CREATE",
      entity: "Proposal",
      entityId: proposal.id,
      changes: {
        seller: { new: BookingSeller.SUPPLIER },
        saleCurrency: { new: Currency.VND },
        villaIds: { new: [input.villaId] },
        expiresAt: { new: proposal.expiresAt.toISOString() },
      },
    });

    return proposal;
  });
}

/** 공급자 제안 목록 1행 — 운영자 금액 컬럼 미포함(VND 총액만) */
export interface SupplierProposalListRow {
  token: string;
  proposalId: string;
  villaId: string;
  villaName: string;
  checkIn: Date;
  checkOut: Date;
  /** effectiveProposalStatus 적용 (만료 반영) */
  status: ProposalStatus;
  /** 공급자 판매 총액 VND — null 가능(데이터 이상 시) */
  totalVnd: bigint | null;
  booking: { id: string; status: string } | null;
}

/**
 * 공급자 본인이 만든 직접 판매 링크 목록 (F10 Phase B).
 * supplierId 스코프 + seller=SUPPLIER만. 운영자 금액(salePrice·krw)은 select 자체에 없음.
 * effectiveProposalStatus로 만료를 시각 기준 반영. item.bookingId 연결 booking 상태 포함.
 */
export async function listSupplierProposals(
  prisma: PrismaClient,
  supplierId: string,
  now: Date = new Date()
): Promise<SupplierProposalListRow[]> {
  const proposals = await prisma.proposal.findMany({
    where: { supplierId, seller: BookingSeller.SUPPLIER },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      token: true,
      status: true,
      expiresAt: true,
      items: {
        orderBy: { id: "asc" },
        take: 1, // 공급자 링크는 단일 빌라
        select: {
          villaId: true,
          checkIn: true,
          checkOut: true,
          totalVnd: true, // 공급자 판매 총액(VND)만 — 운영자 금액 컬럼 미select
          villa: { select: { name: true } },
          booking: { select: { id: true, status: true } },
        },
      },
    },
  });

  return proposals.map((p) => {
    const item = p.items[0];
    return {
      token: p.token,
      proposalId: p.id,
      villaId: item?.villaId ?? "",
      villaName: item?.villa.name ?? "",
      checkIn: item?.checkIn ?? new Date(0),
      checkOut: item?.checkOut ?? new Date(0),
      status: effectiveProposalStatus(p.status, p.expiresAt, now),
      totalVnd: item?.totalVnd ?? null,
      booking: item?.booking ? { id: item.booking.id, status: item.booking.status } : null,
    };
  });
}
