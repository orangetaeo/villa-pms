import { describe, expect, it } from "vitest";
import {
  EVIDENCE_MAX_EDGE,
  EVIDENCE_QUALITY,
  EVIDENCE_PRESET,
  isUnprocessableEvidenceBlob,
} from "@/lib/image-resize";
import { GUEST_LABELS } from "@/lib/guest-i18n";
import type { PublicLang } from "@/lib/public-i18n";
import ko from "@/messages/ko.json";
import vi from "@/messages/vi.json";

// img-compress-coverage — 이미지 압축 사각지대 보완 (#1 여권·#2 종이서류·#3 카탈로그)
// resizeImage는 브라우저 전용(canvas/createImageBitmap)이라 node vitest에서 직접 호출 불가.
// 따라서 ① 증빙 프리셋 상수값 ② HEIC 폴백 가드의 판정 로직(순수 함수로 재현) ③ i18n 키 parity를 검증.

const MAX_FILE_SIZE = 5 * 1024 * 1024;

// 게스트 여권(#1) 업로드 핸들러가 쓰는 바로 그 판정 함수를 직접 검증(복제본 아님 — 동기화 깨짐 차단).
const isUnprocessable = (blob: { type: string; size: number }) =>
  isUnprocessableEvidenceBlob(blob, MAX_FILE_SIZE);

describe("증빙 프리셋 상수 (lib/image-resize)", () => {
  it("EVIDENCE_MAX_EDGE=2400 / EVIDENCE_QUALITY=0.90 (계약 §2-1 확정값)", () => {
    expect(EVIDENCE_MAX_EDGE).toBe(2400);
    expect(EVIDENCE_QUALITY).toBe(0.9);
  });
  it("EVIDENCE_PRESET 객체가 동일 값", () => {
    expect(EVIDENCE_PRESET).toEqual({ maxEdge: 2400, quality: 0.9 });
  });
});

describe("#1 게스트 여권 HEIC 폴백 가드 판정", () => {
  it("정상 JPEG·5MB 이내 → 통과", () => {
    expect(isUnprocessable({ type: "image/jpeg", size: 2 * 1024 * 1024 })).toBe(false);
  });
  it("HEIC 폴백(image/heic) → 차단(재촬영)", () => {
    expect(isUnprocessable({ type: "image/heic", size: 1 * 1024 * 1024 })).toBe(true);
  });
  it("HEIF 폴백(image/heif) → 차단(재촬영)", () => {
    expect(isUnprocessable({ type: "image/heif", size: 1 * 1024 * 1024 })).toBe(true);
  });
  it("JPEG지만 5MB 초과 → 차단(재촬영)", () => {
    expect(isUnprocessable({ type: "image/jpeg", size: 6 * 1024 * 1024 })).toBe(true);
  });
  it("PNG/WebP 원본(소형 스킵 케이스) → 통과(뷰어 지원, 오차단 금지)", () => {
    expect(isUnprocessable({ type: "image/png", size: 200 * 1024 })).toBe(false);
    expect(isUnprocessable({ type: "image/webp", size: 200 * 1024 })).toBe(false);
  });
  it("type 누락(빈 문자열) → 차단(뷰어 보장 불가)", () => {
    expect(isUnprocessable({ type: "", size: 100 * 1024 })).toBe(true);
  });
});

describe("#1 게스트 여권 재촬영 안내 — 5개 언어 parity (GuestLabels.passport.processFailed)", () => {
  const LANGS: PublicLang[] = ["ko", "en", "ru", "zh", "vi"];
  it.each(LANGS)("'%s' passport.processFailed 비어있지 않음", (lang) => {
    const msg = GUEST_LABELS[lang].passport.processFailed;
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe("#2 종이서류 사이즈 가드 안내 — ko/vi (adminBookings.detail.paperDocs.tooLarge)", () => {
  it("ko 보유", () => {
    expect(
      (ko.adminBookings.detail.paperDocs as Record<string, string>).tooLarge?.length
    ).toBeGreaterThan(0);
  });
  it("vi 보유", () => {
    expect(
      (vi.adminBookings.detail.paperDocs as Record<string, string>).tooLarge?.length
    ).toBeGreaterThan(0);
  });
});
