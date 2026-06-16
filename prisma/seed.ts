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
import { FX_VND_PER_KRW_KEY } from "../lib/pricing";
import {
  BANK_NAME_KEY,
  BANK_ACCOUNT_NUMBER_KEY,
  BANK_ACCOUNT_HOLDER_KEY,
  CONTACT_KAKAO_URL_KEY,
  CONTACT_PHONE_KEY,
  SETTING_KEYS,
} from "../app/api/settings/validators";

// ===================== 순수 데이터·계산 층 (단위 테스트 대상) =====================

/** 1 KRW = x VND. 파일럿 기준 환율 (ADMIN이 /settings에서 갱신). */
export const SEED_FX_VND_PER_KRW = 18.87;

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
    // ⚠️ placeholder — 테오 실제 입금 계좌로 교체
    { key: BANK_NAME_KEY, value: "국민은행" },
    { key: BANK_ACCOUNT_NUMBER_KEY, value: "123456-04-567890" },
    { key: BANK_ACCOUNT_HOLDER_KEY, value: "테오" },
    // ⚠️ placeholder — 테오 실제 문의 채널로 교체
    { key: CONTACT_KAKAO_URL_KEY, value: "https://open.kakao.com/o/example" },
    { key: CONTACT_PHONE_KEY, value: "+82-10-0000-0000" },
  ];
}

/** 빌라당 등록 필수 충족용 placeholder 사진(외관·거실·침실 각 1장). */
export function buildPhotos(villaId: string): {
  id: string;
  villaId: string;
  space: PhotoSpace;
  spaceLabel: string | null;
  url: string;
}[] {
  return [
    { id: `${villaId}-photo-exterior`, villaId, space: PhotoSpace.EXTERIOR, spaceLabel: null, url: `https://placehold.co/800x600?text=${villaId}-exterior` },
    { id: `${villaId}-photo-living`, villaId, space: PhotoSpace.LIVING, spaceLabel: null, url: `https://placehold.co/800x600?text=${villaId}-living` },
    { id: `${villaId}-photo-bedroom1`, villaId, space: PhotoSpace.BEDROOM, spaceLabel: "침실 1", url: `https://placehold.co/800x600?text=${villaId}-bedroom1` },
  ];
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

    await prisma.user.upsert({
      where: { id: SEED_ADMIN_ID },
      update: { role: Role.ADMIN, name: "테오", locale: "ko" },
      create: {
        id: SEED_ADMIN_ID,
        role: Role.ADMIN,
        name: "테오",
        email: "admin@villa-pms.local",
        passwordHash: adminHash,
        locale: "ko",
      },
    });

    await prisma.user.upsert({
      where: { id: SEED_SUPPLIER_ID },
      update: { role: Role.SUPPLIER, name: "파일럿 중계인", locale: "vi" },
      create: {
        id: SEED_SUPPLIER_ID,
        role: Role.SUPPLIER,
        name: "파일럿 중계인",
        phone: "+84-90-000-0000",
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

      for (const r of v.rates) {
        const salePriceVnd = applyMarginVnd(r.supplierCostVnd, SEED_MARGIN_PERCENT);
        const salePriceKrw = vndToKrwRounded(salePriceVnd, SEED_FX_VND_PER_KRW);
        await prisma.villaRate.upsert({
          where: { villaId_season: { villaId: v.id, season: r.season } },
          update: {
            supplierCostVnd: r.supplierCostVnd,
            marginType: MarginType.PERCENT,
            marginValue: SEED_MARGIN_PERCENT,
            salePriceVnd,
            salePriceKrw,
          },
          create: {
            villaId: v.id,
            season: r.season,
            supplierCostVnd: r.supplierCostVnd,
            marginType: MarginType.PERCENT,
            marginValue: SEED_MARGIN_PERCENT,
            salePriceVnd,
            salePriceKrw,
          },
        });
      }

      for (const p of buildPhotos(v.id)) {
        await prisma.villaPhoto.upsert({
          where: { id: p.id },
          update: { space: p.space, spaceLabel: p.spaceLabel, url: p.url },
          create: { ...p, isBaseline: true, uploadedBy: SEED_ADMIN_ID },
        });
      }
    }

    const counts = {
      users: await prisma.user.count(),
      villas: await prisma.villa.count(),
      rates: await prisma.villaRate.count(),
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
