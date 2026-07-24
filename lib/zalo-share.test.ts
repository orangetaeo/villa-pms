// T-zalo-notify-enrichment — 채팅 공유 본문 빌더 (기간 병기·제안 요약)
import { describe, expect, it } from "vitest";
import { Currency, SeasonType } from "@prisma/client";
import {
  buildVillaShareTextForSupplier,
  buildVillaShareTextForCustomer,
  buildVillaShareBriefWithBlog,
  buildProposalShareText,
  buildSettlementShareText,
  type VillaShareBase,
} from "./zalo-share";

const VILLA: VillaShareBase = {
  name: "Sunset Villa",
  nameVi: null,
  complex: "썬셋 단지",
  bedrooms: 3,
  bathrooms: 2,
  maxGuests: 6,
  hasPool: true,
  breakfastAvailable: true,
  amenityLabels: ["에어컨", "주방"],
};

// @db.Date — UTC 자정. endDate는 half-open(제외).
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("buildVillaShareTextForSupplier — 원가 + 기간 병기", () => {
  it("기본요금 먼저·특수 기간은 시작일 순, endDate는 -1일(포함일)로 표시", () => {
    const text = buildVillaShareTextForSupplier(VILLA, [
      {
        season: SeasonType.PEAK,
        isBase: false,
        startDate: d("2026-02-05"),
        endDate: d("2026-02-12"), // 마지막 적용일 = 2.11
        label: "2026 설",
        supplierCostVnd: 8_000_000n,
      },
      {
        season: SeasonType.LOW,
        isBase: true,
        startDate: null,
        endDate: null,
        supplierCostVnd: 5_000_000n,
      },
      {
        season: SeasonType.HIGH,
        isBase: false,
        startDate: d("2026-07-15"),
        endDate: d("2026-09-01"), // 마지막 적용일 = 8.31
        label: null,
        supplierCostVnd: 6_500_000n,
      },
    ]);
    const lines = text.split("\n");
    const rateLines = lines.filter((l) => l.startsWith("  "));
    expect(rateLines).toEqual([
      "  기본: 5,000,000₫",
      "  극성수기 · 2026 설 (2.5 ~ 2.11): 8,000,000₫",
      "  성수기 (7.15 ~ 8.31): 6,500,000₫",
    ]);
    expect(text).toContain("— 원가(1박)");
    // 누수 가드 — 판매가·KRW·마진 어휘 없음
    expect(text).not.toMatch(/판매가|KRW|₩|마진|margin/i);
  });
});

describe("buildVillaShareTextForCustomer — 판매가 + 기간 병기", () => {
  const rates = [
    {
      season: SeasonType.LOW,
      isBase: true,
      startDate: null,
      endDate: null,
      salePriceVnd: 9_800_000n,
      salePriceKrw: 550_000,
    },
    {
      season: SeasonType.HIGH,
      isBase: false,
      startDate: d("2026-07-15"),
      endDate: d("2026-09-01"),
      label: null,
      salePriceVnd: 12_500_000n,
      salePriceKrw: 700_000,
    },
  ];

  it("VND 채널(여행사) — 기본/기간 라벨과 VND만", () => {
    const text = buildVillaShareTextForCustomer(VILLA, rates, Currency.VND);
    expect(text).toContain("  기본: 9,800,000₫");
    expect(text).toContain("  성수기 (7.15 ~ 8.31): 12,500,000₫");
    expect(text).not.toMatch(/원가|₩/);
  });

  it("KRW 채널(직접 고객) — KRW만", () => {
    const text = buildVillaShareTextForCustomer(VILLA, rates, Currency.KRW);
    expect(text).toContain("₩550,000");
    expect(text).not.toContain("9,800,000₫");
  });
});

