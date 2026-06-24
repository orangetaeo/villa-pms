// formatDateTime 회귀 — 자정(00시)을 "00"으로 렌더(hourCycle h23). hour12:false만 두면
// Node ICU가 "24:13", 브라우저 ICU가 "00:13"로 갈려 SSR 하이드레이션 #418이 났던 버그 방지.
import { describe, it, expect } from "vitest";
import { formatDateTime } from "@/lib/format";

describe("formatDateTime (Asia/Ho_Chi_Minh, hourCycle h23)", () => {
  it("자정 직후를 24시가 아닌 00시로 렌더한다", () => {
    // VN(UTC+7) 2026-06-12 00:13 = UTC 2026-06-11 17:13
    expect(formatDateTime(new Date("2026-06-11T17:13:00Z"))).toBe("2026.06.12 00:13");
  });

  it("정오·일반 시각은 그대로 렌더한다", () => {
    // VN 2026-06-12 07:00 = UTC 2026-06-12 00:00
    expect(formatDateTime(new Date("2026-06-12T00:00:00Z"))).toBe("2026.06.12 07:00");
    // VN 2026-06-23 20:47 = UTC 2026-06-23 13:47
    expect(formatDateTime(new Date("2026-06-23T13:47:00Z"))).toBe("2026.06.23 20:47");
  });
});
