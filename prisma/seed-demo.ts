/**
 * T4.2b — ADMIN 화면 검증용 데모 데이터 시드 (멱등)
 *
 * 목적: 대시보드·예약·정산·검수·제안 등 운영자 화면이 "수십 건"의 현실적 데이터로 채워지도록
 *       거래성 데이터를 대량 생성한다 (오늘 체크인/체크아웃, 과거 숙박, 정산, 가예약, 청소 검수…).
 *
 * 전제: 먼저 `prisma/seed.ts`(파일럿 빌라 4채·요율·사진·AppSetting)가 적재돼 있어야 한다.
 *       이 스크립트는 그 위에 데모 공급자 2명·청소자 1명·데모 빌라 2채 + 모든 거래 데이터를 얹는다.
 *
 * 실행:   npx tsx prisma/seed.ts && npx tsx prisma/seed-demo.ts
 *          (또는 npm run seed:all)
 *
 * 멱등성: 모든 데모 행 id에 `demo-` 접두사 → 매 실행 시작 시 FK 역순으로 전량 삭제 후 재생성.
 *          파일럿 시드(seed-*) 데이터는 건드리지 않는다.
 *
 * 날짜:   "오늘"은 실행 시점의 베트남(Asia/Ho_Chi_Minh) 날짜 기준으로 동적 계산 →
 *          언제 다시 돌려도 항상 "오늘 체크인/체크아웃"이 살아 있도록 상대 오프셋으로 생성.
 *
 * 주의(사업 원칙 2 — 마진 비공개): salePrice*·마진은 ADMIN 전용. 공급자 화면 노출 금지(스코프 차단됨).
 */
import {
  PrismaClient,
  Role,
  VillaStatus,
  PhotoSpace,
  SeasonType,
  MarginType,
  BookingStatus,
  BookingChannel,
  Currency,
  PaymentMethod,
  DepositStatus,
  CleaningType,
  CleaningStatus,
  ProposalStatus,
  SettlementStatus,
  BlockSource,
  NotificationType,
  NotificationStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { todayVnDateString, parseUtcDateOnly } from "../lib/date-vn";
import {
  SEED_ADMIN_ID,
  SEED_SUPPLIER_ID,
  SEED_FX_VND_PER_KRW,
  SEED_MARGIN_PERCENT,
  applyMarginVnd,
  vndToKrwRounded,
} from "./seed";

// ===================== 상수·헬퍼 =====================

const FX = SEED_FX_VND_PER_KRW;
const DAY = 86_400_000;

const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY);
const addHours = (d: Date, h: number): Date => new Date(d.getTime() + h * 3_600_000);
const addMin = (d: Date, m: number): Date => new Date(d.getTime() - m * 60_000); // 과거(피드용)
const ymOf = (d: Date): string => d.toISOString().slice(0, 7);
const ymIndex = (ym: string): number => {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
};
const picsum = (seed: string): string => `https://picsum.photos/seed/${seed}/800/600`;

/** 결정적 PRNG (재실행 시 동일 데이터) — mulberry32 */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20260616);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

// 빌라별 LOW 시즌 원가/박 (VND) — 파일럿 + 데모 빌라
const PILOT_VILLAS = [
  "seed-villa-sonasea-v11",
  "seed-villa-sonasea-v12",
  "seed-villa-sonasea-v25",
  "seed-villa-sunset-sanato-a3",
];
const DEMO_VILLA_GREENBAY = "demo-villa-greenbay-b2";
const DEMO_VILLA_MARINA = "demo-villa-marina-c5";

const SUPPLIER_GREENBAY = "demo-supplier-greenbay";
const SUPPLIER_MARINA = "demo-supplier-marina";
const CLEANER_LAN = "demo-cleaner-lan";

const ALL_VILLAS = [...PILOT_VILLAS, DEMO_VILLA_GREENBAY, DEMO_VILLA_MARINA];

const VILLA_COST_VND: Record<string, bigint> = {
  "seed-villa-sonasea-v11": 3_000_000n,
  "seed-villa-sonasea-v12": 3_800_000n,
  "seed-villa-sonasea-v25": 5_000_000n,
  "seed-villa-sunset-sanato-a3": 2_500_000n,
  [DEMO_VILLA_GREENBAY]: 3_200_000n,
  [DEMO_VILLA_MARINA]: 2_800_000n,
};
const VILLA_SUPPLIER: Record<string, string> = {
  "seed-villa-sonasea-v11": SEED_SUPPLIER_ID,
  "seed-villa-sonasea-v12": SEED_SUPPLIER_ID,
  "seed-villa-sonasea-v25": SEED_SUPPLIER_ID,
  "seed-villa-sunset-sanato-a3": SEED_SUPPLIER_ID,
  [DEMO_VILLA_GREENBAY]: SUPPLIER_GREENBAY,
  [DEMO_VILLA_MARINA]: SUPPLIER_MARINA,
};

