/**
 * seed-today-service-test — 오늘 체크인 1건·오늘 체크아웃 1건 + 부가서비스 판매·구매 테스트 시드 (멱등)
 *
 * 목적(테오 지시): "오늘(VN 기준)" 셀프 체크인 풀플로우와, 부가서비스가 실제로 구매된 체크아웃 정산을
 *   게스트 포털·운영자 화면·체크아웃 정산에서 실물 데이터로 테스트할 수 있게 라이브 DB에 심는다.
 *
 * 전제: 먼저 prisma/seed.ts(파일럿 빌라 4채·요율·AppSetting)가 적재돼 있어야 한다.
 *        빌라 seed-villa-sonasea-v11 / v25가 존재해야 하며, 없으면 명확한 에러로 중단한다.
 *
 * 실행: npx tsx scripts/seed-today-service-test.ts   (DATABASE_URL = 라이브 Railway)
 *
 * 멱등성: 이 시드가 만드는 행만 정밀 삭제 후 재생성한다(자체 접두사 `demo-svc`).
 *          기존 seed-*·demo-*(seed-demo.ts) 데이터는 절대 건드리지 않는다.
 *
 * 날짜:   "오늘"은 실행 시점의 베트남(Asia/Ho_Chi_Minh) 날짜 기준 동적 계산 →
 *          언제 다시 돌려도 항상 오늘 체크인/오늘 체크아웃이 살아 있다.
 *
 * 주의(사업 원칙 2 — 마진 비공개): 부가서비스 주문의 costVnd는 0(운영자 확정 전 placeholder).
 *   판매가(priceVnd) + 표시 KRW 스냅샷(priceKrw)만 기록. 벤더 미배정·미발주(vendorStatus=null)라
 *   벤더 보드에는 노출되지 않으며, Zalo 발송 유발 경로(Notification insert)도 만들지 않는다.
 */
import {
  PrismaClient,
  BookingStatus,
  BookingChannel,
  Currency,
  DepositStatus,
  PaymentMethod,
  ServiceType,
  ServiceOrderStatus,
} from "@prisma/client";
import { todayVnDateString, parseUtcDateOnly } from "../lib/date-vn";
import {
  SEED_ADMIN_ID,
  SEED_FX_VND_PER_KRW,
  SEED_MARGIN_PERCENT,
  applyMarginVnd,
  vndToKrwRounded,
} from "../prisma/seed";
import {
  parseCatalogOptions,
  resolveOrderPricing,
  parseAudiences,
  type CatalogOptionDef,
} from "../lib/service-catalog";
import { priceKrwCeil } from "../lib/service-display";
import { getFxVndPerKrw } from "../lib/pricing";
import { AGREEMENT_VERSION } from "../lib/agreement";

const FX = SEED_FX_VND_PER_KRW;
const DAY = 86_400_000;
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY);
const picsum = (seed: string): string => `https://picsum.photos/seed/${seed}/800/600`;

// ── 고정 id·토큰(멱등 재생성 키) ─────────────────────────────
const BK_A = "demo-svcbk-a"; // 오늘 체크인
const BK_B = "demo-svcbk-b"; // 오늘 체크아웃
const CI_B = "demo-svc-ci-b";
const TOKEN_A = "demo-svc-checkin-a";
const TOKEN_B = "demo-svc-checkout-b";
const PAY_B = "demo-svc-pay-b1";
const SO_PREFIX = "demo-svc-so-";

const VILLA_A = "seed-villa-sonasea-v11";
const VILLA_B = "seed-villa-sonasea-v25";

// LOW 시즌 원가/박 (seed.ts 파일럿 값과 동일 — 대략치 스냅샷)
const VILLA_COST_VND: Record<string, bigint> = {
  [VILLA_A]: 3_000_000n,
  [VILLA_B]: 5_000_000n,
};