describe("buildProposalShareText — 빌라 요약·기간·금액·링크·유효기간", () => {
  const baseProposal = {
    token: "tok123",
    clientName: "하나투어 김대리",
    expiresAt: new Date("2026-07-12T11:00:00.000Z"), // VN(UTC+7) = 18:00
    saleCurrency: Currency.KRW,
    items: [
      {
        villaName: "Sunset Villa",
        villaNameVi: null,
        bedrooms: 3,
        hasPool: true,
        checkIn: d("2026-07-15"),
        checkOut: d("2026-07-18"),
        totalKrw: 1_450_000,
        totalVnd: null,
      },
      {
        villaName: "Ocean Villa",
        villaNameVi: null,
        bedrooms: 4,
        hasPool: false,
        checkIn: d("2026-07-15"),
        checkOut: d("2026-07-18"),
        totalKrw: 1_780_000,
        totalVnd: null,
      },
    ],
  };

  it("동일 일정 — 헤더에 기간·박수 요약 + 빌라별 침실·수영장·총액(KRW)", () => {
    const text = buildProposalShareText(baseProposal, "https://villa.example.com/");
    expect(text).toContain("📋 Villa Go 제안서 — 하나투어 김대리님");
    expect(text).toContain("빌라 2개 · 7.15 ~ 7.18 · 3박");
    expect(text).toContain("1. Sunset Villa");
    expect(text).toContain("침실 3 · 수영장 · 총 ₩1,450,000");
    expect(text).toContain("2. Ocean Villa");
    expect(text).toContain("침실 4 · 총 ₩1,780,000");
    expect(text).toContain("👉 사진·상세 보기: https://villa.example.com/p/tok123");
    expect(text).toContain("⏰ 유효기간: 2026.07.12 18:00까지 (이후 링크가 만료됩니다)");
  });

  it("빌라별 일정이 다르면 헤더 요약 대신 항목별 기간·박수", () => {
    const mixed = {
      ...baseProposal,
      items: [
        baseProposal.items[0],
        { ...baseProposal.items[1], checkIn: d("2026-07-20"), checkOut: d("2026-07-22") },
      ],
    };
    const text = buildProposalShareText(mixed, "https://villa.example.com");
    expect(text).toContain("빌라 2개");
    expect(text).not.toContain("빌라 2개 · 7.15");
    expect(text).toContain("7.15~7.18 · 3박");
    expect(text).toContain("7.20~7.22 · 2박");
  });

  it("VND 채널 — totalVnd로 표기, 누수 가드(원가·마진 어휘 없음)", () => {
    const vnd = {
      ...baseProposal,
      saleCurrency: Currency.VND,
      items: [
        {
          ...baseProposal.items[0],
          totalKrw: null,
          totalVnd: 29_400_000n,
        },
      ],
    };
    const text = buildProposalShareText(vnd, "https://villa.example.com");
    expect(text).toContain("총 29,400,000₫");
    expect(text).not.toMatch(/원가|마진|margin|supplierCost/i);
  });

  it("items 비어도(구 데이터) 링크·유효기간은 항상 포함", () => {
    const empty = { ...baseProposal, items: [] };
    const text = buildProposalShareText(empty, "https://villa.example.com");
    expect(text).toContain("/p/tok123");
    expect(text).toContain("유효기간");
    expect(text).not.toContain("빌라 0개");
  });
});

describe("가격 0 행 생략 (계약 C — base=0 오염 방지)", () => {
  it("고객 본문: salePrice 0 행은 빼고, 유효 행 없으면 '— 가격(1박)' 헤더도 없음", () => {
    // base=0(초기화) 1행만 → 가격 섹션 통째 생략
    const onlyZero = buildVillaShareTextForCustomer(
      VILLA,
      [{ season: SeasonType.LOW, isBase: true, startDate: null, endDate: null, salePriceKrw: 0, salePriceVnd: 0n }],
      Currency.KRW
    );
    expect(onlyZero).not.toContain("가격(1박)");
    expect(onlyZero).not.toContain("₩0");

    // base=0 + 시즌가 → 시즌가만 표시
    const mixed = buildVillaShareTextForCustomer(
      VILLA,
      [
        { season: SeasonType.LOW, isBase: true, startDate: null, endDate: null, salePriceKrw: 0, salePriceVnd: 0n },
        { season: SeasonType.HIGH, isBase: false, startDate: d("2026-07-15"), endDate: d("2026-09-01"), label: null, salePriceKrw: 120_000, salePriceVnd: 2_000_000n },
      ],
      Currency.KRW
    );
    expect(mixed).toContain("가격(1박)");
    expect(mixed).toContain("₩120,000");
    expect(mixed).not.toContain("기본: ₩0");
  });

  it("공급자 본문: supplierCost 0 행 생략", () => {
    const text = buildVillaShareTextForSupplier(VILLA, [
      { season: SeasonType.LOW, isBase: true, startDate: null, endDate: null, supplierCostVnd: 0n },
    ]);
    expect(text).not.toContain("원가(1박)");
  });
});

describe("buildVillaShareBriefWithBlog — 간단정보 + 대표가 + 블로그 링크 (계약 E)", () => {
  const blog = { url: "https://villa-go.net/blog/phu-quoc-villa", title: "푸꾸옥 오션뷰 빌라 소개" };

  it("KRW from 있으면 '…원 ~ / 박' + 블로그 링크", () => {
    const text = buildVillaShareBriefWithBlog(VILLA, { krw: 90_000, vnd: null }, Currency.KRW, blog);
    expect(text).toContain("🏠 Sunset Villa");
    expect(text).toContain("₩90,000 ~ / 박");
    expect(text).toContain("📖 상세 소개: 푸꾸옥 오션뷰 빌라 소개");
    expect(text).toContain("https://villa-go.net/blog/phu-quoc-villa");
  });

  it("VND from은 formatVnd로 표기", () => {
    const text = buildVillaShareBriefWithBlog(VILLA, { krw: null, vnd: 1_500_000n }, Currency.VND, blog);
    expect(text).toContain("1,500,000₫ ~ / 박");
  });

  it("from null이면 가격줄 생략, 링크는 유지", () => {
    const text = buildVillaShareBriefWithBlog(VILLA, null, Currency.KRW, blog);
    expect(text).not.toContain("/ 박");
    expect(text).toContain("📖 상세 소개");
    // 누수 가드 — 원가·마진 어휘 없음
    expect(text).not.toMatch(/원가|마진/);
  });
});

describe("buildSettlementShareText — 기존 형식 유지", () => {
  it("월·총지급액·건수·상태", () => {
    const text = buildSettlementShareText({
      yearMonth: "2026-06",
      totalVnd: 12_500_000n,
      itemCount: 4,
      status: "PAID",
    });
    expect(text).toContain("💰 정산 — 2026-06");
    expect(text).toContain("총 지급액: 12,500,000₫");
    expect(text).toContain("예약 4건 · 지급완료");
  });
});
