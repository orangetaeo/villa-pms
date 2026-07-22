import { describe, it, expect } from "vitest";
import { NotificationType } from "@prisma/client";
import {
  NEGOTIABLE_CLAUSES,
  REASON_PRESETS,
  hasOpenNegotiation,
  isNegotiableClause,
  isReasonAllowed,
  negotiationRequestSchema,
  negotiationResolveSchema,
} from "@/lib/contract-negotiation";
import { DEFAULT_CANCEL_TIERS } from "@/lib/cancel-tiers";
import { buildNotificationText } from "@/lib/zalo";

describe("협의 가능 조항·사유 화이트리스트", () => {
  it("계약 타입별 조항만 허용", () => {
    expect(isNegotiableClause("VILLA_SUPPLY", "cancelTiers")).toBe(true);
    // 취소 단계표는 빌라 공급 계약에만 존재 — 벤더·파트너 계약에서는 협의 대상이 아니다
    expect(isNegotiableClause("SERVICE_VENDOR", "cancelTiers")).toBe(false);
    expect(isNegotiableClause("PARTNER_AGENCY", "settleCycle")).toBe(false);
    expect(isNegotiableClause("VILLA_SUPPLY", "salePriceKrw")).toBe(false); // 존재하지 않는 조항
  });

  it("조항별 사유 프리셋만 허용", () => {
    expect(isReasonAllowed("cancelTiers", "CANCEL_PAY_RATE")).toBe(true);
    expect(isReasonAllowed("cancelTiers", "SETTLE_CYCLE_CHANGE")).toBe(false); // 다른 조항의 사유
    expect(isReasonAllowed("unknownClause", "OTHER")).toBe(false);
  });

  it("모든 조항에 OTHER 탈출구가 있다 (상한 위반 요구는 메모로)", () => {
    for (const clauses of Object.values(NEGOTIABLE_CLAUSES)) {
      for (const c of clauses) {
        expect(REASON_PRESETS[c]).toContain("OTHER");
      }
    }
  });
});

describe("협의 요청 body", () => {
  const base = { clauseKey: "cancelTiers", reason: "CANCEL_PAY_RATE" as const };

  it("역제안 없는 단순 요청 통과", () => {
    expect(negotiationRequestSchema.safeParse(base).success).toBe(true);
  });

  it("★ 역제안도 S1과 같은 규칙으로 검증 — 회사 손실 상한 위반은 거부", () => {
    const bad = DEFAULT_CANCEL_TIERS.map((t, i) => (i === 1 ? { ...t, supplierPayPct: 30 } : t));
    expect(negotiationRequestSchema.safeParse({ ...base, proposedTiers: bad }).success).toBe(false);
  });

  it("유효한 역제안(지급률 인상 + 환불률 동반 인하)은 통과", () => {
    // 8~13일 구간을 20%→30%로 올리려면 고객 환불률을 80%→70%로 낮춰야 한다(=우리 위약금 수취 증가)
    const ok = DEFAULT_CANCEL_TIERS.map((t, i) =>
      i === 1 ? { ...t, supplierPayPct: 30, guestRefundPct: 70 } : t,
    );
    expect(negotiationRequestSchema.safeParse({ ...base, proposedTiers: ok }).success).toBe(true);
  });

  it("취소표가 아닌 조항에 숫자 역제안을 붙이면 거부", () => {
    const r = negotiationRequestSchema.safeParse({
      clauseKey: "payMethod",
      reason: "PAY_METHOD_CHANGE",
      proposedTiers: DEFAULT_CANCEL_TIERS,
    });
    expect(r.success).toBe(false);
  });

  it("OTHER 사유는 메모 필수(빈 요청 방지)", () => {
    expect(negotiationRequestSchema.safeParse({ clauseKey: "other", reason: "OTHER" }).success).toBe(false);
    expect(
      negotiationRequestSchema.safeParse({ clauseKey: "other", reason: "OTHER", note: "다른 조건 원함" })
        .success,
    ).toBe(true);
  });

  it("메모 치환 주입(\"{{\") 차단", () => {
    const r = negotiationRequestSchema.safeParse({
      clauseKey: "other",
      reason: "OTHER",
      note: "{{companyName}} 조작 시도",
    });
    expect(r.success).toBe(false);
  });

  it("미지정 키 거부(.strict)", () => {
    const r = negotiationRequestSchema.safeParse({ ...base, supplierCostVnd: 1000000 });
    expect(r.success).toBe(false);
  });
});

