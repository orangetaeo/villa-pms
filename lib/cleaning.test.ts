import { describe, expect, it } from "vitest";
import { CleaningStatus } from "@prisma/client";
import {
  CleaningTransitionError,
  OPEN_CLEANING_STATUSES,
  assertCleaningTransition,
  canOpenSellableGate,
  computeQualityScore,
  monthKeyVn,
} from "./cleaning";

describe("computeQualityScore — 청소 검수 통과율 (Phase 2)", () => {
  it("결정된 검수 0건 → 100 (신규 빌라 중립 상위)", () => {
    expect(computeQualityScore(0, 0)).toBe(100);
  });
  it("전부 승인 → 100", () => {
    expect(computeQualityScore(5, 0)).toBe(100);
  });
  it("전부 반려 → 0", () => {
    expect(computeQualityScore(0, 3)).toBe(0);
  });
  it("4승인 1반려 → 80", () => {
    expect(computeQualityScore(4, 1)).toBe(80);
  });
  it("2승인 1반려 → 67(반올림)", () => {
    expect(computeQualityScore(2, 1)).toBe(67);
  });
  it("음수 방어 → 100", () => {
    expect(computeQualityScore(-1, -1)).toBe(100);
  });
});

describe("assertCleaningTransition — 상태기계 (SPEC F4 게이트)", () => {
  it("허용 전이: PENDING→제출, REJECTED→재제출, 제출→승인|반려", () => {
    expect(() =>
      assertCleaningTransition(CleaningStatus.PENDING, CleaningStatus.PHOTOS_SUBMITTED)
    ).not.toThrow();
    expect(() =>
      assertCleaningTransition(CleaningStatus.REJECTED, CleaningStatus.PHOTOS_SUBMITTED)
    ).not.toThrow();
    expect(() =>
      assertCleaningTransition(CleaningStatus.PHOTOS_SUBMITTED, CleaningStatus.APPROVED)
    ).not.toThrow();
    expect(() =>
      assertCleaningTransition(CleaningStatus.PHOTOS_SUBMITTED, CleaningStatus.REJECTED)
    ).not.toThrow();
  });

  it("사진 없이 승인 직행 금지: PENDING→APPROVED 거부", () => {
    expect(() =>
      assertCleaningTransition(CleaningStatus.PENDING, CleaningStatus.APPROVED)
    ).toThrow(CleaningTransitionError);
  });

  it("REJECTED→APPROVED 직행 금지 (재업로드 필수)", () => {
    expect(() =>
      assertCleaningTransition(CleaningStatus.REJECTED, CleaningStatus.APPROVED)
    ).toThrow(CleaningTransitionError);
  });

  it("APPROVED는 종결 상태 — 어떤 전이도 금지", () => {
    for (const next of Object.values(CleaningStatus)) {
      expect(() => assertCleaningTransition(CleaningStatus.APPROVED, next)).toThrow(
        CleaningTransitionError
      );
    }
  });

  it("PENDING→REJECTED 직행 금지 (제출된 사진이 없어 반려 대상 없음)", () => {
    expect(() =>
      assertCleaningTransition(CleaningStatus.PENDING, CleaningStatus.REJECTED)
    ).toThrow(CleaningTransitionError);
  });
});

describe("canOpenSellableGate — 게이트 규칙 (사업 핵심 원칙 3)", () => {
  it("미결 CHECKOUT 태스크 0건이면 게이트 열기 허용", () => {
    expect(canOpenSellableGate(0)).toBe(true);
  });

  it("미결 CHECKOUT 태스크가 남아 있으면 열기 차단 — PERIODIC 승인 우회 불가", () => {
    expect(canOpenSellableGate(1)).toBe(false);
    expect(canOpenSellableGate(3)).toBe(false);
  });
});

describe("OPEN_CLEANING_STATUSES — 게이트를 잡는 상태 정의", () => {
  it("APPROVED만 게이트에서 해제 — PENDING·제출·REJECTED는 미결", () => {
    expect([...OPEN_CLEANING_STATUSES].sort()).toEqual(
      [CleaningStatus.PENDING, CleaningStatus.PHOTOS_SUBMITTED, CleaningStatus.REJECTED].sort()
    );
    expect(OPEN_CLEANING_STATUSES as readonly CleaningStatus[]).not.toContain(
      CleaningStatus.APPROVED
    );
  });
});

describe("monthKeyVn — 정기 방역 멱등 키 (Asia/Ho_Chi_Minh)", () => {
  it("VN 기준 YYYY-MM", () => {
    expect(monthKeyVn(new Date("2026-06-15T10:00:00.000Z"))).toBe("2026-06");
  });

  it("UTC 월말 자정 직전 — VN(UTC+7)은 이미 다음 달", () => {
    // UTC 6/30 20:00 = VN 7/1 03:00
    expect(monthKeyVn(new Date("2026-06-30T20:00:00.000Z"))).toBe("2026-07");
    // UTC 6/30 16:00 = VN 6/30 23:00 — 아직 6월
    expect(monthKeyVn(new Date("2026-06-30T16:00:00.000Z"))).toBe("2026-06");
  });

  it("연말 경계 — UTC 12/31 18:00 = VN 1/1 01:00", () => {
    expect(monthKeyVn(new Date("2026-12-31T18:00:00.000Z"))).toBe("2027-01");
    expect(monthKeyVn(new Date("2026-12-31T16:00:00.000Z"))).toBe("2026-12");
  });
});