const DIRECT_GUESTS = [
  "김민준 가족", "이서연 일행", "박지후 부부", "최예은 가족", "정도윤 일행",
  "강하은 부부", "조시우 가족", "윤지아 일행", "장준우 부부", "임수아 가족",
  "한지민 일행", "오은우 가족", "서지안 부부", "신하준 가족",
];
const TRAVEL_AGENCIES = ["하나투어", "모두투어", "노랑풍선", "참좋은여행", "KRT여행사", "롯데관광"];
const LAND_AGENCIES = ["푸꾸옥 랜드", "베트남 에이전시", "사이공 트래블"];
const KR_PHONES = ["010-2345-6789", "010-3456-7890", "010-4567-8901", "010-5678-9012", "010-6789-0123"];

interface BookingMeta {
  id: string;
  villaId: string;
  supplierId: string;
  status: BookingStatus;
  channel: BookingChannel;
  saleCurrency: Currency;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  supplierCostVnd: bigint;
  totalSaleKrw: number | null;
  totalSaleVnd: bigint | null;
  depositAmount: number | null;
  depositCurrency: Currency | null;
  guestName: string;
  damage: boolean;
}

// ===================== 메인 =====================

async function main() {
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const todayStr = todayVnDateString(now);
    const today = parseUtcDateOnly(todayStr);
    if (!today) throw new Error(`오늘 날짜 계산 실패: ${todayStr}`);
    const curYmIdx = ymIndex(ymOf(today));

    // ---------- 0) 이 시드가 만든 데모 데이터만 정밀 삭제 (FK 자식 → 부모 역순, 멱등) ----------
    // 주의(병렬 세션): 다른 세션이 만든 데모 행(예: demo-supplier-tuan)은 건드리지 않도록
    //                  내가 생성하는 정확한 id 접두사/대상 빌라·유저로만 스코프한다.
    const myUserIds = [SUPPLIER_GREENBAY, SUPPLIER_MARINA, CLEANER_LAN];
    const myVillaIds = [DEMO_VILLA_GREENBAY, DEMO_VILLA_MARINA];
    const pfx = (s: string) => ({ startsWith: s });
    await prisma.auditLog.deleteMany({ where: { id: pfx("demo-al-") } });
    await prisma.notification.deleteMany({ where: { OR: [{ id: pfx("demo-noti-") }, { userId: { in: myUserIds } }] } });
    await prisma.payment.deleteMany({ where: { id: pfx("demo-pay-") } });
    await prisma.settlementItem.deleteMany({ where: { id: pfx("demo-si-") } });
    await prisma.settlement.deleteMany({ where: { id: pfx("demo-settle-") } });
    await prisma.checkInRecord.deleteMany({ where: { id: pfx("demo-ci-") } });
    await prisma.checkOutRecord.deleteMany({ where: { id: pfx("demo-co-") } });
    await prisma.cleaningTask.deleteMany({ where: { OR: [{ id: pfx("demo-cl-") }, { villaId: { in: myVillaIds } }, { assigneeId: { in: myUserIds } }] } });
    await prisma.proposalItem.deleteMany({ where: { OR: [{ id: pfx("demo-pi-") }, { villaId: { in: myVillaIds } }] } });
    await prisma.proposal.deleteMany({ where: { id: pfx("demo-prop-") } });
    await prisma.calendarBlock.deleteMany({ where: { OR: [{ id: pfx("demo-block-") }, { villaId: { in: myVillaIds } }] } });
    await prisma.booking.deleteMany({ where: { OR: [{ id: pfx("demo-bk-") }, { villaId: { in: myVillaIds } }] } });
    await prisma.villaPhoto.deleteMany({ where: { villaId: { in: myVillaIds } } });
    await prisma.villaRate.deleteMany({ where: { villaId: { in: myVillaIds } } });
    await prisma.villa.deleteMany({ where: { id: { in: myVillaIds } } });
    await prisma.user.deleteMany({ where: { id: { in: myUserIds } } });

    // ---------- 1) 데모 사용자 (공급자 2 + 청소자 1) ----------
    const pw = await hash(process.env.SEED_SUPPLIER_PASSWORD ?? "villa-pms-supplier-dev", 10);
    await prisma.user.createMany({
      data: [
        { id: SUPPLIER_GREENBAY, role: Role.SUPPLIER, name: "Trần Văn Minh", phone: "0901112222", passwordHash: pw, locale: "vi" },
        { id: SUPPLIER_MARINA, role: Role.SUPPLIER, name: "Nguyễn Thị Hương", phone: "0903334444", passwordHash: pw, locale: "vi" },
        { id: CLEANER_LAN, role: Role.CLEANER, name: "Phạm Thị Lan", phone: "0905556666", passwordHash: pw, locale: "vi" },
      ],
    });

    // ---------- 2) 데모 빌라 2채 + 요율 + 사진(picsum) ----------
    const demoVillas = [
      { id: DEMO_VILLA_GREENBAY, supplierId: SUPPLIER_GREENBAY, name: "그린베이 B2", complex: "그린베이", bedrooms: 3, bathrooms: 3, maxGuests: 8, hasPool: true, breakfastAvailable: true },
      { id: DEMO_VILLA_MARINA, supplierId: SUPPLIER_MARINA, name: "마리나 C5", complex: "마리나 베이", bedrooms: 2, bathrooms: 2, maxGuests: 5, hasPool: false, breakfastAvailable: false },
    ];
    for (const v of demoVillas) {
      await prisma.villa.create({
        data: {
          id: v.id, supplierId: v.supplierId, name: v.name, complex: v.complex,
          bedrooms: v.bedrooms, bathrooms: v.bathrooms, maxGuests: v.maxGuests,
          hasPool: v.hasPool, breakfastAvailable: v.breakfastAvailable,
          status: VillaStatus.ACTIVE, isSellable: true, icalImportUrls: [],
        },
      });
      const low = VILLA_COST_VND[v.id];
      const rates = [
        { season: SeasonType.LOW, cost: low },
        { season: SeasonType.HIGH, cost: (low * 14n) / 10n },
        { season: SeasonType.PEAK, cost: (low * 19n) / 10n },
      ];
      await prisma.villaRate.createMany({
        data: rates.map((r) => {
          const salePriceVnd = applyMarginVnd(r.cost, SEED_MARGIN_PERCENT);
          return {
            villaId: v.id, season: r.season, supplierCostVnd: r.cost,
            marginType: MarginType.PERCENT, marginValue: SEED_MARGIN_PERCENT,
            salePriceVnd, salePriceKrw: vndToKrwRounded(salePriceVnd, FX),
          };
        }),
      });
      const spaces: { space: PhotoSpace; label: string | null }[] = [
        { space: PhotoSpace.EXTERIOR, label: null },
        { space: PhotoSpace.LIVING, label: null },
        { space: PhotoSpace.KITCHEN, label: null },
        { space: PhotoSpace.BEDROOM, label: "침실 1" },
        { space: PhotoSpace.BEDROOM, label: "침실 2" },
        { space: PhotoSpace.BATHROOM, label: null },
      ];
      await prisma.villaPhoto.createMany({
        data: spaces.map((s, i) => ({
          id: `${v.id}-photo-${String(i + 1).padStart(2, "0")}`,
          villaId: v.id, space: s.space, spaceLabel: s.label,
          url: picsum(`${v.id}-${i}`), isBaseline: true, sortOrder: i, uploadedBy: SEED_ADMIN_ID,
        })),
      });
    }

    // ---------- 3) 예약 대량 생성 ----------
    const bookings: BookingMeta[] = [];
    let bkSeq = 0;

    function makeBooking(
      villaId: string,
      status: BookingStatus,
      checkIn: Date,
      nights: number,
      channel: BookingChannel,
      opts: { damage?: boolean; holdHours?: number } = {}
    ): BookingMeta {
      bkSeq += 1;
      const id = `demo-bk-${String(bkSeq).padStart(3, "0")}`;
      const checkOut = addDays(checkIn, nights);
      const cost = VILLA_COST_VND[villaId];
      const supplierCostVnd = cost * BigInt(nights);
      const saleVndPerNight = applyMarginVnd(cost, SEED_MARGIN_PERCENT);
      const isKrw = channel === BookingChannel.DIRECT;
      const saleCurrency = isKrw ? Currency.KRW : Currency.VND;
      const totalSaleKrw = isKrw ? vndToKrwRounded(saleVndPerNight, FX) * nights : null;
      const totalSaleVnd = isKrw ? null : saleVndPerNight * BigInt(nights);

      const guestName = isKrw ? pick(DIRECT_GUESTS) : pick(DIRECT_GUESTS);
      const agencyName =
        channel === BookingChannel.TRAVEL_AGENCY ? pick(TRAVEL_AGENCIES)
        : channel === BookingChannel.LAND_AGENCY ? pick(LAND_AGENCIES)
        : null;

      // 보증금: 확정 이후 단계만
      const settled = [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT, BookingStatus.NO_SHOW].includes(status);
      const depositCurrency = settled ? (isKrw ? Currency.KRW : Currency.VND) : null;
      const depositAmount = settled ? (isKrw ? 100_000 : 2_000_000) : null;
      const damage = !!opts.damage;
      let depositStatus: DepositStatus = DepositStatus.NONE;
      let depositDeductVnd: bigint | null = null;
      if (status === BookingStatus.CHECKED_OUT) {
        depositStatus = damage ? DepositStatus.PARTIAL_DEDUCTED : DepositStatus.REFUNDED;
        if (damage) depositDeductVnd = 800_000n;
      } else if (settled) {
        depositStatus = DepositStatus.HELD;
      }

      const meta: BookingMeta = {
        id, villaId, supplierId: VILLA_SUPPLIER[villaId], status, channel, saleCurrency,
        checkIn, checkOut, nights, supplierCostVnd, totalSaleKrw, totalSaleVnd,
        depositAmount, depositCurrency, guestName, damage,
      };
      bookings.push(meta);

      // 생성용 레코드를 별도 배열에 적재 (createMany는 아래에서 일괄)
      bookingRows.push({
        id, villaId, status, channel, checkIn, checkOut, nights,
        guestName, guestCount: 2 + Math.floor(rng() * 7), guestPhone: pick(KR_PHONES),
        agencyName,
        holdExpiresAt: status === BookingStatus.HOLD ? addHours(now, opts.holdHours ?? 24) : null,
        saleCurrency, totalSaleKrw, totalSaleVnd,
        fxVndPerKrw: isKrw ? null : FX,
        supplierCostVnd,
        depositAmount, depositCurrency, depositStatus, depositDeductVnd,
        breakfastIncluded: rng() > 0.5,
        note: null,
        cancelReason: status === BookingStatus.CANCELLED ? "고객 일정 변경으로 취소" : null,
        createdAt: addDays(checkIn, -7 - Math.floor(rng() * 14)),
      });
      return meta;
    }

    const bookingRows: any[] = [];

    const channels = [BookingChannel.DIRECT, BookingChannel.TRAVEL_AGENCY, BookingChannel.LAND_AGENCY];
    const nightsCycle = [2, 3, 4, 5, 3, 2, 4];
    let ni = 0;
    const nextNights = () => nightsCycle[ni++ % nightsCycle.length];

    // (A) 오늘 체크인 — CONFIRMED, checkIn = 오늘 (대시보드 '오늘 체크인' 카드)
    makeBooking("seed-villa-sonasea-v11", BookingStatus.CONFIRMED, today, 3, BookingChannel.DIRECT);
    makeBooking("seed-villa-sonasea-v25", BookingStatus.CONFIRMED, today, 4, BookingChannel.TRAVEL_AGENCY);
    makeBooking("seed-villa-sunset-sanato-a3", BookingStatus.CONFIRMED, today, 2, BookingChannel.LAND_AGENCY);

    // (B) 오늘 체크아웃 — CHECKED_IN, checkOut = 오늘 (대시보드 '오늘 체크아웃' 카드)
    makeBooking("seed-villa-sonasea-v12", BookingStatus.CHECKED_IN, addDays(today, -3), 3, BookingChannel.DIRECT);
    makeBooking(DEMO_VILLA_GREENBAY, BookingStatus.CHECKED_IN, addDays(today, -4), 4, BookingChannel.TRAVEL_AGENCY);
    makeBooking(DEMO_VILLA_MARINA, BookingStatus.CHECKED_IN, addDays(today, -2), 2, BookingChannel.DIRECT);

    // (C) 미래 확정 — CONFIRMED, 향후 3~25일 (타임라인·예약 목록·정산 예정)
    const futureOffsets = [3, 5, 8, 11, 14, 18, 22, 26];
    futureOffsets.forEach((off, i) => {
      makeBooking(ALL_VILLAS[i % ALL_VILLAS.length], BookingStatus.CONFIRMED, addDays(today, off), nextNights(), channels[i % 3]);
    });

    // (D) 가예약 HOLD — 만료 임박 배지용 (6h/18h/30h/40h/46h)
    const holdHours = [6, 18, 30, 40, 46];
    const holdBookings: BookingMeta[] = [];
    holdHours.forEach((h, i) => {
      holdBookings.push(
        makeBooking(ALL_VILLAS[i % ALL_VILLAS.length], BookingStatus.HOLD, addDays(today, 4 + i * 2), nextNights(), channels[i % 3], { holdHours: h })
      );
    });

    // (E) 과거 숙박 완료 — CHECKED_OUT, 최근 3일 ~ 75일 전 (이용 이력·정산·청소)
    const pastOffsets = [3, 6, 9, 13, 17, 21, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
    const checkedOut: BookingMeta[] = [];
    pastOffsets.forEach((off, i) => {
      const nights = nextNights();
      const checkOut = addDays(today, -off);
      const damage = i % 6 === 2; // 일부 파손 차감
      const m = makeBooking(ALL_VILLAS[i % ALL_VILLAS.length], BookingStatus.CHECKED_OUT, addDays(checkOut, -nights), nights, channels[i % 3], { damage });
      checkedOut.push(m);
    });

    // (F) 취소 / 만료 / 노쇼
    const cancelled: BookingMeta[] = [
      makeBooking("seed-villa-sonasea-v11", BookingStatus.CANCELLED, addDays(today, 9), 3, BookingChannel.TRAVEL_AGENCY),
      makeBooking(DEMO_VILLA_GREENBAY, BookingStatus.CANCELLED, addDays(today, -12), 2, BookingChannel.DIRECT),
      makeBooking("seed-villa-sonasea-v25", BookingStatus.CANCELLED, addDays(today, 16), 5, BookingChannel.LAND_AGENCY),
    ];
    makeBooking("seed-villa-sonasea-v12", BookingStatus.EXPIRED, addDays(today, -5), 2, BookingChannel.DIRECT);
    makeBooking("seed-villa-sunset-sanato-a3", BookingStatus.EXPIRED, addDays(today, -8), 3, BookingChannel.TRAVEL_AGENCY);
    makeBooking(DEMO_VILLA_MARINA, BookingStatus.EXPIRED, addDays(today, -3), 2, BookingChannel.DIRECT);
    const noShow1 = makeBooking("seed-villa-sonasea-v25", BookingStatus.NO_SHOW, addDays(today, -10), 2, BookingChannel.LAND_AGENCY);
    const noShow2 = makeBooking(DEMO_VILLA_GREENBAY, BookingStatus.NO_SHOW, addDays(today, -28), 3, BookingChannel.TRAVEL_AGENCY);

    await prisma.booking.createMany({ data: bookingRows });

    // ---------- 4) 체크인/체크아웃 기록 + 결제 ----------
    const checkInRows: any[] = [];
    const checkOutRows: any[] = [];
    const paymentRows: any[] = [];
    let ciSeq = 0, coSeq = 0, paySeq = 0;

    const addPayment = (m: BookingMeta, kind: "deposit" | "balance", at: Date) => {
      paySeq += 1;
      const isKrw = m.saleCurrency === Currency.KRW;
      const amount =
        kind === "deposit"
          ? BigInt(m.depositAmount ?? 0)
          : isKrw
            ? BigInt(m.totalSaleKrw ?? 0)
            : (m.totalSaleVnd ?? 0n);
      paymentRows.push({
        id: `demo-pay-${String(paySeq).padStart(3, "0")}`,
        bookingId: m.id,
        currency: kind === "deposit" ? (m.depositCurrency ?? m.saleCurrency) : m.saleCurrency,
        amount,
        method: isKrw ? PaymentMethod.KR_BANK_TRANSFER : PaymentMethod.VN_BANK_TRANSFER,
        fxRateToVnd: isKrw ? FX : null,
        vndEquivalent: isKrw ? BigInt(Math.round(Number(amount) * FX)) : amount,
        receivedAt: at,
        note: kind === "deposit" ? "보증금 입금" : "잔금 입금",
      });
    };

    for (const m of bookings) {
      const staying = m.status === BookingStatus.CHECKED_IN || m.status === BookingStatus.CHECKED_OUT;
      // 체크인 기록 (투숙 중·완료)
      if (staying) {
        ciSeq += 1;
        checkInRows.push({
          id: `demo-ci-${String(ciSeq).padStart(3, "0")}`,
          bookingId: m.id,
          passportPhotoUrls: [picsum(`${m.id}-passport1`), picsum(`${m.id}-passport2`)],
          passportOcrJson: { name: m.guestName, docNumber: "M1234567X", verified: true },
          tamTruSentAt: m.checkIn,
          agreementSignedAt: m.checkIn,
          signatureUrl: picsum(`${m.id}-sign`),
          notes: "안전수칙·기물파손 동의 완료",
          createdBy: SEED_ADMIN_ID,
          createdAt: m.checkIn,
        });
      }
      // 결제
      if ([BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT].includes(m.status)) {
        addPayment(m, "deposit", addDays(m.checkIn, -5));
        if (m.status === BookingStatus.CHECKED_OUT || m.status === BookingStatus.CHECKED_IN) {
          addPayment(m, "balance", m.checkIn);
        }
      }
      // 체크아웃 기록
      if (m.status === BookingStatus.CHECKED_OUT) {
        coSeq += 1;
        checkOutRows.push({
          id: `demo-co-${String(coSeq).padStart(3, "0")}`,
          bookingId: m.id,
          photoUrls: [picsum(`${m.id}-out1`), picsum(`${m.id}-out2`), picsum(`${m.id}-out3`)],
          damageFound: m.damage,
          damageNote: m.damage ? "거실 유리컵 파손 2개" : null,
          damagePhotoUrls: m.damage ? [picsum(`${m.id}-dmg`)] : [],
          deductionVnd: m.damage ? 800_000n : null,
          refundedAt: m.checkOut,
          createdBy: SEED_ADMIN_ID,
          createdAt: m.checkOut,
        });
      }
    }
    await prisma.checkInRecord.createMany({ data: checkInRows });
    await prisma.checkOutRecord.createMany({ data: checkOutRows });
    await prisma.payment.createMany({ data: paymentRows });

    // ---------- 5) 청소 검수 태스크 ----------
    // 최근 체크아웃 5건 → PHOTOS_SUBMITTED(승인 대기, 대시보드/검수 페이지), 일부 PENDING/REJECTED, 나머지 APPROVED
    const cleaningRows: any[] = [];
    let clSeq = 0;
    checkedOut.forEach((m, i) => {
      clSeq += 1;
      let status: CleaningStatus;
      if (i < 5) status = CleaningStatus.PHOTOS_SUBMITTED;
      else if (i === 5) status = CleaningStatus.PENDING;
      else if (i === 6) status = CleaningStatus.REJECTED;
      else status = CleaningStatus.APPROVED;
      const submitted = status !== CleaningStatus.PENDING;
      cleaningRows.push({
        id: `demo-cl-${String(clSeq).padStart(3, "0")}`,
        villaId: m.villaId,
        bookingId: m.id,
        type: CleaningType.CHECKOUT,
        status,
        assigneeId: CLEANER_LAN,
        photoUrls: submitted ? [picsum(`${m.id}-clean1`), picsum(`${m.id}-clean2`), picsum(`${m.id}-clean3`)] : [],
        rejectNote: status === CleaningStatus.REJECTED ? "수영장 바닥 청소 미흡 — 재청소 요망" : null,
        approvedBy: status === CleaningStatus.APPROVED ? SEED_ADMIN_ID : null,
        approvedAt: status === CleaningStatus.APPROVED ? addDays(m.checkOut, 1) : null,
        dueDate: m.checkOut,
        createdAt: m.checkOut,
      });
    });
    // 정기 방역 PERIODIC 2건 (대기/제출)
    cleaningRows.push({
      id: `demo-cl-periodic-1`, villaId: "seed-villa-sonasea-v25", bookingId: null,
      type: CleaningType.PERIODIC, status: CleaningStatus.PENDING, assigneeId: CLEANER_LAN,
      photoUrls: [], rejectNote: null, approvedBy: null, approvedAt: null,
      dueDate: addDays(today, 2), createdAt: addDays(today, -1),
    });
    cleaningRows.push({
      id: `demo-cl-periodic-2`, villaId: DEMO_VILLA_GREENBAY, bookingId: null,
      type: CleaningType.PERIODIC, status: CleaningStatus.PHOTOS_SUBMITTED, assigneeId: CLEANER_LAN,
      photoUrls: [picsum("periodic2-a"), picsum("periodic2-b")], rejectNote: null,
      approvedBy: null, approvedAt: null, dueDate: today, createdAt: addDays(today, -1),
    });
    await prisma.cleaningTask.createMany({ data: cleaningRows });

    // ---------- 6) 제안(가예약 링크) ----------
    const proposalRows: any[] = [];
    const proposalItemRows: any[] = [];
    const mkItem = (id: string, proposalId: string, villaId: string, checkIn: Date, nights: number, currency: Currency, bookingId?: string) => {
      const cost = VILLA_COST_VND[villaId];
      const saleVndPerNight = applyMarginVnd(cost, SEED_MARGIN_PERCENT);
      const isKrw = currency === Currency.KRW;
      proposalItemRows.push({
        id, proposalId, villaId, checkIn, checkOut: addDays(checkIn, nights),
        priceKrwPerNight: isKrw ? vndToKrwRounded(saleVndPerNight, FX) : null,
        totalKrw: isKrw ? vndToKrwRounded(saleVndPerNight, FX) * nights : null,
        priceVndPerNight: isKrw ? null : saleVndPerNight,
        totalVnd: isKrw ? null : saleVndPerNight * BigInt(nights),
        bookingId: bookingId ?? null,
      });
    };
    // P1 ACTIVE (여행사 VND, 3채)
    proposalRows.push({ id: "demo-prop-1", token: "demo-token-hanatour-jun", clientName: "하나투어 6월 단체", channel: BookingChannel.TRAVEL_AGENCY, saleCurrency: Currency.VND, fxVndPerKrw: FX, expiresAt: addHours(now, 36), status: ProposalStatus.ACTIVE, note: "6/25~6/28 8인 단체", createdAt: addMin(now, 90) });
    mkItem("demo-pi-1", "demo-prop-1", "seed-villa-sonasea-v11", addDays(today, 9), 3, Currency.VND);
    mkItem("demo-pi-2", "demo-prop-1", "seed-villa-sonasea-v25", addDays(today, 9), 3, Currency.VND);
    mkItem("demo-pi-3", "demo-prop-1", DEMO_VILLA_GREENBAY, addDays(today, 9), 3, Currency.VND);
    // P2 ACTIVE (직접 KRW, 2채)
    proposalRows.push({ id: "demo-prop-2", token: "demo-token-kim-family", clientName: "김선영 가족 (직접)", channel: BookingChannel.DIRECT, saleCurrency: Currency.KRW, fxVndPerKrw: FX, expiresAt: addHours(now, 20), status: ProposalStatus.ACTIVE, note: null, createdAt: addMin(now, 220) });
    mkItem("demo-pi-4", "demo-prop-2", "seed-villa-sunset-sanato-a3", addDays(today, 12), 4, Currency.KRW);
    mkItem("demo-pi-5", "demo-prop-2", DEMO_VILLA_MARINA, addDays(today, 12), 4, Currency.KRW);
    // P3 USED (HOLD 예약과 연결)
    proposalRows.push({ id: "demo-prop-3", token: "demo-token-modetour-jul", clientName: "모두투어 7월", channel: BookingChannel.LAND_AGENCY, saleCurrency: Currency.VND, fxVndPerKrw: FX, expiresAt: addHours(now, 30), status: ProposalStatus.USED, note: "가예약 발생", createdAt: addMin(now, 600) });
    mkItem("demo-pi-6", "demo-prop-3", holdBookings[0].villaId, holdBookings[0].checkIn, holdBookings[0].nights, Currency.VND, holdBookings[0].id);
    // P4 EXPIRED (만료)
    proposalRows.push({ id: "demo-prop-4", token: "demo-token-expired", clientName: "노랑풍선 (만료)", channel: BookingChannel.TRAVEL_AGENCY, saleCurrency: Currency.VND, fxVndPerKrw: FX, expiresAt: addDays(now, -3), status: ProposalStatus.ACTIVE, note: null, createdAt: addDays(now, -6) });
    mkItem("demo-pi-7", "demo-prop-4", "seed-villa-sonasea-v12", addDays(today, -1), 3, Currency.VND);
    // P5 REVOKED
    proposalRows.push({ id: "demo-prop-5", token: "demo-token-revoked", clientName: "참좋은여행 (회수)", channel: BookingChannel.TRAVEL_AGENCY, saleCurrency: Currency.VND, fxVndPerKrw: FX, expiresAt: addDays(now, 5), status: ProposalStatus.REVOKED, note: "중복 발송으로 회수", createdAt: addDays(now, -2) });
    mkItem("demo-pi-8", "demo-prop-5", "seed-villa-sonasea-v25", addDays(today, 20), 2, Currency.VND);
    // P6 ACTIVE (랜드사)
    proposalRows.push({ id: "demo-prop-6", token: "demo-token-saigon", clientName: "사이공 트래블 단체", channel: BookingChannel.LAND_AGENCY, saleCurrency: Currency.VND, fxVndPerKrw: FX, expiresAt: addHours(now, 44), status: ProposalStatus.ACTIVE, note: null, createdAt: addMin(now, 30) });
    mkItem("demo-pi-9", "demo-prop-6", DEMO_VILLA_GREENBAY, addDays(today, 14), 5, Currency.VND);
    mkItem("demo-pi-10", "demo-prop-6", "seed-villa-sonasea-v11", addDays(today, 14), 5, Currency.VND);
    await prisma.proposal.createMany({ data: proposalRows });
    await prisma.proposalItem.createMany({ data: proposalItemRows });

    // ---------- 7) 정산 (월별 × 공급자 — 체크아웃/노쇼 예약 집계) ----------
    const settleSource = [...checkedOut, noShow1, noShow2];
    const groups = new Map<string, { supplierId: string; ym: string; items: BookingMeta[] }>();
    for (const m of settleSource) {
      const ym = ymOf(m.checkOut);
      const key = `${m.supplierId}__${ym}`;
      if (!groups.has(key)) groups.set(key, { supplierId: m.supplierId, ym, items: [] });
      groups.get(key)!.items.push(m);
    }
    const settlementRows: any[] = [];
    const settlementItemRows: any[] = [];
    for (const g of groups.values()) {
      const total = g.items.reduce((s, m) => s + m.supplierCostVnd, 0n);
      const diff = curYmIdx - ymIndex(g.ym);
      const status = diff <= 0 ? SettlementStatus.DRAFT : diff === 1 ? SettlementStatus.CONFIRMED : SettlementStatus.PAID;
      const settlementId = `demo-settle-${g.supplierId}-${g.ym}`;
      settlementRows.push({
        id: settlementId, supplierId: g.supplierId, yearMonth: g.ym, totalVnd: total,
        status, paidAt: status === SettlementStatus.PAID ? addDays(now, -diff * 5) : null,
        statementUrl: null,
      });
      for (const m of g.items) {
        settlementItemRows.push({ id: `demo-si-${m.id}`, settlementId, bookingId: m.id, amountVnd: m.supplierCostVnd });
      }
    }
    await prisma.settlement.createMany({ data: settlementRows });
    await prisma.settlementItem.createMany({ data: settlementItemRows });

    // ---------- 8) 캘린더 차단 (수동 + iCal 충돌) ----------
    const futureConfirmed = bookings.find((b) => b.status === BookingStatus.CONFIRMED && b.checkIn > today)!;
    const blockRows: any[] = [
      { id: "demo-block-1", villaId: "seed-villa-sonasea-v25", startDate: addDays(today, 5), endDate: addDays(today, 8), source: BlockSource.MANUAL, icalUid: null, note: "수영장 보수", createdBy: SEED_ADMIN_ID, createdAt: addDays(now, -1) },
      { id: "demo-block-2", villaId: DEMO_VILLA_MARINA, startDate: addDays(today, 10), endDate: addDays(today, 12), source: BlockSource.MANUAL, icalUid: null, note: "오너 사용", createdBy: SEED_ADMIN_ID, createdAt: addDays(now, -2) },
      // iCal 충돌 — 확정 예약과 겹치는 외부 채널 차단 (대시보드 충돌 배너 + 푸터 lastSync)
      { id: "demo-block-ical-1", villaId: futureConfirmed.villaId, startDate: addDays(futureConfirmed.checkIn, 1), endDate: addDays(futureConfirmed.checkIn, 2), source: BlockSource.ICAL, icalUid: "demo-ical-airbnb-001", note: "Airbnb 동기화 (겹침)", createdBy: null, createdAt: addMin(now, 120) },
    ];
    await prisma.calendarBlock.createMany({ data: blockRows });

    // ---------- 9) 감사 로그 (활동 피드 — 최근순 8건+) ----------
    const recentCheckedOut = checkedOut[0];
    const recentCheckedIn = bookings.find((b) => b.status === BookingStatus.CHECKED_IN)!;
    const submittedCleaning = cleaningRows.find((c) => c.status === CleaningStatus.PHOTOS_SUBMITTED);
    const approvedCleaning = cleaningRows.find((c) => c.status === CleaningStatus.APPROVED);
    const signedCheckIn = checkInRows[0];
    const auditRows: any[] = [
      { id: "demo-al-01", userId: SEED_ADMIN_ID, action: "CREATE", entity: "Booking", entityId: holdBookings[0].id, changes: { status: { new: "HOLD" } }, createdAt: addMin(now, 4) },
      { id: "demo-al-02", userId: SEED_ADMIN_ID, action: "UPDATE", entity: "CleaningTask", entityId: submittedCleaning.id, changes: { status: { old: "PENDING", new: "PHOTOS_SUBMITTED" } }, createdAt: addMin(now, 25) },
      { id: "demo-al-03", userId: SEED_ADMIN_ID, action: "CREATE", entity: "Proposal", entityId: "demo-prop-6", changes: null, createdAt: addMin(now, 40) },
      { id: "demo-al-04", userId: SEED_ADMIN_ID, action: "UPDATE", entity: "Booking", entityId: futureConfirmed.id, changes: { status: { old: "HOLD", new: "CONFIRMED" } }, createdAt: addMin(now, 75) },
      { id: "demo-al-05", userId: SEED_ADMIN_ID, action: "CREATE", entity: "Proposal", entityId: "demo-prop-1", changes: null, createdAt: addMin(now, 95) },
      { id: "demo-al-06", userId: SEED_ADMIN_ID, action: "CREATE", entity: "CheckInRecord", entityId: signedCheckIn.id, changes: null, createdAt: addMin(now, 130) },
      { id: "demo-al-07", userId: SEED_ADMIN_ID, action: "UPDATE", entity: "Booking", entityId: recentCheckedIn.id, changes: { status: { old: "CONFIRMED", new: "CHECKED_IN" } }, createdAt: addMin(now, 150) },
      { id: "demo-al-08", userId: SEED_ADMIN_ID, action: "UPDATE", entity: "CleaningTask", entityId: approvedCleaning.id, changes: { status: { old: "PHOTOS_SUBMITTED", new: "APPROVED" } }, createdAt: addMin(now, 230) },
      { id: "demo-al-09", userId: SEED_ADMIN_ID, action: "UPDATE", entity: "Booking", entityId: recentCheckedOut.id, changes: { status: { old: "CHECKED_IN", new: "CHECKED_OUT" } }, createdAt: addMin(now, 300) },
      { id: "demo-al-10", userId: SEED_ADMIN_ID, action: "UPDATE", entity: "Villa", entityId: DEMO_VILLA_GREENBAY, changes: { status: { old: "PENDING_REVIEW", new: "ACTIVE" } }, createdAt: addMin(now, 600) },
      { id: "demo-al-11", userId: SEED_ADMIN_ID, action: "CREATE", entity: "Villa", entityId: DEMO_VILLA_MARINA, changes: null, createdAt: addMin(now, 800) },
      { id: "demo-al-12", userId: SEED_ADMIN_ID, action: "UPDATE", entity: "Booking", entityId: cancelled[0].id, changes: { status: { old: "CONFIRMED", new: "CANCELLED" } }, createdAt: addMin(now, 1500) },
    ];
    await prisma.auditLog.createMany({ data: auditRows });

    // ---------- 10) 알림 로그 (공급자 Zalo 발송 — SENT) ----------
    const notifRows: any[] = [
      { id: "demo-noti-1", userId: SEED_SUPPLIER_ID, type: NotificationType.BOOKING_CONFIRMED, channel: "ZALO", payload: { villa: "쏘나씨 V11", checkIn: todayStr }, status: NotificationStatus.SENT, sentAt: addMin(now, 70) },
      { id: "demo-noti-2", userId: SUPPLIER_GREENBAY, type: NotificationType.CLEANING_REQUEST, channel: "ZALO", payload: { villa: "그린베이 B2" }, status: NotificationStatus.SENT, sentAt: addMin(now, 200) },
      { id: "demo-noti-3", userId: SEED_SUPPLIER_ID, type: NotificationType.CLEANING_APPROVED, channel: "ZALO", payload: { villa: "쏘나씨 V25" }, status: NotificationStatus.SENT, sentAt: addMin(now, 240) },
      { id: "demo-noti-4", userId: SUPPLIER_MARINA, type: NotificationType.SETTLEMENT_READY, channel: "ZALO", payload: { yearMonth: ymOf(addDays(today, -35)) }, status: NotificationStatus.SENT, sentAt: addMin(now, 900) },
      { id: "demo-noti-5", userId: SEED_SUPPLIER_ID, type: NotificationType.TAMTRU_PASSPORT, channel: "ZALO", payload: { villa: "쏘나씨 V12" }, status: NotificationStatus.SENT, sentAt: addMin(now, 160) },
    ];
    await prisma.notification.createMany({ data: notifRows });

    // ---------- 요약 ----------
    const counts = {
      villas: await prisma.villa.count(),
      bookings: await prisma.booking.count(),
      checkIns: await prisma.checkInRecord.count(),
      checkOuts: await prisma.checkOutRecord.count(),
      payments: await prisma.payment.count(),
      cleaning: await prisma.cleaningTask.count(),
      proposals: await prisma.proposal.count(),
      settlements: await prisma.settlement.count(),
      settlementItems: await prisma.settlementItem.count(),
      blocks: await prisma.calendarBlock.count(),
      auditLogs: await prisma.auditLog.count(),
      notifications: await prisma.notification.count(),
    };
    console.log("✅ 데모 시드 완료(멱등):", counts);
    console.log(`   오늘(VN): ${todayStr} · 예약 ${bookingRows.length}건 (오늘 체크인 3 / 오늘 체크아웃 3 / HOLD 5 / 완료 ${checkedOut.length})`);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun = process.argv[1] && /seed-demo\.ts$/.test(process.argv[1]);
if (isDirectRun) {
  main().catch((e) => {
    console.error("❌ 데모 시드 실패:", e);
    process.exit(1);
  });
}
