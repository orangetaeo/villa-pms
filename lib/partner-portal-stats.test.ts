import { describe, expect, it } from "vitest";
import { computePartnerReceivableStats } from "./partner-portal";

const due = (d: string) => new Date(`${d}T00:00:00.000Z`);
const today = due("2026-06-30");

describe("computePartnerReceivableStats", () => {
  it("미연체/연체 구간 분류 (오늘 2026-06-30)", () => {
    const s = computePartnerReceivableStats(
      [
        { outstandingVnd: "1000000", dueDate: due("2026-07-10") }, // 미래 → 미연체
        { outstandingVnd: "2000000", dueDate: due("2026-06-25") }, // 5일 연체 → d1_7
        { outstandingVnd: "3000000", dueDate: due("2026-06-10") }, // 20일 연체 → d8_30
        { outstandingVnd: "4000000", dueDate: due("2026-05-01") }, // 60일 연체 → d30plus
        { outstandingVnd: "0", dueDate: due("2026-01-01") }, // 잔액0 → 제외
      ],
      today
    );
    expect(s.openCount).toBe(4); // 잔액>0 4건
    expect(s.overdueCount).toBe(3);
    expect(s.notDueVnd).toBe("1000000");
    expect(s.overdueVnd).toBe("9000000"); // 2+3+4M
    expect(s.aging).toEqual({ d1_7: "2000000", d8_30: "3000000", d30plus: "4000000" });
  });

  it("dueDate 당일은 미연체(daysPast 0)", () => {
    const s = computePartnerReceivableStats(
      [{ outstandingVnd: "500000", dueDate: due("2026-06-30") }],
      today
    );
    expect(s.overdueCount).toBe(0);
    expect(s.notDueVnd).toBe("500000");
  });

  it("빈 목록 → 전부 0", () => {
    const s = computePartnerReceivableStats([], today);
    expect(s).toEqual({
      openCount: 0,
      overdueCount: 0,
      notDueVnd: "0",
      overdueVnd: "0",
      aging: { d1_7: "0", d8_30: "0", d30plus: "0" },
    });
  });
});