// ── 체크아웃 예약 B의 투숙객 4명 (여권 OCR 확정본 + 티켓 이용자 스냅샷 원천) ──
//   OCR shape(lib/gemini PassportOcrData): surname/givenNames/birthDate 등. name = "surname givenNames".
//   시니어 KIM SOONJA(1960) = TICKET 시니어 variant(bornBeforeYear 1966) 판정 대상.
//   어린이 KIM HAEUN(2016) = 명단 구성만(무료/어린이 구분 테스트 여지).
interface GuestPerson {
  surname: string;
  givenNames: string;
  birthDate: string; // YYYY-MM-DD
  nationality: string;
  sex: string;
}
const GUESTS_B: GuestPerson[] = [
  { surname: "KIM", givenNames: "TAEHO", birthDate: "1985-03-15", nationality: "KOR", sex: "M" },
  { surname: "LEE", givenNames: "MINJI", birthDate: "1988-07-22", nationality: "KOR", sex: "F" },
  { surname: "KIM", givenNames: "SOONJA", birthDate: "1960-11-05", nationality: "KOR", sex: "F" },
  { surname: "KIM", givenNames: "HAEUN", birthDate: "2016-04-10", nationality: "KOR", sex: "F" },
];
const fullName = (g: GuestPerson): string => `${g.surname} ${g.givenNames}`;
const ticketGuestSnap = (g: GuestPerson) => ({ name: fullName(g), birthDate: g.birthDate });

// ── 카탈로그 런타임 선택 헬퍼 ─────────────────────────────
type CatItem = {
  id: string;
  type: ServiceType;
  nameKo: string;
  priceVnd: bigint | null;
  options: unknown;
  audiences: unknown;
};

/** 성인(무규칙)·시니어(bornBeforeYear) variant를 모두 가진 GUEST 티켓 1종. 없으면 null. */
function pickAgeTicket(items: CatItem[]): { item: CatItem; adultKey: string; seniorKey: string } | null {
  for (const it of items) {
    if (it.type !== "TICKET") continue;
    if (!parseAudiences(it.audiences).includes("GUEST")) continue;
    const variants = parseCatalogOptions(it.options).variants ?? [];
    const noRule = (v: CatalogOptionDef) =>
      v.bornBeforeYear == null && v.heightMaxCm == null && v.ageMin == null && v.ageMax == null;
    const adult = variants.find((v) => noRule(v) && v.priceVnd != null && v.priceVnd !== "0");
    const senior = variants.find((v) => v.bornBeforeYear != null);
    if (adult && senior) return { item: it, adultKey: adult.key, seniorKey: senior.key };
  }
  return null;
}

/** 특정 타입의 첫 GUEST 카탈로그 항목. 없으면 null. */
function pickByType(items: CatItem[], type: ServiceType): CatItem | null {
  return (
    items.find((it) => it.type === type && parseAudiences(it.audiences).includes("GUEST")) ?? null
  );
}

/** 항목의 첫 variant key(있으면). 단일가 항목은 undefined. */
function firstVariantKey(it: CatItem): string | undefined {
  return (parseCatalogOptions(it.options).variants ?? [])[0]?.key;
}

