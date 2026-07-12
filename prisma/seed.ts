/**
 * T4.2 — 파일럿 시드 스크립트 (멱등)
 *
 * P0 파일럿 실데이터: 쏘나씨 V11/V12/V25 + 썬셋 사나토 A3 (파일럿 공급자 소유).
 * "배포 후 실측"을 풀어줄 최소 데이터셋 — LAUNCH.md 오픈 기준 충족.
 *
 * 실행:   npx tsx prisma/seed.ts
 * 멱등성: 모든 행을 고정 id / unique 키로 upsert → 두 번 실행해도 행 수 불변.
 * 적재:   프로덕션 DB 적재는 DATABASE_URL 확인 후 수동 실행 (재실행 안전).
 *
 * 주의(사업 원칙 2 — 마진 비공개): 이 데이터의 salePrice*는 ADMIN 전용. 공급자 화면엔
 * supplierCostVnd만 노출된다(빌라 요율 select 스코프로 차단됨, T1.10/T4.1 검증).
 *
 * ⚠️ placeholder: 사진 URL·계좌·연락처는 테오가 실제 값으로 교체 예정.
 */
import {
  PrismaClient,
  Role,
  VillaStatus,
  PhotoSpace,
  SeasonType,
  MarginType,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { HOLD_HOURS_DEFAULT_KEY } from "../lib/hold";
import {
  FX_VND_PER_KRW_KEY,
  FX_VND_PER_USD_KEY,
  buildRatePeriodRowsFromSeasonCosts,
} from "../lib/pricing";
import { FX_AUTO_UPDATE_KEY } from "../lib/fx-auto-update";
import { FX_MODE_KEY } from "../lib/fx-effective";
import {
  CANCELLATION_POLICY_KEY,
  DEFAULT_CANCELLATION_POLICY,
} from "../lib/cancellation-policy";
import {
  BANK_NAME_KEY,
  BANK_ACCOUNT_NUMBER_KEY,
  BANK_ACCOUNT_HOLDER_KEY,
  BANK_VN_NAME_KEY,
  BANK_VN_ACCOUNT_NUMBER_KEY,
  BANK_VN_ACCOUNT_HOLDER_KEY,
  CONTACT_KAKAO_URL_KEY,
  CONTACT_PHONE_KEY,
  ZALO_CONNECT_QR_URL_KEY,
  ZALO_CONNECT_OA_URL_KEY,
  SETTING_KEYS,
} from "../app/api/settings/validators";

// ===================== 순수 데이터·계산 층 (단위 테스트 대상) =====================

/** 1 KRW = x VND. 파일럿 기준 환율 (ADMIN이 /settings에서 갱신). */
export const SEED_FX_VND_PER_KRW = 18.87;

/** 1 USD = x VND. 파일럿 기준 환율 (ADMIN이 /settings에서 갱신, 후속확장 3). */
export const SEED_FX_VND_PER_USD = 26000;

/** 마진율(%) — 파일럿 기본. salePriceVnd = 원가 × (100+마진)/100. */
export const SEED_MARGIN_PERCENT = 20n;

/**
 * VND 판매가 → KRW 판매가 환산 후 천원 단위 라운딩.
 * salePriceKrw = round( salePriceVnd / FX / 1000 ) × 1000.
 * float 연산은 환산 제안값 계산에만 사용 — 저장은 정수(KRW=number).
 */
export function vndToKrwRounded(salePriceVnd: bigint, fxVndPerKrw: number): number {
  const krw = Number(salePriceVnd) / fxVndPerKrw;
  return Math.round(krw / 1000) * 1000;
}

/** 원가 → 판매가(VND): 원가 × (100 + 마진%)/100. BigInt 정수 연산. */
export function applyMarginVnd(supplierCostVnd: bigint, marginPercent: bigint): bigint {
  return (supplierCostVnd * (100n + marginPercent)) / 100n;
}

interface SeedRate {
  season: SeasonType;
  supplierCostVnd: bigint;
}

interface SeedVilla {
  id: string;
  name: string;
  complex: string;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  hasPool: boolean;
  breakfastAvailable: boolean;
  rates: SeedRate[];
}

/** @db.Date 용 UTC 자정 Date 생성 (시간대 흔들림 방지). */
export function utcDate(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/** 2026 연간 시즌 달력 — LOW 기본, HIGH 여름 성수기, PEAK 연말·설(SPEC F3). */
export const SEED_SEASONS: {
  id: string;
  season: SeasonType;
  startDate: Date;
  endDate: Date;
  label: string;
}[] = [
  // PEAK: 2026 설 연휴 (음력 설 전후)
  { id: "seed-season-2026-tet", season: SeasonType.PEAK, startDate: utcDate(2026, 2, 14), endDate: utcDate(2026, 2, 22), label: "2026 설 연휴" },
  // HIGH: 여름 성수기 (베트남 국내 + 한국 여름 휴가)
  { id: "seed-season-2026-summer", season: SeasonType.HIGH, startDate: utcDate(2026, 6, 1), endDate: utcDate(2026, 9, 1), label: "2026 여름 성수기" },
  // PEAK: 연말 (크리스마스~신정)
  { id: "seed-season-2026-yearend", season: SeasonType.PEAK, startDate: utcDate(2026, 12, 24), endDate: utcDate(2027, 1, 3), label: "2026 연말·신정" },
  // 그 외 기간은 SeasonPeriod 미등록 → LOW(비수기) 자동 적용 (pricing.ts 규약)
];

/** 파일럿 빌라 4채 — 원가는 파일럿 placeholder(테오 실값 교체 예정). */
export const SEED_VILLAS: SeedVilla[] = [
  {
    id: "seed-villa-sonasea-v11",
    name: "쏘나씨 V11",
    complex: "쏘나씨",
    bedrooms: 3,
    bathrooms: 3,
    maxGuests: 8,
    hasPool: true,
    breakfastAvailable: true,
    rates: [
      { season: SeasonType.LOW, supplierCostVnd: 3_000_000n },
      { season: SeasonType.HIGH, supplierCostVnd: 4_500_000n },
      { season: SeasonType.PEAK, supplierCostVnd: 6_000_000n },
    ],
  },
  {
    id: "seed-villa-sonasea-v12",
    name: "쏘나씨 V12",
    complex: "쏘나씨",
    bedrooms: 4,
    bathrooms: 4,
    maxGuests: 10,
    hasPool: true,
    breakfastAvailable: true,
    rates: [
      { season: SeasonType.LOW, supplierCostVnd: 3_800_000n },
      { season: SeasonType.HIGH, supplierCostVnd: 5_500_000n },
      { season: SeasonType.PEAK, supplierCostVnd: 7_500_000n },
    ],
  },
  {
    id: "seed-villa-sonasea-v25",
    name: "쏘나씨 V25",
    complex: "쏘나씨",
    bedrooms: 5,
    bathrooms: 5,
    maxGuests: 12,
    hasPool: true,
    breakfastAvailable: true,
    rates: [
      { season: SeasonType.LOW, supplierCostVnd: 5_000_000n },
      { season: SeasonType.HIGH, supplierCostVnd: 7_000_000n },
      { season: SeasonType.PEAK, supplierCostVnd: 9_500_000n },
    ],
  },
  {
    id: "seed-villa-sunset-sanato-a3",
    name: "썬셋 사나토 A3",
    complex: "썬셋 사나토",
    bedrooms: 2,
    bathrooms: 2,
    maxGuests: 6,
    hasPool: false,
    breakfastAvailable: false,
    rates: [
      { season: SeasonType.LOW, supplierCostVnd: 2_500_000n },
      { season: SeasonType.HIGH, supplierCostVnd: 3_800_000n },
      { season: SeasonType.PEAK, supplierCostVnd: 5_000_000n },
    ],
  },
];

/** 고정 사용자 id (멱등 upsert 키). */
export const SEED_ADMIN_ID = "seed-admin-theo";
export const SEED_SUPPLIER_ID = "seed-supplier-pilot";

/** 앱이 기대하는 AppSetting 전체 — SETTING_KEYS 화이트리스트 기준. */
export function buildAppSettings(): { key: string; value: string }[] {
  return [
    { key: HOLD_HOURS_DEFAULT_KEY, value: "48" },
    { key: FX_VND_PER_KRW_KEY, value: String(SEED_FX_VND_PER_KRW) },
    { key: FX_VND_PER_USD_KEY, value: String(SEED_FX_VND_PER_USD) },
    // 유효 환율 모드 — 기본 MANUAL(수동 입력값 사용, AUTO는 운영자가 명시적으로 켜야 시세 반영)
    { key: FX_MODE_KEY, value: "MANUAL" },
    // 판매가 환율 자동 갱신 — 기본 OFF(운영자가 /settings에서 명시적으로 켜야 동작)
    { key: FX_AUTO_UPDATE_KEY, value: "off" },
    // 취소·환불 정책 기본값 (#6b) — 30일 100% / 14일 50% / 이후 불가
    { key: CANCELLATION_POLICY_KEY, value: JSON.stringify(DEFAULT_CANCELLATION_POLICY) },
    // ⚠️ placeholder — 테오 실제 입금 계좌로 교체 (한국 KRW 계좌)
    { key: BANK_NAME_KEY, value: "국민은행" },
    { key: BANK_ACCOUNT_NUMBER_KEY, value: "123456-04-567890" },
    { key: BANK_ACCOUNT_HOLDER_KEY, value: "테오" },
    // ⚠️ placeholder — 베트남 VND 계좌 (VND 예약 입금처, 통화로 자동 분기)
    { key: BANK_VN_NAME_KEY, value: "Vietcombank" },
    { key: BANK_VN_ACCOUNT_NUMBER_KEY, value: "0123456789" },
    { key: BANK_VN_ACCOUNT_HOLDER_KEY, value: "THEO" },
    // ⚠️ placeholder — 테오 실제 문의 채널로 교체
    { key: CONTACT_KAKAO_URL_KEY, value: "https://open.kakao.com/o/example" },
    { key: CONTACT_PHONE_KEY, value: "+82-10-0000-0000" },
    // Zalo 연결 온보딩 QR·친구추가 링크 — env 폴백(NEXT_PUBLIC_ZALO_QR_URL/OA_URL)과 동일 기본값
    { key: ZALO_CONNECT_QR_URL_KEY, value: "/zalo-qr.png" },
    { key: ZALO_CONNECT_OA_URL_KEY, value: "https://zalo.me/0799493138" },
  ];
}

/**
 * 빌라별 실사진 — 테오가 구글 드라이브에 올린 원본을 공개 CDN(lh3.googleusercontent.com)으로 참조.
 * next.config.ts images.remotePatterns에 lh3.googleusercontent.com 허용됨 (데모 빌라용).
 * placehold.co는 화이트리스트에 없어 next/image 렌더 실패 → 실사진/picsum으로 교체 (버그 수정).
 * V11·V25는 공간별 폴더가 정리돼 있어 정확히 매핑, V12(블루)·A3(선셋타운)는 평면 폴더라 공간 휴리스틱 배정.
 */
const drive = (id: string) => `https://lh3.googleusercontent.com/d/${id}`;

interface SeedPhoto {
  space: PhotoSpace;
  spaceLabel: string | null;
  url: string;
}

export const VILLA_PHOTO_SETS: Record<string, SeedPhoto[]> = {
  // 쏘나씨 V11 — 공간별 폴더 (외관/거실/주방/침실3/화장실/베란다)
  "seed-villa-sonasea-v11": [
    { space: PhotoSpace.EXTERIOR, spaceLabel: null, url: drive("1eGxWKKM0tsW4SHvBVCgaVKPsUQsf57Fy") },
    { space: PhotoSpace.EXTERIOR, spaceLabel: "마당", url: drive("1Z_hbU7XrVyput17-J4eTn5MeqQSJBwfM") },
    { space: PhotoSpace.LIVING, spaceLabel: null, url: drive("1UWa-1BoCQfqUCbAR9KNuvafoFElnxLJT") },
    { space: PhotoSpace.LIVING, spaceLabel: "식탁", url: drive("1zq9hGfEx5cVBDNs3N3BUdKpsJ9acP91y") },
    { space: PhotoSpace.KITCHEN, spaceLabel: null, url: drive("1ybV52F2ofjtFIl0asBREP1bpRYETMg_-") },
    { space: PhotoSpace.BEDROOM, spaceLabel: "1층 침실", url: drive("1x2Lp0Rx3xLzlUhZpUw51Ml_pqW2ivM5M") },
    { space: PhotoSpace.BEDROOM, spaceLabel: "2층 왼쪽 침실", url: drive("1DRn-BaGxdchiQRQ3HsGE5n_zL8mJEgtN") },
    { space: PhotoSpace.BEDROOM, spaceLabel: "2층 오른쪽 침실", url: drive("1dh7V3OHGu4WzreP-xZ-NNzWo2irvRo20") },
    { space: PhotoSpace.BATHROOM, spaceLabel: "1층 화장실", url: drive("1vcnY5QIK90_JrKBiNcSMrOZsYzfdIdT4") },
    { space: PhotoSpace.BATHROOM, spaceLabel: "2층 화장실", url: drive("1Y4sXIEcPkXqxutyhG4VCO0L1MxJldhuw") },
    { space: PhotoSpace.BALCONY, spaceLabel: null, url: drive("1VfZScAim-g2DaBU1HJs4QSLwvy1NDV1w") },
  ],
  // 쏘나씨 V12 — 블루동 평면 폴더 (공간 휴리스틱 배정)
  "seed-villa-sonasea-v12": [
    { space: PhotoSpace.EXTERIOR, spaceLabel: null, url: drive("1dLJrk3Uzhj2JcuDnDN62UJ7CKeE2urH_") },
    { space: PhotoSpace.LIVING, spaceLabel: null, url: drive("1IAtDHyWq_EQZP1CUPXLyDOawGjoe3ten") },
    { space: PhotoSpace.KITCHEN, spaceLabel: null, url: drive("1Uz3PKuTxxVpWq5eWws-pxbF6BMkyazEX") },
    { space: PhotoSpace.BEDROOM, spaceLabel: "침실 1", url: drive("176WpU_onI44ljdMKhTBIo8f3k8hS2SCX") },
    { space: PhotoSpace.BATHROOM, spaceLabel: null, url: drive("1FRRkZQn6HGMH_4JrrUDjw4jdTs_qGqPU") },
  ],
  // 쏘나씨 V25 — 공간별 폴더 (외관/거실/주방/침실3/화장실/베란다)
  "seed-villa-sonasea-v25": [
    { space: PhotoSpace.EXTERIOR, spaceLabel: null, url: drive("1NtY5vFfwtAgroIv_-_2MJAIWjgfZVDfo") },
    { space: PhotoSpace.EXTERIOR, spaceLabel: "마당", url: drive("1ausldJ-VSYQiMO6dWmVidrdcPEA-FaGb") },
    { space: PhotoSpace.LIVING, spaceLabel: null, url: drive("1bVK3x26109_b96aElCmOGFRP7pc32e0E") },
    { space: PhotoSpace.KITCHEN, spaceLabel: null, url: drive("1Kgvjq-4tRZmGlbAzCupArdlE9RhW-Vw9") },
    { space: PhotoSpace.KITCHEN, spaceLabel: "식탁", url: drive("1-Sy9Csg0GIxBUAEDv_eqypn-8slPi-m8") },
    { space: PhotoSpace.BEDROOM, spaceLabel: "1층 침실", url: drive("1akaKGOBbCJHDfZbsQrR82qT4tf-sLoZJ") },
    { space: PhotoSpace.BEDROOM, spaceLabel: "2층 왼쪽 침실", url: drive("1fY6c4cnm-uyIN6z_5VL_3DLdr4_3f7Ko") },
    { space: PhotoSpace.BEDROOM, spaceLabel: "2층 오른쪽 침실", url: drive("1ppuzadeqPoYnbdVkcbvswHokGYPx8JhX") },
    { space: PhotoSpace.BATHROOM, spaceLabel: "1층 화장실", url: drive("1natu_TJmsAqyqxluYKrNnRUa29mBTHn8") },
    { space: PhotoSpace.BATHROOM, spaceLabel: "2층 화장실", url: drive("16Onhtm8uhENUqp_hdkbBC9RBCpwzcmud") },
    { space: PhotoSpace.BALCONY, spaceLabel: null, url: drive("1d5sQ7JSqjkGRF_pm9zFbUoklpJ7YUEAz") },
  ],
  // 썬셋 사나토 A3 — 선셋타운_SKY 평면 폴더 12장 (공간 휴리스틱 배정)
  "seed-villa-sunset-sanato-a3": [
    { space: PhotoSpace.EXTERIOR, spaceLabel: null, url: drive("1eadJae7SzsZtdCk4abmepd-rGMEf-xyG") },
    { space: PhotoSpace.EXTERIOR, spaceLabel: "전경", url: drive("11xtnlQZj6tjrQ4s76pRHU-biRPLSG9Xu") },
    { space: PhotoSpace.LIVING, spaceLabel: null, url: drive("14-u66lzsLKJv6SB_QLlca6n_pD4Erf_X") },
    { space: PhotoSpace.LIVING, spaceLabel: "2", url: drive("1PNjskOh78bcBOkchV4w77rUwnKpFxoTk") },
    { space: PhotoSpace.KITCHEN, spaceLabel: null, url: drive("1x6X3oHBLxVLgd28lhDMEh4Ca2F4_4k5_") },
    { space: PhotoSpace.KITCHEN, spaceLabel: "2", url: drive("1OcxvbfiqqIl3xo8xrNp7AgdsiZUDZjOe") },
    { space: PhotoSpace.BEDROOM, spaceLabel: "침실 1", url: drive("1pKyC6EsHRCDw8t7XdcgkIar7XfVf8N6G") },
    { space: PhotoSpace.BEDROOM, spaceLabel: "침실 1-2", url: drive("1gYG35MhuMAVtu1iQfHmPZDK3L_rtTOwa") },
    { space: PhotoSpace.BEDROOM, spaceLabel: "침실 2", url: drive("1hfmxoEAen1iUWvcKp5sUP0rQ9S6Rxjd5") },
    { space: PhotoSpace.BATHROOM, spaceLabel: null, url: drive("1Wb53FGaciSpq67WOL4AwAK3RipqeTJxg") },
    { space: PhotoSpace.BATHROOM, spaceLabel: "2", url: drive("1FWqxEygNm3k7I5nYoxWErIJeybZcX7Hp") },
    { space: PhotoSpace.BALCONY, spaceLabel: null, url: drive("1yEgd2kH0C6cYmhnj7VumajTPT2IVc41V") },
  ],
};

/** 빌라당 등록 필수 충족용 사진 — VILLA_PHOTO_SETS의 실사진(외관·거실·침실 포함). */
export function buildPhotos(villaId: string): {
  id: string;
  villaId: string;
  space: PhotoSpace;
  spaceLabel: string | null;
  url: string;
  sortOrder: number;
}[] {
  const set = VILLA_PHOTO_SETS[villaId] ?? [];
  return set.map((p, i) => ({
    id: `${villaId}-photo-${String(i + 1).padStart(2, "0")}`,
    villaId,
    space: p.space,
    spaceLabel: p.spaceLabel,
    url: p.url,
    sortOrder: i,
  }));
}

// ===================== I/O 층 (DB 적재) =====================

async function main() {
  const prisma = new PrismaClient();
  try {
    // 1) 사용자 (ADMIN·SUPPLIER)
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "villa-pms-admin-dev";
    const supplierPassword = process.env.SEED_SUPPLIER_PASSWORD ?? "villa-pms-supplier-dev";
    const adminHash = await hash(adminPassword, 10);
    const supplierHash = await hash(supplierPassword, 10);

    // 전화번호는 로그인 폼이 숫자만 남기므로(예: "+84-90-..."→"84900000000") 숫자 형식으로 저장해야 로그인 가능 (T4.2b)
    await prisma.user.upsert({
      where: { id: SEED_ADMIN_ID },
      update: { role: Role.OWNER, name: "테오", locale: "ko", phone: "0900000010" },
      create: {
        id: SEED_ADMIN_ID,
        role: Role.OWNER, // S-RBAC-final: 테오 = OWNER (구 ADMIN)
        name: "테오",
        phone: "0900000010",
        email: "admin@villa-pms.local",
        passwordHash: adminHash,
        locale: "ko",
      },
    });

    await prisma.user.upsert({
      where: { id: SEED_SUPPLIER_ID },
      update: { role: Role.SUPPLIER, name: "파일럿 중계인", locale: "vi", phone: "0900000000" },
      create: {
        id: SEED_SUPPLIER_ID,
        role: Role.SUPPLIER,
        name: "파일럿 중계인",
        phone: "0900000000",
        passwordHash: supplierHash,
        locale: "vi",
      },
    });

    // 2) AppSetting
    for (const s of buildAppSettings()) {
      await prisma.appSetting.upsert({
        where: { key: s.key },
        update: { value: s.value },
        create: { key: s.key, value: s.value },
      });
    }

    // 3) 시즌 달력
    for (const sp of SEED_SEASONS) {
      await prisma.seasonPeriod.upsert({
        where: { id: sp.id },
        update: { season: sp.season, startDate: sp.startDate, endDate: sp.endDate, label: sp.label },
        create: sp,
      });
    }

    // 4) 빌라 + 요율 + 사진
    for (const v of SEED_VILLAS) {
      await prisma.villa.upsert({
        where: { id: v.id },
        update: {
          name: v.name,
          complex: v.complex,
          bedrooms: v.bedrooms,
          bathrooms: v.bathrooms,
          maxGuests: v.maxGuests,
          hasPool: v.hasPool,
          breakfastAvailable: v.breakfastAvailable,
          status: VillaStatus.ACTIVE,
          isSellable: true,
        },
        create: {
          id: v.id,
          supplierId: SEED_SUPPLIER_ID,
          name: v.name,
          complex: v.complex,
          bedrooms: v.bedrooms,
          bathrooms: v.bathrooms,
          maxGuests: v.maxGuests,
          hasPool: v.hasPool,
          breakfastAvailable: v.breakfastAvailable,
          status: VillaStatus.ACTIVE,
          isSellable: true,
          icalImportUrls: [],
        },
      });

      // 요율(ADR-0014 VillaRatePeriod) — 기본요금(LOW 배경) + 전역 비-LOW 시즌 스냅샷.
      //   buildRatePeriodRowsFromSeasonCosts로 base/periods 구조(날짜·시즌)를 만들고,
      //   파일럿 시드는 실마진(SEED_MARGIN_PERCENT)을 적용한 sale 값으로 덮어쓴다.
      //   멱등성: 빌라별 deleteMany → create + createMany (upsert 대신 전량 재생성).
      const costsBySeason: Record<SeasonType, bigint> = {
        [SeasonType.LOW]: 0n,
        [SeasonType.HIGH]: 0n,
        [SeasonType.PEAK]: 0n,
      };
      for (const r of v.rates) costsBySeason[r.season] = r.supplierCostVnd;
      const withMargin = (cost: bigint) => {
        const salePriceVnd = applyMarginVnd(cost, SEED_MARGIN_PERCENT);
        return {
          marginType: MarginType.PERCENT,
          marginValue: SEED_MARGIN_PERCENT,
          salePriceVnd,
          salePriceKrw: vndToKrwRounded(salePriceVnd, SEED_FX_VND_PER_KRW),
        };
      };
      const { base, periods } = buildRatePeriodRowsFromSeasonCosts(
        {
          LOW: costsBySeason[SeasonType.LOW],
          HIGH: costsBySeason[SeasonType.HIGH],
          PEAK: costsBySeason[SeasonType.PEAK],
        },
        SEED_SEASONS.map((s) => ({ season: s.season, startDate: s.startDate, endDate: s.endDate, label: s.label }))
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

      // 사진 세트 교체(멱등): 기존 행 제거 후 실사진 재삽입 — 옛 placehold.co 행/잔여 id 정리
      await prisma.villaPhoto.deleteMany({ where: { villaId: v.id } });
      const photos = buildPhotos(v.id);
      if (photos.length > 0) {
        await prisma.villaPhoto.createMany({
          data: photos.map((p) => ({ ...p, isBaseline: true, uploadedBy: SEED_ADMIN_ID })),
        });
      }
    }

    const counts = {
      users: await prisma.user.count(),
      villas: await prisma.villa.count(),
      ratePeriods: await prisma.villaRatePeriod.count(),
      photos: await prisma.villaPhoto.count(),
      seasons: await prisma.seasonPeriod.count(),
      settings: await prisma.appSetting.count(),
    };
    console.log("✅ 시드 완료(멱등):", counts);
    console.log(`   AppSetting 키 ${SETTING_KEYS.length}종 / 빌라 ${SEED_VILLAS.length}채 × 시즌 3 요율`);
  } finally {
    await prisma.$disconnect();
  }
}

// tsx 직접 실행 시에만 main() — 테스트 import 시 부작용 없음
const isDirectRun = process.argv[1] && /seed\.ts$/.test(process.argv[1]);
if (isDirectRun) {
  main().catch((e) => {
    console.error("❌ 시드 실패:", e);
    process.exit(1);
  });
}
