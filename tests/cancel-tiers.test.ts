import { describe, it, expect } from "vitest";
import {
  DEFAULT_CANCEL_TIERS,
  cancelTierPeriodLabel,
  formatCancelTiersTable,
  formatLegacyCancelTable,
  readCancelTiers,
  validateCancelTiers,
  type CancelTier,
} from "@/lib/cancel-tiers";
import { parseTerms, renderBusinessContract, type RenderContractData } from "@/lib/business-contract";

const tiers = (over: Partial<CancelTier>[] = []): CancelTier[] =>
  DEFAULT_CANCEL_TIERS.map((t, i) => ({ ...t, ...(over[i] ?? {}) }));

describe("validateCancelTiers", () => {
  it("테오 확정 프리셋은 유효", () => {
    expect(validateCancelTiers(DEFAULT_CANCEL_TIERS)).toEqual([]);
  });

  it("★ 공급자 지급률 > 고객 위약금률(100−환불률) → 회사 손실 차단", () => {
    // 8~13일 구간: 환불 80%(=위약금 20%)인데 지급 30% → 10%p 회사 손실
    const bad = tiers([{}, { supplierPayPct: 30 }]);
    expect(validateCancelTiers(bad)).toContainEqual({ index: 1, code: "TIER_PAY_EXCEEDS_PENALTY" });
  });

  it("마지막 행이 노쇼(-1)가 아니면 거부", () => {
    const bad = tiers().slice(0, 4); // 당일(0)에서 끝남
    expect(validateCancelTiers(bad)).toContainEqual({
      index: 3,
      code: "TIER_LAST_MUST_BE_NOSHOW",
    });
  });

  it("fromDays 내림차순 위반 거부", () => {
    const bad = tiers([{ fromDays: 5 }]); // 첫 행 5 < 둘째 행 8
    expect(validateCancelTiers(bad)).toContainEqual({ index: 1, code: "TIER_DAYS_NOT_DESCENDING" });
  });

  it("고객 환불률 증가·공급자 지급률 감소 거부", () => {
    const codes = validateCancelTiers(tiers([{ guestRefundPct: 50, supplierPayPct: 50 }])).map(
      (i) => i.code,
    );
    expect(codes).toContain("TIER_REFUND_NOT_DESCENDING"); // 100 → 80이어야 하는데 50 → 80
    expect(codes).toContain("TIER_PAY_NOT_ASCENDING"); // 50 → 20
  });

  it("행 수·값 범위 검증", () => {
    expect(validateCancelTiers([DEFAULT_CANCEL_TIERS[0]])).toEqual([{ index: -1, code: "TIER_COUNT" }]);
    const nan = tiers([{ guestRefundPct: Number.NaN }]);
    expect(validateCancelTiers(nan)).toContainEqual({ index: 0, code: "TIER_RANGE" });
  });

  it("첫 행은 체크인 1일 전 이상", () => {
    const bad: CancelTier[] = [
      { fromDays: 0, guestRefundPct: 20, supplierPayPct: 80 },
      { fromDays: -1, guestRefundPct: 0, supplierPayPct: 100 },
    ];
    expect(validateCancelTiers(bad)).toContainEqual({
      index: 0,
      code: "TIER_FIRST_MUST_BE_POSITIVE",
    });
  });
});

describe("cancelTierPeriodLabel", () => {
  it("ko — 첫 행/구간/당일/노쇼", () => {
    const t = DEFAULT_CANCEL_TIERS;
    expect(cancelTierPeriodLabel(t, 0, "ko")).toBe("체크인 14일 전까지");
    expect(cancelTierPeriodLabel(t, 1, "ko")).toBe("체크인 8~13일 전");
    expect(cancelTierPeriodLabel(t, 2, "ko")).toBe("체크인 1~7일 전");
    expect(cancelTierPeriodLabel(t, 3, "ko")).toBe("체크인 당일");
    expect(cancelTierPeriodLabel(t, 4, "ko")).toBe("노쇼 또는 체크인 후 취소");
  });

  it("구간 폭이 1일이면 단일 일자로 표기", () => {
    const t: CancelTier[] = [
      { fromDays: 3, guestRefundPct: 100, supplierPayPct: 0 },
      { fromDays: 2, guestRefundPct: 50, supplierPayPct: 50 },
      { fromDays: -1, guestRefundPct: 0, supplierPayPct: 100 },
    ];
    expect(cancelTierPeriodLabel(t, 1, "ko")).toBe("체크인 2일 전");
  });

  it("vi 라벨이 생성된다", () => {
    expect(cancelTierPeriodLabel(DEFAULT_CANCEL_TIERS, 1, "vi")).toBe("Trước 8~13 ngày");
  });
});

describe("formatCancelTiersTable", () => {
  it("ko — 3열 5행 + 주석 3줄", () => {
    const out = formatCancelTiersTable(DEFAULT_CANCEL_TIERS, "ko");
    expect(out).toContain("| 취소 접수 시점 (체크인 기준) | 고객 환불 | 공급자 지급 |");
    expect(out).toContain("| 체크인 14일 전까지 | 총 예약금액의 100% | 지급 없음 |");
    expect(out).toContain("| 체크인 8~13일 전 | 총 예약금액의 80% | 원가의 20% |");
    expect(out).toContain("| 노쇼 또는 체크인 후 취소 | 환불 없음 | 원가의 100% |");
    expect(out).toContain("총 예약금액"); // 기준 금액 주석
    expect(out).toContain("환율"); // 환율 부담 주석
    expect(out.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);
  });

  it("vi — 표·주석이 베트남어로 생성된다", () => {
    const out = formatCancelTiersTable(DEFAULT_CANCEL_TIERS, "vi");
    expect(out).toContain("Hoàn tiền cho khách");
    expect(out).toContain("Không hoàn tiền");
    expect(out).toContain("100% giá gốc");
    expect(out).not.toMatch(/[가-힣]/); // 한국어 잔존 금지
  });

  it("치환 토큰 주입 방지 — 표에 {{ 가 생기지 않는다", () => {
    expect(formatCancelTiersTable(DEFAULT_CANCEL_TIERS, "ko")).not.toContain("{{");
  });
});

