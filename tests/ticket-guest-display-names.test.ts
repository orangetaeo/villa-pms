// tests/ticket-guest-display-names.test.ts — 소비자 신청 내역 라인 이용자 이름 추출(테오)
//   ticketGuestDisplayNames: TICKET 스냅샷에서 **이름만** 추출(누가 무료·누가 일반 식별).
//   ★누수 경계: birthDate·heightCm·passportNo는 소비자 payload에 절대 미포함(name만).
//   비TICKET·스냅샷 null(구주문)은 빈 배열(오류 없음).
import { describe, it, expect } from "vitest";
import { ticketGuestDisplayNames } from "@/lib/ticket-guests";

describe("ticketGuestDisplayNames — 라인 이용자 이름(이름만)", () => {
  it("TICKET 스냅샷에서 이름만 배열로 추출한다", () => {
    const names = ticketGuestDisplayNames("TICKET", [
      { name: "KIM CHUL SOO", birthDate: "1980-05-03" },
      { name: "LEE", birthDate: "1992-01-09", heightCm: 128 },
    ]);
    expect(names).toEqual(["KIM CHUL SOO", "LEE"]);
    // 원소는 전부 string(객체 아님) — birthDate/heightCm/passportNo 유입 불가.
    for (const n of names) expect(typeof n).toBe("string");
  });

  it("생년월일·신장·여권번호는 결과에 포함되지 않는다(이름만)", () => {
    const names = ticketGuestDisplayNames("TICKET", [
      { name: "KIM", birthDate: "1980-05-03", heightCm: 170, passportNo: "M1234567", nationality: "KOR" },
    ]);
    expect(names).toEqual(["KIM"]);
    // 배열 원소는 순수 문자열 — 객체 프로퍼티 자체가 없음(누수 0).
    const joined = JSON.stringify(names);
    expect(joined).not.toContain("1980-05-03");
    expect(joined).not.toContain("170");
    expect(joined).not.toContain("M1234567");
    expect(joined).not.toContain("KOR");
  });

  it("name이 null인 이용자는 제외한다", () => {
    const names = ticketGuestDisplayNames("TICKET", [
      { name: null, birthDate: "1980-05-03" },
      { name: "PARK", birthDate: "1975-02-02" },
    ]);
    expect(names).toEqual(["PARK"]);
  });

  it("비TICKET 타입은 스냅샷이 있어도 빈 배열", () => {
    expect(
      ticketGuestDisplayNames("MASSAGE", [{ name: "KIM", birthDate: "1980-05-03" }])
    ).toEqual([]);
    expect(ticketGuestDisplayNames("BBQ", [{ name: "LEE", birthDate: "1990-01-01" }])).toEqual([]);
  });

  it("스냅샷 없는 구주문(null·undefined)은 빈 배열(오류 없음)", () => {
    expect(ticketGuestDisplayNames("TICKET", null)).toEqual([]);
    expect(ticketGuestDisplayNames("TICKET", undefined)).toEqual([]);
    expect(ticketGuestDisplayNames("TICKET", [])).toEqual([]);
  });
});
