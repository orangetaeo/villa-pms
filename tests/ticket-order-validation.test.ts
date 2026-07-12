// 공유 TICKET 이용자 스냅샷 검증 lib 단위 테스트 (ADR-0036)
//   게스트·운영자 두 생성 경로가 공유하는 lib/ticket-order-validation의 순수 동작을 직접 검증.
//   ★ ticket-variant-rules·ticket-guests 실제 구현 사용(검증 로직이 대상). prisma 미의존(loadConfirmedGuests 주입).
import { describe, it, expect, vi } from "vitest";
import { validateTicketGuests } from "@/lib/ticket-order-validation";
import { readVariantRule, type VariantRule } from "@/lib/ticket-variant-rules";

// 체크인 확정본 — 2명(KIM CHUL SOO 1980-05-03 · LEE 1992-01-09)
const confirmed = [
  { name: "KIM CHUL SOO", birthDate: "1980-05-03" },
  { name: "LEE", birthDate: "1992-01-09" },
];
const loader = () => vi.fn(async () => confirmed);

const seniorRule: VariantRule = readVariantRule({ key: "senior", bornBeforeYear: 1985 });
const childHeightRule: VariantRule = readVariantRule({ key: "child", heightMaxCm: 140 });

describe("validateTicketGuests — 공유 검증", () => {
  it("비TICTKET 품목은 스냅샷 없음(loadConfirmedGuests 미호출)", async () => {
    const load = loader();
    const r = await validateTicketGuests({
      itemType: "MASSAGE",
      variantRule: null,
      ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }],
      quantity: 1,
      serviceDateOnly: "2026-08-01",
      loadConfirmedGuests: load,
    });
    expect(r).toEqual({ ok: true, snapshot: null });
    expect(load).not.toHaveBeenCalled();
  });

  it("명단 미제공(규칙 없음)이면 스냅샷 없음(loader 미호출)", async () => {
    const load = loader();
    const r = await validateTicketGuests({
      itemType: "TICKET",
      variantRule: null,
      ticketGuests: undefined,
      quantity: 1,
      serviceDateOnly: "2026-08-01",
      loadConfirmedGuests: load,
    });
    expect(r).toEqual({ ok: true, snapshot: null });
    expect(load).not.toHaveBeenCalled();
  });

  it("규칙 variant인데 명단 생략 → TICKET_GUESTS_REQUIRED(loader 미호출)", async () => {
    const load = loader();
    const r = await validateTicketGuests({
      itemType: "TICKET",
      variantRule: seniorRule,
      ticketGuests: [],
      quantity: 3,
      serviceDateOnly: "2026-08-01",
      loadConfirmedGuests: load,
    });
    expect(r).toEqual({ ok: false, error: "TICKET_GUESTS_REQUIRED" });
    expect(load).not.toHaveBeenCalled();
  });

  it("인원 수 ≠ quantity → TICKET_GUEST_COUNT_MISMATCH(loader 미호출)", async () => {
    const load = loader();
    const r = await validateTicketGuests({
      itemType: "TICKET",
      variantRule: null,
      ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }],
      quantity: 2,
      serviceDateOnly: "2026-08-01",
      loadConfirmedGuests: load,
    });
    expect(r).toEqual({ ok: false, error: "TICKET_GUEST_COUNT_MISMATCH" });
    expect(load).not.toHaveBeenCalled();
  });

  it("주문 내 중복 인원 → TICKET_GUEST_DUPLICATE(loader 미호출)", async () => {
    const load = loader();
    const r = await validateTicketGuests({
      itemType: "TICKET",
      variantRule: null,
      ticketGuests: [
        { name: "KIM CHUL SOO", birthDate: "1980-05-03" },
        { name: "KIM CHUL SOO", birthDate: "1980-05-03" },
      ],
      quantity: 2,
      serviceDateOnly: "2026-08-01",
      loadConfirmedGuests: load,
    });
    expect(r).toEqual({ ok: false, error: "TICKET_GUEST_DUPLICATE" });
    expect(load).not.toHaveBeenCalled();
  });

  it("명단에 없는 인원 → TICKET_GUEST_MISMATCH(loader 1회 호출)", async () => {
    const load = loader();
    const r = await validateTicketGuests({
      itemType: "TICKET",
      variantRule: null,
      ticketGuests: [{ name: "HACKER INJECT", birthDate: "2000-01-01" }],
      quantity: 1,
      serviceDateOnly: "2026-08-01",
      loadConfirmedGuests: load,
    });
    expect(r).toEqual({ ok: false, error: "TICKET_GUEST_MISMATCH" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("출생년도 규칙 위반(1992≥1985 senior) → TICKET_GUEST_RULE_MISMATCH", async () => {
    const r = await validateTicketGuests({
      itemType: "TICKET",
      variantRule: seniorRule,
      ticketGuests: [{ name: "LEE", birthDate: "1992-01-09" }],
      quantity: 1,
      serviceDateOnly: "2026-08-01",
      loadConfirmedGuests: loader(),
    });
    expect(r).toEqual({ ok: false, error: "TICKET_GUEST_RULE_MISMATCH" });
  });

  it("출생년도 규칙 충족(1980<1985) → 스냅샷 반환", async () => {
    const r = await validateTicketGuests({
      itemType: "TICKET",
      variantRule: seniorRule,
      ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }],
      quantity: 1,
      serviceDateOnly: "2026-08-01",
      loadConfirmedGuests: loader(),
    });
    expect(r).toEqual({ ok: true, snapshot: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }] });
  });

  it("신장 규칙(140) — 신장 미신고 → RULE_MISMATCH", async () => {
    const r = await validateTicketGuests({
      itemType: "TICKET",
      variantRule: childHeightRule,
      ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }],
      quantity: 1,
      serviceDateOnly: "2026-08-01",
      loadConfirmedGuests: loader(),
    });
    expect(r).toEqual({ ok: false, error: "TICKET_GUEST_RULE_MISMATCH" });
  });

  it("신장 규칙 충족(128<140) → 신장 스냅샷 보존", async () => {
    const r = await validateTicketGuests({
      itemType: "TICKET",
      variantRule: childHeightRule,
      ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03", heightCm: 128 }],
      quantity: 1,
      serviceDateOnly: "2026-08-01",
      loadConfirmedGuests: loader(),
    });
    expect(r).toEqual({
      ok: true,
      snapshot: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03", heightCm: 128 }],
    });
  });
});