describe("★ 레거시 폴백 (서명 완료 계약 렌더 보존)", () => {
  // 종전 정본 md(별표 2)에 하드코딩돼 있던 문자열 — 한 글자도 바뀌면 안 된다.
  it("ko 2열 3행이 종전과 동일", () => {
    expect(formatLegacyCancelTable("14", "50", "ko")).toBe(
      [
        "| 취소 시점 (체크인 기준) | 회사→공급자 지급 의무 / 환급률 |",
        "|---|---|",
        "| 14일 전까지 | 수수료 없음 (지급 전=무정산, 지급 후=100% 환급) |",
        "| 14일 이내 ~ 전일 | 원가의 50% |",
        "| 당일·노쇼 | 원가의 100% |",
      ].join("\n"),
    );
  });

  it("vi 2열 3행이 종전과 동일", () => {
    expect(formatLegacyCancelTable("14", "50", "vi")).toBe(
      [
        "| Thời điểm hủy (tính theo ngày nhận phòng) | Nghĩa vụ thanh toán của Công ty → Nhà cung cấp / Tỷ lệ hoàn |",
        "|---|---|",
        "| Trước 14 ngày | Không tính phí (trước khi thanh toán = không quyết toán, sau khi thanh toán = hoàn 100%) |",
        "| Trong vòng 14 ngày ~ ngày trước | 50% giá gốc |",
        "| Trong ngày · Không đến (no show) | 100% giá gốc |",
      ].join("\n"),
    );
  });
});

describe("readCancelTiers", () => {
  it("유효 배열만 통과, 그 외는 null(→ 레거시 폴백)", () => {
    expect(readCancelTiers(DEFAULT_CANCEL_TIERS)).toHaveLength(5);
    expect(readCancelTiers(undefined)).toBeNull();
    expect(readCancelTiers("14")).toBeNull();
    expect(readCancelTiers([{ fromDays: 1, guestRefundPct: 0, supplierPayPct: 100 }])).toBeNull(); // 행 부족
    expect(readCancelTiers(tiers([{}, { supplierPayPct: 30 }]))).toBeNull(); // 상한 위반
  });
});

describe("parseTerms — cancelTiers 통합", () => {
  const base = {
    companyName: "KIM HAKTAE",
    companyPassport: "M1",
    companyContactVn: "0799493138",
    payMethod: "CASH" as const,
  };

  it("유효 단계표 통과", () => {
    const r = parseTerms("VILLA_SUPPLY", { ...base, cancelTiers: DEFAULT_CANCEL_TIERS });
    expect(r.success).toBe(true);
  });

  it("★ 회사 손실 상한 위반은 서버가 거부", () => {
    const r = parseTerms("VILLA_SUPPLY", {
      ...base,
      cancelTiers: tiers([{}, { supplierPayPct: 30 }]),
    });
    expect(r.success).toBe(false);
  });

  it("단계표 행에 잉여 키(원가·마진 누수 시도) 거부", () => {
    const r = parseTerms("VILLA_SUPPLY", {
      ...base,
      cancelTiers: [
        { fromDays: 14, guestRefundPct: 100, supplierPayPct: 0, costVnd: 1000000 },
        { fromDays: -1, guestRefundPct: 0, supplierPayPct: 100 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("cancelTiers 미지정(레거시)도 통과 — 기존 계약 호환", () => {
    const r = parseTerms("VILLA_SUPPLY", base);
    expect(r.success).toBe(true);
  });
});

describe("renderBusinessContract — {{cancelTiersTable}}", () => {
  const FIXTURE = "## 별표 2\n{{cancelTiersTable}}\n";
  const data = (terms: Record<string, unknown>): RenderContractData => ({
    type: "VILLA_SUPPLY",
    locale: "ko",
    counterpartName: "Nguyen Van A",
    counterpartZalo: "0900000000",
    terms: {
      companyName: "KIM HAKTAE",
      companyPassport: "M1",
      companyContactVn: "0799493138",
      payMethod: "CASH",
      ...terms,
    },
  });

  it("단계표가 있으면 3열 표로 렌더", () => {
    const out = renderBusinessContract(FIXTURE, data({ cancelTiers: DEFAULT_CANCEL_TIERS }));
    expect(out).toContain("| 체크인 8~13일 전 | 총 예약금액의 80% | 원가의 20% |");
    expect(out).not.toContain("{{");
  });

  it("단계표가 없으면 레거시 2열 표로 렌더(기존 서명 계약 보존)", () => {
    const out = renderBusinessContract(
      FIXTURE,
      data({ cancelFreeDays: 14, cancelPartialPct: 50 }),
    );
    expect(out).toContain("| 14일 전까지 | 수수료 없음 (지급 전=무정산, 지급 후=100% 환급) |");
    expect(out).not.toContain("고객 환불");
  });

  it("단계표가 손상된 경우에도 레거시로 안전 폴백(렌더 실패 금지)", () => {
    const out = renderBusinessContract(
      FIXTURE,
      data({ cancelFreeDays: 14, cancelPartialPct: 50, cancelTiers: [{ fromDays: 1 }] }),
    );
    expect(out).toContain("| 당일·노쇼 | 원가의 100% |");
  });
});