describe("협의 해소 body", () => {
  it("거절은 사유 필수 — 상대방에게 그대로 노출되므로", () => {
    expect(negotiationResolveSchema.safeParse({ action: "REJECT" }).success).toBe(false);
    expect(
      negotiationResolveSchema.safeParse({ action: "REJECT", resolvedNote: "성수기 조건은 유지" }).success,
    ).toBe(true);
  });

  it("거절에 terms를 함께 보내면 거부(조건 변경은 수용 경로만)", () => {
    const r = negotiationResolveSchema.safeParse({
      action: "REJECT",
      resolvedNote: "불가",
      terms: { payMethod: "CASH" },
    });
    expect(r.success).toBe(false);
  });

  it("수용은 사유 없이도 가능(조건 변경 동반 여부 무관)", () => {
    expect(negotiationResolveSchema.safeParse({ action: "ACCEPT" }).success).toBe(true);
  });
});

describe("서명 게이트 파생 판정", () => {
  it("OPEN이 하나라도 있으면 차단, 전부 해소되면 해제", () => {
    expect(hasOpenNegotiation([{ status: "ACCEPTED" }, { status: "OPEN" }])).toBe(true);
    expect(hasOpenNegotiation([{ status: "ACCEPTED" }, { status: "REJECTED" }])).toBe(false);
    expect(hasOpenNegotiation([])).toBe(false);
  });
});

describe("Zalo 알림 문구 — CONTRACT_NEGOTIATION (kind 분기)", () => {
  it("REQUEST → 운영자 ko, 조항·사유가 코드가 아닌 라벨로 나온다", () => {
    const text = buildNotificationText(NotificationType.CONTRACT_NEGOTIATION, {
      kind: "REQUEST",
      counterpartName: "Nguyen Van A",
      clauseKey: "cancelTiers",
      reason: "CANCEL_PAY_RATE",
      hasProposal: true,
      note: "성수기는 더 받고 싶습니다",
    });
    expect(text).toContain("Nguyen Van A");
    expect(text).toContain("취소 수수료 단계표");
    expect(text).toContain("단계별 지급률 조정 요청");
    expect(text).not.toContain("CANCEL_PAY_RATE"); // 코드 그대로 노출 금지
    expect(text).toContain("서명할 수 없습니다");
  });

  it("RESOLVED 수용(vi) — 계약 갱신 안내", () => {
    const text = buildNotificationText(NotificationType.CONTRACT_NEGOTIATION, {
      kind: "RESOLVED",
      clauseKey: "cancelTiers",
      accepted: true,
      termsChanged: true,
      locale: "vi",
      resolvedNote: null,
    });
    expect(text).toContain("Bảng phí hủy");
    expect(text).toContain("Hợp đồng đã được cập nhật");
    expect(text).not.toMatch(/[가-힣]/); // 베트남어 수신자에게 한국어 잔존 금지
  });

  it("RESOLVED 거절(ko) — 사유가 그대로 전달된다", () => {
    const text = buildNotificationText(NotificationType.CONTRACT_NEGOTIATION, {
      kind: "RESOLVED",
      clauseKey: "payMethod",
      accepted: false,
      termsChanged: false,
      locale: "ko",
      resolvedNote: "현금 원칙은 유지합니다",
    });
    expect(text).toContain("지급 방법");
    expect(text).toContain("현금 원칙은 유지합니다");
  });

  it("★ 금액·마진 필드가 payload에 있어도 문구에 새어나가지 않는다", () => {
    const text = buildNotificationText(NotificationType.CONTRACT_NEGOTIATION, {
      kind: "REQUEST",
      counterpartName: "A",
      clauseKey: "cancelTiers",
      reason: "OTHER",
      hasProposal: false,
      note: null,
      salePriceKrw: 1234567, // 누수 시도(화이트리스트 필드만 렌더)
    });
    expect(text).not.toContain("1234567");
  });
});
