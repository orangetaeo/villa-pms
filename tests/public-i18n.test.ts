import { describe, expect, it } from "vitest";
import {
  PUBLIC_LABELS,
  PUBLIC_LANGS,
  BED_LABELS,
  FEATURE_LABELS,
  isPublicLang,
  resolvePublicLang,
  formatPublicDateLong,
  formatPublicDateShort,
} from "@/lib/public-i18n";

// #5 공개페이지 5개 언어 — 키 parity·로케일 해석·라벨 헬퍼 검증.

describe("resolvePublicLang — 우선순위 param > cookie > ko", () => {
  it("?lang 파라미터 우선", () => {
    expect(resolvePublicLang("en", "vi")).toBe("en");
    expect(resolvePublicLang("ru", null)).toBe("ru");
  });
  it("파라미터 없으면 쿠키", () => {
    expect(resolvePublicLang(undefined, "zh")).toBe("zh");
    expect(resolvePublicLang(null, "vi")).toBe("vi");
  });
  it("둘 다 없거나 무효면 ko 폴백", () => {
    expect(resolvePublicLang(undefined, undefined)).toBe("ko");
    expect(resolvePublicLang("xx", "yy")).toBe("ko");
    expect(resolvePublicLang("", "")).toBe("ko");
  });
  it("isPublicLang 5종만 통과", () => {
    for (const l of PUBLIC_LANGS) expect(isPublicLang(l)).toBe(true);
    expect(isPublicLang("jp")).toBe(false);
    expect(isPublicLang(undefined)).toBe(false);
  });
});

// 깊은 키 구조 동등성 — ko를 기준으로 5개 언어가 같은 모양인지(함수/객체/문자열 타입까지) 재귀 비교.
function shape(v: unknown): unknown {
  if (typeof v === "function") return "fn";
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = shape((v as Record<string, unknown>)[k]);
    return out;
  }
  return typeof v;
}

describe("PUBLIC_LABELS — 5개 언어 키 parity 100%", () => {
  const koShape = JSON.stringify(shape(PUBLIC_LABELS.ko));
  for (const lang of PUBLIC_LANGS) {
    it(`${lang} 구조가 ko와 동일`, () => {
      expect(JSON.stringify(shape(PUBLIC_LABELS[lang]))).toBe(koShape);
    });
  }
});

describe("BED_LABELS / FEATURE_LABELS — 5개 언어 키 parity", () => {
  const bedKeys = Object.keys(BED_LABELS.ko).sort();
  const featKeys = Object.keys(FEATURE_LABELS.ko).sort();
  for (const lang of PUBLIC_LANGS) {
    it(`${lang} 침대·셀링포인트 키 동일`, () => {
      expect(Object.keys(BED_LABELS[lang]).sort()).toEqual(bedKeys);
      expect(Object.keys(FEATURE_LABELS[lang]).sort()).toEqual(featKeys);
    });
  }
});

describe("날짜 헬퍼 — 언어별 형식 + UTC 기준", () => {
  // 2026-07-15 = 수요일(UTC). @db.Date(UTC 자정) 가정.
  const d = new Date(Date.UTC(2026, 6, 15));
  it("formatPublicDateLong 언어별", () => {
    expect(formatPublicDateLong(d, "ko")).toBe("7월 15일 (수)");
    expect(formatPublicDateLong(d, "en")).toBe("Jul 15 (Wed)");
    expect(formatPublicDateLong(d, "zh")).toBe("7月15日 (周三)");
    expect(formatPublicDateLong(d, "vi")).toBe("15 thg 7 (T4)");
    expect(formatPublicDateLong(d, "ru")).toBe("15 июл (Ср)");
  });
  it("formatPublicDateShort 요일만 언어별", () => {
    expect(formatPublicDateShort(d, "ko")).toBe("07.15 (수)");
    expect(formatPublicDateShort(d, "en")).toBe("07.15 (Wed)");
  });
});

describe("파라메트릭 함수 — 보간", () => {
  it("nights/maxGuests/expiryBadge 동작", () => {
    expect(PUBLIC_LABELS.ko.proposal.nights(3)).toBe("3박");
    expect(PUBLIC_LABELS.en.proposal.nights(1)).toBe("1 night");
    expect(PUBLIC_LABELS.en.proposal.nights(2)).toBe("2 nights");
    expect(PUBLIC_LABELS.ko.sales.maxGuests(8)).toBe("최대 8인");
    expect(PUBLIC_LABELS.ko.expiryBadge(47)).toBe("47시간 후 만료");
    expect(PUBLIC_LABELS.ko.expiryBadge(0)).toBe("곧 만료");
  });
});