async function main() {
  const prisma = new PrismaClient();
  const skipped: string[] = [];
  try {
    const now = new Date();
    const todayStr = todayVnDateString(now);
    const today = parseUtcDateOnly(todayStr);
    if (!today) throw new Error(`오늘 날짜 계산 실패: ${todayStr}`);

    // ── 0) 빌라 존재 확인 ──────────────────────────────
    const villas = await prisma.villa.findMany({
      where: { id: { in: [VILLA_A, VILLA_B] } },
      select: { id: true },
    });
    const have = new Set(villas.map((v) => v.id));
    for (const vid of [VILLA_A, VILLA_B]) {
      if (!have.has(vid)) {
        throw new Error(
          `필수 시드 빌라 없음: ${vid}. 먼저 \`npx tsx prisma/seed.ts\`로 파일럿 빌라를 적재하세요.`
        );
      }
    }

    // ── 1) 멱등 삭제 (FK 자식 → 부모 역순, 자기 접두사만) ──────
    await prisma.serviceOrder.deleteMany({ where: { id: { startsWith: SO_PREFIX } } });
    await prisma.checkInRecord.deleteMany({ where: { id: CI_B } });
    await prisma.guestCheckinToken.deleteMany({ where: { token: { in: [TOKEN_A, TOKEN_B] } } });
    await prisma.payment.deleteMany({ where: { id: { startsWith: "demo-svc-pay-" } } });
    await prisma.booking.deleteMany({ where: { id: { in: [BK_A, BK_B] } } });

    // ── 2) 예약 A — 오늘 체크인 (CONFIRMED, 2박, DIRECT) ──────
    const nightsA = 2;
    const costA = VILLA_COST_VND[VILLA_A] * BigInt(nightsA);
    const saleVndPerNightA = applyMarginVnd(VILLA_COST_VND[VILLA_A], SEED_MARGIN_PERCENT);
    const totalSaleKrwA = vndToKrwRounded(saleVndPerNightA, FX) * nightsA;
    const checkInA = today;
    const checkOutA = addDays(today, nightsA);
    await prisma.booking.create({
      data: {
        id: BK_A,
        villaId: VILLA_A,
        status: BookingStatus.CONFIRMED,
        channel: BookingChannel.DIRECT,
        checkIn: checkInA,
        checkOut: checkOutA,
        nights: nightsA,
        guestName: "테스트 체크인가족",
        guestCount: 4,
        guestPhone: "010-1000-2000",
        saleCurrency: Currency.KRW,
        totalSaleKrw: totalSaleKrwA,
        fxVndPerKrw: null,
        supplierCostVnd: costA,
        depositStatus: DepositStatus.NONE, // 셀프 체크인 전 — 보증금 미수취
        breakfastIncluded: true,
        createdAt: addDays(now, -5),
      },
    });

    // 셀프 체크인 토큰 A — 서명·여권 전부 미완(처음부터 테스트)
    await prisma.guestCheckinToken.create({
      data: {
        bookingId: BK_A,
        token: TOKEN_A,
        expiresAt: addDays(checkOutA, 1),
      },
    });

    // ── 3) 예약 B — 오늘 체크아웃 (CHECKED_IN, 2박, DIRECT) ──────
    const nightsB = 2;
    const costB = VILLA_COST_VND[VILLA_B] * BigInt(nightsB);
    const saleVndPerNightB = applyMarginVnd(VILLA_COST_VND[VILLA_B], SEED_MARGIN_PERCENT);
    const totalSaleKrwB = vndToKrwRounded(saleVndPerNightB, FX) * nightsB;
    const checkInB = addDays(today, -nightsB); // 오늘-2
    const checkOutB = today; // 오늘 체크아웃
    await prisma.booking.create({
      data: {
        id: BK_B,
        villaId: VILLA_B,
        status: BookingStatus.CHECKED_IN,
        channel: BookingChannel.DIRECT,
        checkIn: checkInB,
        checkOut: checkOutB,
        nights: nightsB,
        guestName: "테스트 체크아웃가족",
        guestCount: 4,
        guestPhone: "010-3000-4000",
        saleCurrency: Currency.KRW,
        totalSaleKrw: totalSaleKrwB,
        fxVndPerKrw: null,
        supplierCostVnd: costB,
        // 보증금 HELD 2,000,000 VND — 체크아웃 상계 테스트용
        depositAmount: 2_000_000,
        depositCurrency: Currency.VND,
        depositStatus: DepositStatus.HELD,
        breakfastIncluded: true,
        createdAt: addDays(checkInB, -6),
      },
    });

    // 잔금 Payment 1건 (KRW) — 체크인 시점 수납
    await prisma.payment.create({
      data: {
        id: PAY_B,
        bookingId: BK_B,
        currency: Currency.KRW,
        amount: BigInt(totalSaleKrwB),
        method: PaymentMethod.KR_BANK_TRANSFER,
        fxRateToVnd: FX,
        vndEquivalent: BigInt(Math.round(totalSaleKrwB * FX)),
        receivedAt: checkInB,
        note: "잔금 입금(테스트 체크아웃)",
      },
    });

    // 체크인 기록 B — 여권 OCR 확정본(4명 배열) + 서명 완료
    const SIG_URL =
      "/api/passports/sig-1760000000000-seedadmin-0a1b2c3d-e4f5-6789-abcd-ef0123456789.png";
    await prisma.checkInRecord.create({
      data: {
        id: CI_B,
        bookingId: BK_B,
        passportPhotoUrls: GUESTS_B.map((g, i) => picsum(`${BK_B}-passport-${i}-${g.givenNames}`)),
        // 운영자 확정본 — PassportOcrData[] (ticket-guests guestsFromPassportOcr가 기대하는 배열 shape)
        passportOcrJson: GUESTS_B.map((g) => ({
          surname: g.surname,
          givenNames: g.givenNames,
          passportNo: `M${g.birthDate.replace(/-/g, "").slice(2)}`,
          nationality: g.nationality,
          birthDate: g.birthDate,
          expiryDate: "2030-01-01",
          sex: g.sex,
        })),
        tamTruSentAt: checkInB,
        agreementSignedAt: checkInB,
        signatureUrl: SIG_URL,
        agreementVersion: AGREEMENT_VERSION,
        notes: "안전수칙·기물파손 동의 완료(테스트 체크아웃)",
        createdBy: SEED_ADMIN_ID,
        createdAt: checkInB,
      },
    });

    // 셀프 체크인 토큰 B — 서명 완료 상태(관리자 체크인이 채택한 게스트 서명)
    await prisma.guestCheckinToken.create({
      data: {
        bookingId: BK_B,
        token: TOKEN_B,
        expiresAt: addDays(checkOutB, 1),
        firstUsedAt: checkInB,
        agreementSignedAt: checkInB,
        signatureUrl: SIG_URL,
        agreementVersion: AGREEMENT_VERSION,
        passportPhotoUrls: GUESTS_B.map((g, i) => picsum(`${BK_B}-selfpass-${i}-${g.givenNames}`)),
      },
    });

    // ── 4) 부가서비스 주문 (예약 B — 오늘 서비스일, 벤더 미배정·미발주) ──────
    const catalog = (await prisma.serviceCatalogItem.findMany({
      where: { active: true },
      select: { id: true, type: true, nameKo: true, priceVnd: true, options: true, audiences: true },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    })) as CatItem[];

    const fxStr = await getFxVndPerKrw(prisma); // 표시 KRW 스냅샷용(없으면 0)
    const serviceDate = today;

    interface OrderPlan {
      idSuffix: string;
      item: CatItem;
      variantKey?: string;
      quantity: number;
      status: ServiceOrderStatus;
      ticketGuests?: { name: string; birthDate: string }[];
      serviceTime?: string | null;
      note: string;
    }
    const plans: OrderPlan[] = [];

    // ① TICKET 성인 ×2 [KIM TAEHO, LEE MINJI] / ② TICKET 시니어 ×1 [KIM SOONJA]
    const ticket = pickAgeTicket(catalog);
    if (ticket) {
      plans.push({
        idSuffix: "1",
        item: ticket.item,
        variantKey: ticket.adultKey,
        quantity: 2,
        status: ServiceOrderStatus.CONFIRMED,
        ticketGuests: [ticketGuestSnap(GUESTS_B[0]), ticketGuestSnap(GUESTS_B[1])],
        serviceTime: null, // TICKET은 이용일만
        note: "성인 2인 (테스트)",
      });
      plans.push({
        idSuffix: "2",
        item: ticket.item,
        variantKey: ticket.seniorKey,
        quantity: 1,
        status: ServiceOrderStatus.CONFIRMED,
        ticketGuests: [ticketGuestSnap(GUESTS_B[2])],
        serviceTime: null,
        note: "시니어 1인 (테스트 — 구분별 분리 주문)",
      });
    } else {
      skipped.push("TICKET(성인+시니어 variant 보유 GUEST 티켓 없음) — 주문 ①② 스킵");
    }

    // ③ MASSAGE REQUESTED ×1
    const massage = pickByType(catalog, "MASSAGE");
    if (massage) {
      plans.push({
        idSuffix: "3",
        item: massage,
        variantKey: firstVariantKey(massage),
        quantity: 1,
        status: ServiceOrderStatus.REQUESTED,
        serviceTime: "15:00",
        note: "마사지 예약 요청(테스트)",
      });
    } else {
      skipped.push("MASSAGE(GUEST 카탈로그 없음) — 주문 ③ 스킵");
    }

    // ④ BBQ DELIVERED ×1 (스키마상 완료 상태 = DELIVERED)
    const bbq = pickByType(catalog, "BBQ");
    if (bbq) {
      plans.push({
        idSuffix: "4",
        item: bbq,
        variantKey: firstVariantKey(bbq),
        quantity: 1,
        status: ServiceOrderStatus.DELIVERED,
        serviceTime: "18:30",
        note: "통돼지 BBQ 제공 완료(테스트)",
      });
    } else {
      skipped.push("BBQ(GUEST 카탈로그 없음) — 주문 ④ 스킵");
    }

    const createdOrders: {
      id: string;
      item: string;
      variant: string | null;
      qty: number;
      status: string;
      priceVnd: string;
      priceKrw: number;
    }[] = [];

    for (const p of plans) {
      const pricing = resolveOrderPricing(
        { priceVnd: p.item.priceVnd },
        parseCatalogOptions(p.item.options),
        { variantKey: p.variantKey ?? null, quantity: p.quantity }
      );
      const priceKrw = fxStr ? priceKrwCeil(pricing.totalPriceVnd, fxStr) : 0;
      const id = `${SO_PREFIX}${p.idSuffix}`;
      await prisma.serviceOrder.create({
        data: {
          id,
          bookingId: BK_B,
          type: p.item.type,
          status: p.status,
          serviceDate,
          serviceTime: p.serviceTime ?? null,
          costVnd: 0n, // 운영자 확정 전 placeholder(마진 비공개)
          priceKrw,
          priceVnd: pricing.totalPriceVnd,
          catalogItemId: p.item.id,
          quantity: pricing.quantity,
          selectedOptions: pricing.snapshot as unknown as object,
          requestedVia: "GUEST",
          customerName: "테스트 체크아웃가족",
          guestNote: p.note,
          // ★벤더 미배정·미발주 — 벤더 보드 비노출(테오 지시). Notification insert 없음(Zalo 발송 회피).
          vendorId: null,
          vendorStatus: null,
          ...(p.ticketGuests ? { ticketGuests: p.ticketGuests } : {}),
          createdAt: addDays(now, -1),
        },
      });
      const vLabel =
        p.variantKey != null
          ? (parseCatalogOptions(p.item.options).variants ?? []).find((v) => v.key === p.variantKey)
              ?.labelKo ?? p.variantKey
          : null;
      createdOrders.push({
        id,
        item: p.item.nameKo,
        variant: vLabel,
        qty: pricing.quantity,
        status: p.status,
        priceVnd: pricing.totalPriceVnd.toString(),
        priceKrw,
      });
    }

    // ── 5) 검증 요약 ──────────────────────────────
    const [bkA, bkB] = await Promise.all([
      prisma.booking.findUnique({
        where: { id: BK_A },
        select: { id: true, status: true, checkIn: true, checkOut: true, guestCount: true },
      }),
      prisma.booking.findUnique({
        where: { id: BK_B },
        select: {
          id: true,
          status: true,
          checkIn: true,
          checkOut: true,
          depositAmount: true,
          depositStatus: true,
        },
      }),
    ]);
    const tokens = await prisma.guestCheckinToken.findMany({
      where: { token: { in: [TOKEN_A, TOKEN_B] } },
      select: { token: true, agreementSignedAt: true, expiresAt: true },
    });
    const ciB = await prisma.checkInRecord.findUnique({
      where: { id: CI_B },
      select: { passportOcrJson: true },
    });
    const ocr = Array.isArray(ciB?.passportOcrJson) ? (ciB!.passportOcrJson as any[]) : [];

    const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
    console.log("\n===== seed-today-service-test 완료(멱등) =====");
    console.log(`오늘(VN): ${todayStr}`);
    console.log("예약 A(오늘 체크인):", {
      id: bkA?.id,
      status: bkA?.status,
      checkIn: iso(bkA?.checkIn),
      checkOut: iso(bkA?.checkOut),
      guestCount: bkA?.guestCount,
    });
    console.log("예약 B(오늘 체크아웃):", {
      id: bkB?.id,
      status: bkB?.status,
      checkIn: iso(bkB?.checkIn),
      checkOut: iso(bkB?.checkOut),
      deposit: `${bkB?.depositAmount} VND / ${bkB?.depositStatus}`,
    });
    console.log(
      "토큰 2개:",
      tokens.map((t) => ({
        token: t.token,
        signed: !!t.agreementSignedAt,
        expiresAt: iso(t.expiresAt),
      }))
    );
    console.log(
      `체크인 명단(예약 B) ${ocr.length}명:`,
      ocr.map((g) => `${g.surname} ${g.givenNames} (${g.birthDate})`)
    );
    console.log(`부가서비스 주문 ${createdOrders.length}건:`);
    for (const o of createdOrders) {
      console.log(
        `  - ${o.id} · ${o.item}${o.variant ? ` [${o.variant}]` : ""} ×${o.qty} · ${o.status} · priceVnd=${o.priceVnd} · priceKrw=${o.priceKrw}`
      );
    }
    if (skipped.length > 0) {
      console.log("스킵:");
      for (const s of skipped) console.log(`  - ${s}`);
    }
    console.log("=============================================\n");
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun = process.argv[1] && /seed-today-service-test\.ts$/.test(process.argv[1]);
if (isDirectRun) {
  main().catch((e) => {
    console.error("❌ seed-today-service-test 실패:", e);
    process.exit(1);
  });
}
