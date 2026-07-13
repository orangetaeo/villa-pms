import { describe, expect, it } from "vitest";
import {
  provisionalGuestsFromTokenOcr,
  resolveRosterGuests,
} from "@/lib/checkin-roster";

// ADR-0043 — 게스트 여권 자동 OCR 잠정 명단 해석 순수함수.
//   확정본 우선 / 잠정본 폴백 / 전부-null 제거 / ticketGuestKey 중복 제거 / 배열 아님 방어.

// PassportOcrData 형태(surname/givenNames/birthDate만 명단에 관여) — 최소 필드로 구성.
const ocr = (surname: string | null, givenNames: string | null, birthDate: string | null) => ({
  surname,
  givenNames,
  passportNo: null,
  nationality: null,
  birthDate,
  expiryDate: null,
  sex: null,
});

describe("provisionalGuestsFromTokenOcr — 잠정본 정제", () => {
  it("정상 항목은 name(surname givenNames)·birthDate로 매핑", () => {
    const r = provisionalGuestsFromTokenOcr([ocr("KIM", "MINSU", "1990-01-02")]);
    expect(r).toEqual([{ name: "KIM MINSU", birthDate: "1990-01-02" }]);
  });

  it("name·birthDate 둘 다 null인 쓰레기 항목은 제거", () => {
    const r = provisionalGuestsFromTokenOcr([
      ocr(null, null, null), // 비여권 사진 — 제거
      ocr("LEE", "YOUNGHEE", "1988-05-05"),
    ]);
    expect(r).toEqual([{ name: "LEE YOUNGHEE", birthDate: "1988-05-05" }]);
  });

  it("한쪽만 있으면(이름만·생년만) 유지(전부-null 아님)", () => {
    const r = provisionalGuestsFromTokenOcr([ocr("PARK", null, null), ocr(null, null, "2000-12-31")]);
    expect(r).toEqual([
      { name: "PARK", birthDate: null },
      { name: null, birthDate: "2000-12-31" },
    ]);
  });

  it("ticketGuestKey(name+birthDate) 중복은 첫 등장만 유지(재촬영 중복)", () => {
    const r = provisionalGuestsFromTokenOcr([
      ocr("KIM", "MINSU", "1990-01-02"),
      ocr("KIM", "MINSU", "1990-01-02"), // 재촬영 — 제거
      ocr("KIM", "MINSU", "1991-01-02"), // 생년 다르면 별개
    ]);
    expect(r).toEqual([
      { name: "KIM MINSU", birthDate: "1990-01-02" },
      { name: "KIM MINSU", birthDate: "1991-01-02" },
    ]);
  });

  it("배열이 아니면 빈 배열(방어적 파싱)", () => {
    expect(provisionalGuestsFromTokenOcr(null)).toEqual([]);
    expect(provisionalGuestsFromTokenOcr(undefined)).toEqual([]);
    expect(provisionalGuestsFromTokenOcr({})).toEqual([]);
    expect(provisionalGuestsFromTokenOcr("nope")).toEqual([]);
  });
});

describe("resolveRosterGuests — 확정본 우선 / 잠정본 폴백", () => {
  it("확정본이 1명 이상이면 확정본만(잠정본 무시)", () => {
    const confirmed = [ocr("ADMIN", "CONFIRMED", "1970-07-07")];
    const token = [ocr("GUEST", "PROVISIONAL", "1999-09-09")];
    expect(resolveRosterGuests(confirmed, token)).toEqual([
      { name: "ADMIN CONFIRMED", birthDate: "1970-07-07" },
    ]);
  });

  it("확정본이 비어 있으면 잠정본(정제본) 사용", () => {
    const token = [ocr(null, null, null), ocr("GUEST", "PROVISIONAL", "1999-09-09")];
    expect(resolveRosterGuests(null, token)).toEqual([
      { name: "GUEST PROVISIONAL", birthDate: "1999-09-09" },
    ]);
  });

  it("확정본은 raw guestsFromPassportOcr 그대로(잠정 정제 미적용 — 기존 동작 불변)", () => {
    // 확정본은 운영자가 검수한 정본이므로 전부-null 제거·중복 제거를 적용하지 않는다.
    const confirmed = [ocr(null, null, null), ocr("A", "B", "2001-01-01")];
    expect(resolveRosterGuests(confirmed, [])).toEqual([
      { name: null, birthDate: null },
      { name: "A B", birthDate: "2001-01-01" },
    ]);
  });

  it("둘 다 비면 빈 배열(체크인 전·토큰 없음)", () => {
    expect(resolveRosterGuests(null, null)).toEqual([]);
    expect(resolveRosterGuests([], [])).toEqual([]);
  });
});
