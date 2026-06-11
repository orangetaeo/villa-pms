import { randomBytes } from "node:crypto";
import {
  BookingChannel,
  Currency,
  ProposalStatus,
  type Prisma,
  type PrismaClient,
  type Proposal,
} from "@prisma/client";
import { checkAvailability, type StayRange } from "./availability";
import { quoteStayForVilla, getFxVndPerKrw, assertSaleAmountColumns, MissingRateError, type NightQuote } from "./pricing";
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
