import { describe, expect, it } from "vitest";
import { SettlementStatus } from "@prisma/client";
import {
  SettlementTransitionError,
  assertSettlementTransition,
  groupBySupplier,
  monthRangeUtc,
  type SettlementAction,
} from "./settlement";

describe("monthRangeUtc — [월초, 익월초) UTC (SPEC F6: 집계 기준 = 체크아웃 월)", () => {
  it("일반 월: 2026-07 → [07-01, 08-01)", () => {
    const { start, end } = monthRangeUtc("2026-07");
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("월말 경계: 31일 월 / 30일 월 모두 익월초가 end (exclusive)", () => {
    expect(monthRangeUtc("2026-01").end.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(monthRangeUtc("2026-04").end.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("연말 경계: 2026-12 → end가 2027-01-01 (연도 롤오버)", () => {
    const { start, end } = monthRangeUtc("2026-12");
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("윤년 2월: 2028-02 → [02-01, 03-01) — 29일까지 포함", () => {
    const { start, end } = monthRangeUtc("2028-02");
    expect(start.toISOString()).toBe("2028-02-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2028-03-01T00:00:00.000Z");
    // 2028-02-29 체크아웃이 범위 안 (윤년)
    const feb29 = new Date("2028-02-29T00:00:00.000Z");
    expect(feb29.getTime() >= start.getTime() && feb29.getTime() < end.getTime()).toBe(true);
  });

  it("평년 2월: 2026-02 → end 03-01 (28일 월도 동일 규칙)", () => {
    expect(monthRangeUtc("2026-02").end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("형식 오류는 RangeError (조용한 폴백 금지)", () => {
    for (const bad of [
      "2026-7", // 0 패딩 누락
      "2026-13", // 존재하지 않는 월
      "2026-00",
      "202607",
      "2026/07",
      "2026-07-01", // 일자 포함
      "abcd-ef",
      "",
    ]) {
      expect(() => monthRangeUtc(bad), bad).toThrow(RangeError);
    }
  });
});

describe("assertSettlementTransition — DRAFT→CONFIRMED→PAID 전이표 (계약 완료 기준 2)", () => {
  it("정방향: DRAFT+CONFIRM → CONFIRMED, CONFIRMED+MARK_PAID → PAID", () => {
    expect(assertSettlementTransition(SettlementStatus.DRAFT, "CONFIRM")).toBe(
      SettlementStatus.CONFIRMED
    );
    expect(assertSettlementTransition(SettlementStatus.CONFIRMED, "MARK_PAID")).toBe(
      SettlementStatus.PAID
    );
  });

  it("건너뛰기·역방향·중복은 전부 SettlementTransitionError (409 의미)", () => {
    const invalid: [SettlementStatus, SettlementAction][] = [
      [SettlementStatus.DRAFT, "MARK_PAID"], // 건너뛰기
      [SettlementStatus.CONFIRMED, "CONFIRM"], // 중복
      [SettlementStatus.PAID, "CONFIRM"], // 역방향 — PAID 후 불변
      [SettlementStatus.PAID, "MARK_PAID"], // 중복 지급
    ];
    for (const [current, action] of invalid) {
      expect(() => assertSettlementTransition(current, action), `${current}+${action}`).toThrow(
        SettlementTransitionError
      );
    }
  });

  it("에러에 현재 상태·액션이 담긴다 (route 409 응답 본문용)", () => {
    try {
      assertSettlementTransition(SettlementStatus.PAID, "MARK_PAID");
      expect.unreachable("throw 되어야 함");
    } catch (e) {
      expect(e).toBeInstanceOf(SettlementTransitionError);
      const err = e as SettlementTransitionError;
      expect(err.code).toBe("INVALID_TRANSITION");
      expect(err.current).toBe(SettlementStatus.PAID);
      expect(err.action).toBe("MARK_PAID");
    }
  });
});

describe("groupBySupplier — 공급자별 BigInt 합산 (money-pattern: Number 금지)", () => {
  it("공급자별 totalVnd = Σ supplierCostVnd, items 1:1 매핑", () => {
    const groups = groupBySupplier([
      { bookingId: "b1", supplierId: "s1", supplierCostVnd: 5_000_000n },
      { bookingId: "b2", supplierId: "s1", supplierCostVnd: 7_500_000n },
      { bookingId: "b3", supplierId: "s2", supplierCostVnd: 12_000_000n },
    ]);

    expect(groups.size).toBe(2);
    expect(groups.get("s1")?.totalVnd).toBe(12_500_000n);
    expect(groups.get("s1")?.items).toEqual([
      { bookingId: "b1", amountVnd: 5_000_000n },
      { bookingId: "b2", amountVnd: 7_500_000n },
    ]);
    expect(groups.get("s2")?.totalVnd).toBe(12_000_000n);
  });

  it("Number.MAX_SAFE_INTEGER 초과 합계도 정확 (BigInt 유지 검증)", () => {
    // VND 동 단위 대형 합계 — float 경유 시 정밀도 손실로 실패하는 케이스
    const huge = 9_007_199_254_740_991n; // MAX_SAFE_INTEGER
    const groups = groupBySupplier([
      { bookingId: "b1", supplierId: "s1", supplierCostVnd: huge },
      { bookingId: "b2", supplierId: "s1", supplierCostVnd: 2n },
    ]);
    expect(groups.get("s1")?.totalVnd).toBe(9_007_199_254_740_993n);
  });

  it("빈 입력 → 빈 Map (빈 정산 미생성의 전제)", () => {
    expect(groupBySupplier([]).size).toBe(0);
  });
});
