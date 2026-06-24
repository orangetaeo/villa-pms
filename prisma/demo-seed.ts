/**
 * DEMO 시드 — "실 사용된 것 같은" 과거 이력 데이터 (수동 테스트용)
 *
 * 모든 행 id는 `demo-` 접두 → prisma/demo-purge.ts 로 1줄 정리 가능.
 * 멱등: 고정 id upsert → 재실행해도 행 수 불변.
 * 실행:   npx tsx prisma/demo-seed.ts
 * 정리:   npx tsx prisma/demo-purge.ts
 *
 * ⚠️ 대상 DB = .env DATABASE_URL (현재 Railway 프로덕션). 오픈 전 반드시 demo-purge 실행.
 * ⚠️ 사진은 picsum.photos placeholder (next.config remotePatterns에 도메인 등재됨).
 * 주의(사업 원칙 2): salePrice*·margin은 ADMIN 전용. 공급자/공개 응답엔 노출 안 됨(기존 가드).
 *
 * 기준일(오늘) 가정: 2026-06-16 (Asia/Ho_Chi_Minh). 과거=체크아웃 이력, 현재=체크인 중, 미래=확정/홀드.
 */
import {
  PrismaClient,
  Role,
  VillaStatus,
  PhotoSpace,
  SeasonType,
  MarginType,
  AmenityCategory,
  BookingStatus,
  BookingChannel,
  Currency,
  DepositStatus,
  PaymentMethod,
  CleaningType,
  CleaningStatus,
  SettlementStatus,
  ProposalStatus,
  NotificationType,
  NotificationStatus,
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { buildRatePeriodRowsFromSeasonCosts } from "../lib/pricing";

const prisma = new PrismaClient();

// ===================== 상수 =====================

const FX = 18.87; // 1 KRW = 18.87 VND
const MARGIN = 20n; // %
const DEMO_ADMIN_TAG = "demo-admin"; // createdBy/uploadedBy 문자열 태그(FK 아님)

/** @db.Date 용 UTC 자정. */
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
/** 타임스탬프(시각 포함) — 활동 피드/대화 정렬용. */
const ts = (y: number, m: number, day: number, h = 9, min = 0) =>
  new Date(Date.UTC(y, m - 1, day, h - 7, min)); // VN(UTC+7) 기준 표시

/** 원가(VND) → 판매가(VND): ×(100+마진)/100. */
const saleVnd = (cost: bigint) => (cost * (100n + MARGIN)) / 100n;
/** 판매가(VND) → KRW 천원 라운딩. */
const saleKrw = (vnd: bigint) => Math.round(Number(vnd) / FX / 1000) * 1000;

/** checkIn 월 → 시즌 (시드 시즌달력과 동일 규약: 여름 HIGH, 2·12월 PEAK, 그 외 LOW). */
function seasonOfMonth(month1: number): SeasonType {
  if (month1 === 2 || month1 === 12) return SeasonType.PEAK;
  if (month1 >= 6 && month1 <= 8) return SeasonType.HIGH;
  return SeasonType.LOW;
}

// ===================== 빌라 정의 =====================

interface DemoVilla {
  id: string;
  name: string;
  complex: string;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  hasPool: boolean;
  breakfast: boolean;
  rate: Record<SeasonType, bigint>; // 박당 원가(VND)
}

const VILLAS: DemoVilla[] = [
  {
    id: "demo-villa-pearl",
    name: "Pearl Villa P7",
    complex: "Grand World",
    bedrooms: 4,
    bathrooms: 4,
    maxGuests: 10,
    hasPool: true,
    breakfast: true,
    rate: { LOW: 4_000_000n, HIGH: 6_000_000n, PEAK: 8_000_000n },
  },
  {
    id: "demo-villa-ocean",
    name: "Ocean Pearl O2",
    complex: "Sonasea",
    bedrooms: 3,
    bathrooms: 3,
    maxGuests: 8,
    hasPool: true,
    breakfast: true,
    rate: { LOW: 3_200_000n, HIGH: 4_800_000n, PEAK: 6_500_000n },
  },
  {
    id: "demo-villa-garden",
    name: "Garden House G5",
    complex: "Sunset Sanato",
    bedrooms: 2,
    bathrooms: 2,
    maxGuests: 6,
    hasPool: false,
    breakfast: false,
    rate: { LOW: 2_200_000n, HIGH: 3_200_000n, PEAK: 4_500_000n },
  },
];

const villaById = Object.fromEntries(VILLAS.map((v) => [v.id, v]));

/** picsum 시드 URL — 빌라 외 데모 이미지(여권·서명·청소 등 placeholder)용. */
const pic = (seed: string) => `https://picsum.photos/seed/${seed}/1024/768`;

/** Google Drive 공개 링크 이미지 CDN URL (파일을 '링크가 있는 모든 사용자' 공유 시 렌더). */
const drive = (id: string) => `https://lh3.googleusercontent.com/d/${id}=w1280`;

/**
 * 실제 푸꾸옥 빌라 사진 (Google Drive '07. 빌라 > 푸꾸옥 빌라' > 쏘나씨 V11·V25).
 * ⚠️ 이미지가 보이려면 Drive 폴더를 "링크가 있는 모든 사용자 — 뷰어"로 공유해야 함.
 */
const VILLA_DRIVE_PHOTOS: Record<string, Partial<Record<PhotoSpace, string>>> = {
  // demo-villa-pearl ← 쏘나씨 V11/V25 혼합(독립 세트)
  "demo-villa-pearl": {
    EXTERIOR: "1eJtfsLxZ-NixoZr6iwx4t41uWl89lJM7",
    LIVING: "1Qk-6etxQlqPyrf_wds_bjYGCSKxydkmH",
    KITCHEN: "1VfvmwOi1CAtvlz8Kty41DTlCLXvn-csx",
    BEDROOM: "1T2OEi4XLtbp8p6SG45HtUvDZnauDOlB-",
    POOL: "1ausldJ-VSYQiMO6dWmVidrdcPEA-FaGb",
  },
  // demo-villa-ocean ← 쏘나씨 V11
  "demo-villa-ocean": {
    EXTERIOR: "1eGxWKKM0tsW4SHvBVCgaVKPsUQsf57Fy",
    LIVING: "1UWa-1BoCQfqUCbAR9KNuvafoFElnxLJT",
    KITCHEN: "1ybV52F2ofjtFIl0asBREP1bpRYETMg_-",
    BEDROOM: "1x2Lp0Rx3xLzlUhZpUw51Ml_pqW2ivM5M",
    POOL: "1Z_hbU7XrVyput17-J4eTn5MeqQSJBwfM",
  },
  // demo-villa-garden ← 쏘나씨 V25 (수영장 없음)
  "demo-villa-garden": {
    EXTERIOR: "1NtY5vFfwtAgroIv_-_2MJAIWjgfZVDfo",
    LIVING: "1bVK3x26109_b96aElCmOGFRP7pc32e0E",
    KITCHEN: "1Kgvjq-4tRZmGlbAzCupArdlE9RhW-Vw9",
    BEDROOM: "1akaKGOBbCJHDfZbsQrR82qT4tf-sLoZJ",
  },
};

const PHOTO_SPACES: { space: PhotoSpace; label: string | null }[] = [
  { space: PhotoSpace.EXTERIOR, label: null },
  { space: PhotoSpace.LIVING, label: null },
  { space: PhotoSpace.KITCHEN, label: null },
  { space: PhotoSpace.BEDROOM, label: "Phòng ngủ 1" },
  { space: PhotoSpace.POOL, label: null },
];

const AMENITIES: { category: AmenityCategory; itemKey: string; quantity: number; unitPrice?: bigint }[] = [
  { category: AmenityCategory.KITCHEN, itemKey: "kettle", quantity: 1 },
  { category: AmenityCategory.KITCHEN, itemKey: "fridge", quantity: 1 },
  { category: AmenityCategory.APPLIANCE, itemKey: "tv", quantity: 1 },
  { category: AmenityCategory.APPLIANCE, itemKey: "washingMachine", quantity: 1 },
  { category: AmenityCategory.BATHROOM, itemKey: "hairDryer", quantity: 1 },
  // 미니바 — 고객 청구 단가(VND). 체크인 시트 미니바 정산표 데모용 (수량=비치, 단가 표시)
  { category: AmenityCategory.MINIBAR, itemKey: "water", quantity: 6, unitPrice: 20_000n },
  { category: AmenityCategory.MINIBAR, itemKey: "softDrink", quantity: 6, unitPrice: 20_000n },
  { category: AmenityCategory.MINIBAR, itemKey: "beer", quantity: 4, unitPrice: 40_000n },
];

// ===================== 예약 정의 =====================

type Cur = "KRW" | "VND";
interface DemoBooking {
  id: string;
  villaId: string;
  status: BookingStatus;
  channel: BookingChannel;
  cur: Cur;
  ci: [number, number, number]; // checkIn  [y,m,d]
  co: [number, number, number]; // checkOut [y,m,d]
  guest: string;
  guests: number;
  agency?: string;
  holdH?: number; // HOLD: 만료까지 시간(기준 6/16 12:00 VN 기준 ±)
  cancelReason?: string;
}

// 기준일 2026-06-16. 과거(4~5월)=체크아웃, 현재(6/14~18)=체크인 중, 미래=확정/홀드.
const BOOKINGS: DemoBooking[] = [
  // ── 과거 체크아웃 (4월) → 정산 2026-04 ──
  { id: "demo-bk-01", villaId: "demo-villa-pearl", status: BookingStatus.CHECKED_OUT, channel: BookingChannel.TRAVEL_AGENCY, cur: "KRW", ci: [2026, 4, 10], co: [2026, 4, 13], guest: "김민준", guests: 8, agency: "하나투어" },
  { id: "demo-bk-02", villaId: "demo-villa-ocean", status: BookingStatus.CHECKED_OUT, channel: BookingChannel.LAND_AGENCY, cur: "VND", ci: [2026, 4, 18], co: [2026, 4, 21], guest: "Phú Quốc Land", guests: 6, agency: "PQ Land Co." },
  { id: "demo-bk-03", villaId: "demo-villa-garden", status: BookingStatus.CHECKED_OUT, channel: BookingChannel.DIRECT, cur: "KRW", ci: [2026, 4, 25], co: [2026, 4, 27], guest: "이서연", guests: 4 },
  // ── 과거 체크아웃 (5월) → 정산 2026-05 ──
  { id: "demo-bk-04", villaId: "demo-villa-pearl", status: BookingStatus.CHECKED_OUT, channel: BookingChannel.DIRECT, cur: "KRW", ci: [2026, 5, 2], co: [2026, 5, 5], guest: "박지후", guests: 9 }, // 파손 차감
  { id: "demo-bk-05", villaId: "demo-villa-ocean", status: BookingStatus.CHECKED_OUT, channel: BookingChannel.TRAVEL_AGENCY, cur: "VND", ci: [2026, 5, 15], co: [2026, 5, 18], guest: "모두투어", guests: 7, agency: "모두투어" },
  { id: "demo-bk-06", villaId: "demo-villa-garden", status: BookingStatus.CHECKED_OUT, channel: BookingChannel.LAND_AGENCY, cur: "VND", ci: [2026, 5, 22], co: [2026, 5, 25], guest: "Saigon Tourist", guests: 5, agency: "Saigon Tourist" },
  // ── 노쇼 ──
  { id: "demo-bk-07", villaId: "demo-villa-garden", status: BookingStatus.NO_SHOW, channel: BookingChannel.DIRECT, cur: "KRW", ci: [2026, 5, 28], co: [2026, 5, 30], guest: "최도윤", guests: 4 },
  // ── 현재 체크인 중 (6/14~18, 오늘 6/16) ──
  { id: "demo-bk-08", villaId: "demo-villa-pearl", status: BookingStatus.CHECKED_IN, channel: BookingChannel.TRAVEL_AGENCY, cur: "KRW", ci: [2026, 6, 14], co: [2026, 6, 18], guest: "정하준", guests: 8, agency: "노랑풍선" },
  // ── 미래 확정 ──
  { id: "demo-bk-09", villaId: "demo-villa-ocean", status: BookingStatus.CONFIRMED, channel: BookingChannel.DIRECT, cur: "KRW", ci: [2026, 6, 20], co: [2026, 6, 23], guest: "강시우", guests: 6 },
  { id: "demo-bk-10", villaId: "demo-villa-pearl", status: BookingStatus.CONFIRMED, channel: BookingChannel.LAND_AGENCY, cur: "VND", ci: [2026, 6, 25], co: [2026, 6, 28], guest: "Vietravel", guests: 9, agency: "Vietravel" },
  // ── 활성 홀드 (가예약, 미래) ──
  { id: "demo-bk-11", villaId: "demo-villa-garden", status: BookingStatus.HOLD, channel: BookingChannel.DIRECT, cur: "KRW", ci: [2026, 6, 22], co: [2026, 6, 24], guest: "윤채원", guests: 4, holdH: 30 },
  // ── 만료된 홀드 ──
  { id: "demo-bk-12", villaId: "demo-villa-ocean", status: BookingStatus.EXPIRED, channel: BookingChannel.TRAVEL_AGENCY, cur: "KRW", ci: [2026, 6, 10], co: [2026, 6, 12], guest: "임지안", guests: 6, agency: "참좋은여행", holdH: -120 },
  // ── 취소 ──
  { id: "demo-bk-13", villaId: "demo-villa-pearl", status: BookingStatus.CANCELLED, channel: BookingChannel.DIRECT, cur: "KRW", ci: [2026, 6, 5], co: [2026, 6, 7], guest: "한서진", guests: 7, cancelReason: "고객 일정 변경으로 취소" },
];

function nights(ci: number[], co: number[]) {
  return Math.round((Date.UTC(co[0], co[1] - 1, co[2]) - Date.UTC(ci[0], ci[1] - 1, ci[2])) / 86400000);
}

interface Amounts {
  nights: number;
  costVnd: bigint;
  saleVnd: bigint | null;
  saleKrw: number | null;
}
function amountsFor(b: DemoBooking): Amounts {
  const v = villaById[b.villaId];
  const n = nights(b.ci, b.co);
  const nightly = v.rate[seasonOfMonth(b.ci[1])];
  const cost = nightly * BigInt(n);
  const sVnd = saleVnd(cost);
  return {
    nights: n,
    costVnd: cost,
    saleVnd: b.cur === "VND" ? sVnd : null,
    saleKrw: b.cur === "KRW" ? saleKrw(sVnd) : null,
  };
}

// ===================== 적재 =====================

async function main() {
  // ---------- 1) 사용자 (데모 공급자 + 청소자) ----------
  const supplierHash = await hash("demo1234", 10);
  const cleanerHash = await hash("demo1234", 10);

  await prisma.user.upsert({
    where: { id: "demo-supplier-tuan" },
    update: { name: "Anh Tuấn (데모 공급자)", role: Role.SUPPLIER, locale: "vi", isActive: true },
    create: {
      id: "demo-supplier-tuan",
      role: Role.SUPPLIER,
      name: "Anh Tuấn (데모 공급자)",
      phone: "0901234567",
      passwordHash: supplierHash,
      locale: "vi",
    },
  });

  await prisma.user.upsert({
    where: { id: "demo-cleaner-hoa" },
    update: { name: "Chị Hoa (데모 청소)", role: Role.CLEANER, locale: "vi", isActive: true },
    create: {
      id: "demo-cleaner-hoa",
      role: Role.CLEANER,
      name: "Chị Hoa (데모 청소)",
      phone: "0907654321",
      passwordHash: cleanerHash,
      locale: "vi",
    },
  });

  // ---------- 2) 빌라 + 요율 + 사진 + 비품 ----------
  // 전역 SeasonPeriod(seed.ts 적재) — VillaRatePeriod 웃돈 기간의 날짜 템플릿. 없으면 base만 생성.
  const globalSeasons = await prisma.seasonPeriod.findMany({
    select: { season: true, startDate: true, endDate: true, label: true },
  });
  for (const v of VILLAS) {
    await prisma.villa.upsert({
      where: { id: v.id },
      update: {
        name: v.name, complex: v.complex, bedrooms: v.bedrooms, bathrooms: v.bathrooms,
        maxGuests: v.maxGuests, hasPool: v.hasPool, breakfastAvailable: v.breakfast,
        status: VillaStatus.ACTIVE, isSellable: true,
      },
      create: {
        id: v.id, supplierId: "demo-supplier-tuan", name: v.name, complex: v.complex,
        address: "Phú Quốc, Kiên Giang", bedrooms: v.bedrooms, bathrooms: v.bathrooms,
        maxGuests: v.maxGuests, hasPool: v.hasPool, breakfastAvailable: v.breakfast,
        status: VillaStatus.ACTIVE, isSellable: true, icalImportUrls: [],
        createdAt: ts(2026, 3, 20),
      },
    });

    // 요율(ADR-0014 VillaRatePeriod) — base(LOW 배경) + 전역 비-LOW 시즌 스냅샷(실마진 적용).
    //   전역 SeasonPeriod(seed.ts가 적재) 날짜 템플릿 사용. 멱등: 빌라별 deleteMany → create.
    const withMargin = (cost: bigint) => {
      const sv = saleVnd(cost);
      return { marginType: MarginType.PERCENT, marginValue: MARGIN, salePriceVnd: sv, salePriceKrw: saleKrw(sv) };
    };
    const { base, periods } = buildRatePeriodRowsFromSeasonCosts(
      { LOW: v.rate.LOW, HIGH: v.rate.HIGH, PEAK: v.rate.PEAK },
      globalSeasons
    );
    await prisma.villaRatePeriod.deleteMany({ where: { villaId: v.id } });
    await prisma.villaRatePeriod.create({
      data: { ...base, ...withMargin(base.supplierCostVnd), villaId: v.id },
    });
    if (periods.length > 0) {
      await prisma.villaRatePeriod.createMany({
        data: periods.map((p) => ({ ...p, ...withMargin(p.supplierCostVnd), villaId: v.id })),
      });
    }

    let sort = 0;
    const drivePhotos = VILLA_DRIVE_PHOTOS[v.id] ?? {};
    for (const ps of PHOTO_SPACES) {
      const driveId = drivePhotos[ps.space];
      if (!driveId) continue; // 매핑 없는 공간(예: 수영장 없는 빌라)은 건너뜀
      const url = drive(driveId);
      const id = `${v.id}-photo-${ps.space.toLowerCase()}`;
      await prisma.villaPhoto.upsert({
        where: { id },
        update: { url, space: ps.space, spaceLabel: ps.label, sortOrder: sort },
        create: { id, villaId: v.id, space: ps.space, spaceLabel: ps.label, url, isBaseline: true, sortOrder: sort, uploadedBy: DEMO_ADMIN_TAG },
      });
      sort++;
    }

    for (const a of AMENITIES) {
      const id = `${v.id}-am-${a.itemKey}`;
      await prisma.villaAmenity.upsert({
        where: { id },
        update: { quantity: a.quantity, unitPrice: a.unitPrice ?? null },
        create: {
          id,
          villaId: v.id,
          category: a.category,
          itemKey: a.itemKey,
          quantity: a.quantity,
          unitPrice: a.unitPrice ?? null,
        },
      });
    }
  }

  // ---------- 3) 예약 + 체크인/아웃 + 결제 + 청소 ----------
  for (const b of BOOKINGS) {
    const a = amountsFor(b);
    const isPast = b.status === BookingStatus.CHECKED_OUT || b.status === BookingStatus.NO_SHOW;
    const hasDeposit = ([BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT, BookingStatus.CONFIRMED] as BookingStatus[]).includes(b.status);
    const damaged = b.id === "demo-bk-04";

    let depositStatus: DepositStatus = DepositStatus.NONE;
    if (b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.CHECKED_IN) depositStatus = DepositStatus.HELD;
    else if (b.status === BookingStatus.CHECKED_OUT) depositStatus = damaged ? DepositStatus.PARTIAL_DEDUCTED : DepositStatus.REFUNDED;

    const holdExpiresAt = b.holdH != null ? new Date(Date.UTC(2026, 5, 16, 5, 0) + b.holdH * 3600000) : null;

    const common = {
      villaId: b.villaId,
      status: b.status,
      channel: b.channel,
      checkIn: d(...b.ci),
      checkOut: d(...b.co),
      nights: a.nights,
      guestName: b.guest,
      guestCount: b.guests,
      guestPhone: b.cur === "KRW" ? "+82-10-1234-5678" : "+84-90-111-2222",
      agencyName: b.agency ?? null,
      holdExpiresAt,
      saleCurrency: b.cur === "KRW" ? Currency.KRW : Currency.VND,
      totalSaleKrw: a.saleKrw,
      totalSaleVnd: a.saleVnd,
      fxVndPerKrw: FX,
      supplierCostVnd: a.costVnd,
      depositAmount: hasDeposit ? (b.cur === "KRW" ? 200_000 : 3_000_000) : null,
      depositCurrency: hasDeposit ? (b.cur === "KRW" ? Currency.KRW : Currency.VND) : null,
      depositStatus,
      depositDeductVnd: damaged ? 1_500_000n : null,
      breakfastIncluded: villaById[b.villaId].breakfast,
      cancelReason: b.cancelReason ?? null,
      note: null,
      createdAt: ts(b.ci[0], b.ci[1], Math.max(1, b.ci[2] - 7), 10),
    };

    await prisma.booking.upsert({ where: { id: b.id }, update: common, create: { id: b.id, ...common } });

    // 체크인 기록 (체크인 이후 상태)
    if (b.status === BookingStatus.CHECKED_IN || b.status === BookingStatus.CHECKED_OUT) {
      await prisma.checkInRecord.upsert({
        where: { bookingId: b.id },
        update: {},
        create: {
          id: `demo-cir-${b.id}`,
          bookingId: b.id,
          passportPhotoUrls: [pic(`${b.id}-passport1`), pic(`${b.id}-passport2`)],
          tamTruSentAt: ts(b.ci[0], b.ci[1], b.ci[2], 14),
          agreementSignedAt: ts(b.ci[0], b.ci[1], b.ci[2], 14, 30),
          signatureUrl: pic(`${b.id}-sig`),
          createdBy: DEMO_ADMIN_TAG,
          createdAt: ts(b.ci[0], b.ci[1], b.ci[2], 14),
        },
      });
    }

    // 체크아웃 기록 + 청소 태스크 (체크아웃 완료분)
    if (b.status === BookingStatus.CHECKED_OUT) {
      await prisma.checkOutRecord.upsert({
        where: { bookingId: b.id },
        update: {},
        create: {
          id: `demo-cor-${b.id}`,
          bookingId: b.id,
          photoUrls: [pic(`${b.id}-out1`), pic(`${b.id}-out2`)],
          damageFound: damaged,
          damageNote: damaged ? "거실 유리컵 2개 파손, 소파 오염" : null,
          damagePhotoUrls: damaged ? [pic(`${b.id}-damage`)] : [],
          deductionVnd: damaged ? 1_500_000n : null,
          refundedAt: ts(b.co[0], b.co[1], b.co[2], 11),
          createdBy: DEMO_ADMIN_TAG,
          createdAt: ts(b.co[0], b.co[1], b.co[2], 11),
        },
      });

      // 체크아웃 청소 → 승인 완료(과거)
      await prisma.cleaningTask.upsert({
        where: { id: `demo-clean-${b.id}` },
        update: { status: CleaningStatus.APPROVED },
        create: {
          id: `demo-clean-${b.id}`,
          villaId: b.villaId,
          bookingId: b.id,
          type: CleaningType.CHECKOUT,
          status: CleaningStatus.APPROVED,
          assigneeId: "demo-cleaner-hoa",
          photoUrls: [pic(`${b.id}-clean1`), pic(`${b.id}-clean2`)],
          approvedBy: DEMO_ADMIN_TAG,
          approvedAt: ts(b.co[0], b.co[1], b.co[2], 16),
          dueDate: d(...b.co),
          createdAt: ts(b.co[0], b.co[1], b.co[2], 12),
        },
      });
    }

    // 결제 (확정 이상)
    if (([BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT] as BookingStatus[]).includes(b.status)) {
      const amt = b.cur === "KRW" ? BigInt(a.saleKrw ?? 0) : (a.saleVnd ?? 0n);
      await prisma.payment.upsert({
        where: { id: `demo-pay-${b.id}` },
        update: { amount: amt },
        create: {
          id: `demo-pay-${b.id}`,
          bookingId: b.id,
          currency: b.cur === "KRW" ? Currency.KRW : Currency.VND,
          amount: amt,
          method: b.cur === "KRW" ? PaymentMethod.KR_BANK_TRANSFER : PaymentMethod.VN_BANK_TRANSFER,
          receivedAt: ts(b.ci[0], b.ci[1], Math.max(1, b.ci[2] - 5), 15),
          createdAt: ts(b.ci[0], b.ci[1], Math.max(1, b.ci[2] - 5), 15),
        },
      });
    }
  }

  // ---------- 4) 검수 대기 청소 태스크 (/inspections 큐 채우기) ----------
  // 현재 체크인 중인 Pearl 빌라의 정기 방역 — 사진 제출됨, 승인 대기
  await prisma.cleaningTask.upsert({
    where: { id: "demo-clean-pending-1" },
    update: { status: CleaningStatus.PHOTOS_SUBMITTED },
    create: {
      id: "demo-clean-pending-1",
      villaId: "demo-villa-ocean",
      type: CleaningType.PERIODIC,
      status: CleaningStatus.PHOTOS_SUBMITTED,
      assigneeId: "demo-cleaner-hoa",
      photoUrls: [pic("periodic-ocean-1"), pic("periodic-ocean-2")],
      dueDate: d(2026, 6, 15),
      createdAt: ts(2026, 6, 15, 9),
    },
  });
  // Garden 빌라 정기 방역 — 청소 대기 (미제출)
  await prisma.cleaningTask.upsert({
    where: { id: "demo-clean-pending-2" },
    update: { status: CleaningStatus.PENDING },
    create: {
      id: "demo-clean-pending-2",
      villaId: "demo-villa-garden",
      type: CleaningType.PERIODIC,
      status: CleaningStatus.PENDING,
      assigneeId: "demo-cleaner-hoa",
      photoUrls: [],
      dueDate: d(2026, 6, 18),
      createdAt: ts(2026, 6, 16, 8),
    },
  });

  // ---------- 5) 캘린더 차단 (외부 채널 iCal + 수동) ----------
  await prisma.calendarBlock.upsert({
    where: { id: "demo-block-1" },
    update: {},
    create: { id: "demo-block-1", villaId: "demo-villa-ocean", startDate: d(2026, 7, 1), endDate: d(2026, 7, 4), source: "ICAL", icalUid: "demo-airbnb-uid-1", note: "Airbnb 예약", createdAt: ts(2026, 6, 10) },
  });
  await prisma.calendarBlock.upsert({
    where: { id: "demo-block-2" },
    update: {},
    create: { id: "demo-block-2", villaId: "demo-villa-garden", startDate: d(2026, 6, 30), endDate: d(2026, 7, 2), source: "MANUAL", note: "수영장 보수", createdBy: "demo-supplier-tuan", createdAt: ts(2026, 6, 12) },
  });

  // ---------- 6) 제안 (USED→홀드 / ACTIVE / EXPIRED / REVOKED) ----------
  // P1: USED — demo-bk-11(홀드)로 전환됨
  await upsertProposal({
    id: "demo-prop-used", token: "demo-token-used-xyz", clientName: "윤채원", channel: BookingChannel.DIRECT, cur: "KRW",
    status: ProposalStatus.USED, expiresAt: ts(2026, 6, 17, 18), createdAt: ts(2026, 6, 15, 10),
    items: [{ id: "demo-pi-used-1", villaId: "demo-villa-garden", ci: [2026, 6, 22], co: [2026, 6, 24], bookingId: "demo-bk-11" }],
  });
  // P2: ACTIVE — /p/demo-token-active-abc 로 공개 페이지 테스트 가능
  await upsertProposal({
    id: "demo-prop-active", token: "demo-token-active-abc", clientName: "삼성웰스토리 워크샵", channel: BookingChannel.TRAVEL_AGENCY, cur: "VND",
    status: ProposalStatus.ACTIVE, expiresAt: ts(2026, 6, 18, 23), createdAt: ts(2026, 6, 16, 9),
    items: [
      { id: "demo-pi-active-1", villaId: "demo-villa-pearl", ci: [2026, 7, 10], co: [2026, 7, 13] },
      { id: "demo-pi-active-2", villaId: "demo-villa-ocean", ci: [2026, 7, 10], co: [2026, 7, 13] },
    ],
  });
  // P3: EXPIRED
  await upsertProposal({
    id: "demo-prop-expired", token: "demo-token-expired-def", clientName: "롯데관광", channel: BookingChannel.LAND_AGENCY, cur: "VND",
    status: ProposalStatus.EXPIRED, expiresAt: ts(2026, 6, 12, 18), createdAt: ts(2026, 6, 10, 14),
    items: [{ id: "demo-pi-expired-1", villaId: "demo-villa-pearl", ci: [2026, 6, 28], co: [2026, 7, 1] }],
  });
  // P4: REVOKED
  await upsertProposal({
    id: "demo-prop-revoked", token: "demo-token-revoked-ghi", clientName: "개인고객 문의", channel: BookingChannel.DIRECT, cur: "KRW",
    status: ProposalStatus.REVOKED, expiresAt: ts(2026, 6, 20, 18), createdAt: ts(2026, 6, 14, 11),
    items: [{ id: "demo-pi-revoked-1", villaId: "demo-villa-garden", ci: [2026, 7, 5], co: [2026, 7, 7] }],
  });

  // ---------- 7) 정산 (4월 PAID / 5월 CONFIRMED) ----------
  await upsertSettlement("demo-stl-apr", "2026-04", SettlementStatus.PAID, ts(2026, 5, 5, 10), ["demo-bk-01", "demo-bk-02", "demo-bk-03"]);
  await upsertSettlement("demo-stl-may", "2026-05", SettlementStatus.CONFIRMED, null, ["demo-bk-04", "demo-bk-05", "demo-bk-06"]);

  // ---------- 8) 알림 이력 (발송 완료) ----------
  const notifs: { id: string; type: NotificationType; at: Date; payload: object }[] = [
    { id: "demo-noti-1", type: NotificationType.BOOKING_CONFIRMED, at: ts(2026, 6, 9, 16), payload: { villaName: "Ocean Pearl O2", checkIn: "2026-06-20" } },
    { id: "demo-noti-2", type: NotificationType.CLEANING_APPROVED, at: ts(2026, 5, 25, 16), payload: { villaName: "Garden House G5" } },
    { id: "demo-noti-3", type: NotificationType.SETTLEMENT_READY, at: ts(2026, 5, 5, 10), payload: { yearMonth: "2026-04" } },
    { id: "demo-noti-4", type: NotificationType.BOOKING_HOLD, at: ts(2026, 6, 15, 10), payload: { villaName: "Garden House G5", checkIn: "2026-06-22" } },
  ];
  for (const n of notifs) {
    await prisma.notification.upsert({
      where: { id: n.id },
      update: { status: NotificationStatus.SENT },
      create: { id: n.id, userId: "demo-supplier-tuan", type: n.type, channel: "ZALO", payload: n.payload, status: NotificationStatus.SENT, sentAt: n.at, createdAt: n.at },
    });
  }

  // ---------- 9) Zalo 대화 (인박스 + 메시지) ----------
  // ADR-0007: 대화는 ownerAdminId(소유 ADMIN) 필수. 데모는 첫 ADMIN(테오) 소유로 귀속.
  const demoOwnerAdmin = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (demoOwnerAdmin) {
    await prisma.zaloConversation.upsert({
      where: { id: "demo-conv-tuan" },
      update: { ownerAdminId: demoOwnerAdmin.id, lastMessageAt: ts(2026, 6, 16, 8, 30), lastInboundAt: ts(2026, 6, 16, 8, 30), unreadCount: 1 },
      create: {
        id: "demo-conv-tuan",
        ownerAdminId: demoOwnerAdmin.id,
        zaloUserId: "demo-zalo-tuan",
        userId: "demo-supplier-tuan",
        displayName: "Anh Tuấn",
        lastMessageAt: ts(2026, 6, 16, 8, 30),
        lastInboundAt: ts(2026, 6, 16, 8, 30),
        unreadCount: 1,
        createdAt: ts(2026, 4, 1, 9),
      },
    });
  }
  const msgs: { id: string; dir: ZaloMessageDirection; src: ZaloMessageSource; text: string; tr: string | null; at: Date; status: ZaloMessageStatus }[] = [
    { id: "demo-msg-1", dir: ZaloMessageDirection.OUTBOUND, src: ZaloMessageSource.SYSTEM, text: "Đặt phòng mới: Pearl Villa P7, nhận phòng 14/06.", tr: null, at: ts(2026, 6, 9, 16), status: ZaloMessageStatus.SENT },
    { id: "demo-msg-2", dir: ZaloMessageDirection.INBOUND, src: ZaloMessageSource.USER, text: "Dạ em đã chuẩn bị villa xong rồi anh.", tr: "네, 빌라 준비 다 했습니다.", at: ts(2026, 6, 13, 18), status: ZaloMessageStatus.RECEIVED },
    { id: "demo-msg-3", dir: ZaloMessageDirection.OUTBOUND, src: ZaloMessageSource.CHAT, text: "Cảm ơn anh. Khách nhận phòng 2h chiều nay nhé.", tr: "감사합니다. 손님 오늘 오후 2시 체크인입니다.", at: ts(2026, 6, 13, 18, 30), status: ZaloMessageStatus.SENT },
    { id: "demo-msg-4", dir: ZaloMessageDirection.INBOUND, src: ZaloMessageSource.USER, text: "Anh ơi, villa Garden tuần sau có khách không ạ?", tr: "사장님, Garden 빌라 다음 주 손님 있나요?", at: ts(2026, 6, 16, 8, 30), status: ZaloMessageStatus.RECEIVED },
  ];
  if (demoOwnerAdmin) {
    for (const m of msgs) {
      await prisma.zaloMessage.upsert({
        where: { id: m.id },
        update: { text: m.text, translatedText: m.tr },
        create: { id: m.id, conversationId: "demo-conv-tuan", direction: m.dir, source: m.src, msgType: "text", text: m.text, translatedText: m.tr, status: m.status, sentBy: m.src === ZaloMessageSource.CHAT ? DEMO_ADMIN_TAG : null, createdAt: m.at },
      });
    }
  }

  // ---------- 10) 감사 로그 (대시보드 활동 피드) ----------
  const audits: { id: string; action: string; entity: string; entityId: string; at: Date }[] = [
    { id: "demo-audit-1", action: "UPDATE", entity: "Booking", entityId: "demo-bk-08", at: ts(2026, 6, 14, 14) },
    { id: "demo-audit-2", action: "CREATE", entity: "Booking", entityId: "demo-bk-11", at: ts(2026, 6, 15, 10) },
    { id: "demo-audit-3", action: "UPDATE", entity: "CleaningTask", entityId: "demo-clean-pending-1", at: ts(2026, 6, 15, 9, 30) },
    { id: "demo-audit-4", action: "CREATE", entity: "Proposal", entityId: "demo-prop-active", at: ts(2026, 6, 16, 9) },
    { id: "demo-audit-5", action: "UPDATE", entity: "Booking", entityId: "demo-bk-09", at: ts(2026, 6, 9, 16) },
  ];
  for (const au of audits) {
    await prisma.auditLog.upsert({
      where: { id: au.id },
      update: {},
      create: { id: au.id, userId: "demo-supplier-tuan", action: au.action, entity: au.entity, entityId: au.entityId, changes: {}, createdAt: au.at },
    });
  }

  // ---------- 집계 출력 ----------
  const counts = {
    villas: await prisma.villa.count({ where: { id: { startsWith: "demo-" } } }),
    bookings: await prisma.booking.count({ where: { id: { startsWith: "demo-" } } }),
    proposals: await prisma.proposal.count({ where: { id: { startsWith: "demo-" } } }),
    settlements: await prisma.settlement.count({ where: { id: { startsWith: "demo-" } } }),
    cleaning: await prisma.cleaningTask.count({ where: { id: { startsWith: "demo-" } } }),
    zaloMsgs: await prisma.zaloMessage.count({ where: { id: { startsWith: "demo-" } } }),
  };
  console.log("✅ 데모 시드 완료(멱등):", counts);
  console.log("   공급자 로그인: 0901234567 / demo1234  (vi 화면)");
  console.log("   청소자 로그인: 0907654321 / demo1234");
  console.log("   공개 제안(ACTIVE): /p/demo-token-active-abc");
  console.log("   정리: npx tsx prisma/demo-purge.ts");
}

// ===================== 헬퍼: 제안 / 정산 =====================

interface PropArg {
  id: string;
  token: string;
  clientName: string;
  channel: BookingChannel;
  cur: Cur;
  status: ProposalStatus;
  expiresAt: Date;
  createdAt: Date;
  items: { id: string; villaId: string; ci: [number, number, number]; co: [number, number, number]; bookingId?: string }[];
}
async function upsertProposal(p: PropArg) {
  await prisma.proposal.upsert({
    where: { id: p.id },
    update: { status: p.status, expiresAt: p.expiresAt },
    create: {
      id: p.id, token: p.token, clientName: p.clientName, channel: p.channel,
      saleCurrency: p.cur === "KRW" ? Currency.KRW : Currency.VND, fxVndPerKrw: FX,
      expiresAt: p.expiresAt, status: p.status, createdAt: p.createdAt,
    },
  });
  for (const it of p.items) {
    const v = villaById[it.villaId];
    const n = nights(it.ci, it.co);
    const nightly = v.rate[seasonOfMonth(it.ci[1])];
    const sv = saleVnd(nightly * BigInt(n));
    await prisma.proposalItem.upsert({
      where: { id: it.id },
      update: {},
      create: {
        id: it.id, proposalId: p.id, villaId: it.villaId, checkIn: d(...it.ci), checkOut: d(...it.co),
        priceKrwPerNight: p.cur === "KRW" ? saleKrw(saleVnd(nightly)) : null,
        totalKrw: p.cur === "KRW" ? saleKrw(sv) : null,
        priceVndPerNight: p.cur === "VND" ? saleVnd(nightly) : null,
        totalVnd: p.cur === "VND" ? sv : null,
        bookingId: it.bookingId ?? null,
      },
    });
  }
}

async function upsertSettlement(id: string, yearMonth: string, status: SettlementStatus, paidAt: Date | null, bookingIds: string[]) {
  let total = 0n;
  const items: { bookingId: string; amountVnd: bigint }[] = [];
  for (const bid of bookingIds) {
    const b = BOOKINGS.find((x) => x.id === bid)!;
    const cost = amountsFor(b).costVnd;
    total += cost;
    items.push({ bookingId: bid, amountVnd: cost });
  }
  await prisma.settlement.upsert({
    where: { id },
    update: { status, totalVnd: total, paidAt },
    create: { id, supplierId: "demo-supplier-tuan", yearMonth, totalVnd: total, status, paidAt, createdAt: ts(2026, Number(yearMonth.slice(5)) + 1, 3, 10) },
  });
  for (const it of items) {
    await prisma.settlementItem.upsert({
      where: { bookingId: it.bookingId },
      update: { amountVnd: it.amountVnd, settlementId: id },
      create: { id: `demo-si-${it.bookingId}`, settlementId: id, bookingId: it.bookingId, amountVnd: it.amountVnd },
    });
  }
}

main()
  .catch((e) => {
    console.error("❌ 데모 시드 실패:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
