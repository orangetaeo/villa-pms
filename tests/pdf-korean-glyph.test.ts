// tests/pdf-korean-glyph.test.ts — 회귀 가드: PDF 한글 글리프 폴백(NanumGothic) 유실 방지.
//
// 배경: 정산서/청구서 PDF의 한글 빌라명·이름이 NotoSans(한글 글리프 없음)로 깨졌다.
// 과거 수정(NanumGothic 런 분리)이 공유 HEAD reset로 코드·폰트째 유실되어 깨짐이 재발한 이력.
// react-pdf .tsx는 vitest(esbuild jsx=preserve)에서 직접 렌더 곤란 → 실렌더 대신 정적 소스로 고정.
//   (실렌더 검증은 scripts/esbuild 번들로 별도 수행: invoice ko/vi/en·settlement 모두 NanumGothic 임베드 확인됨)
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { partnerInvoiceLocale } from "@/lib/partner-country";

describe("파트너 국가 → 청구서 PDF 언어 매핑", () => {
  it("KR=ko, VN=vi, 미지정=vi(기존동작), 그 외=en", () => {
    expect(partnerInvoiceLocale("KR")).toBe("ko");
    expect(partnerInvoiceLocale("VN")).toBe("vi");
    expect(partnerInvoiceLocale(null)).toBe("vi");
    expect(partnerInvoiceLocale(undefined)).toBe("vi");
    expect(partnerInvoiceLocale("")).toBe("vi");
    expect(partnerInvoiceLocale("CN")).toBe("en");
    expect(partnerInvoiceLocale("RU")).toBe("en");
  });
});

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("PDF 한글 글리프 폴백 — 유실 재발 가드", () => {
  it("공용 폰트 모듈이 NanumGothic을 등록하고 mixedTextChildren을 export한다", () => {
    const src = read("lib/pdf-fonts.tsx");
    expect(src).toContain("NanumGothic");
    expect(src).toContain("NanumGothic-Regular.ttf");
    expect(src).toContain("export function mixedTextChildren");
  });

  it("NanumGothic 폰트 파일(Regular/Bold)이 번들되어 있다", () => {
    expect(existsSync(path.join(root, "assets/fonts/NanumGothic-Regular.ttf"))).toBe(true);
    expect(existsSync(path.join(root, "assets/fonts/NanumGothic-Bold.ttf"))).toBe(true);
  });

  it("청구서·정산서 PDF가 공용 글리프 헬퍼로 동적 텍스트를 감싼다", () => {
    for (const f of ["lib/partner-invoice-pdf.tsx", "lib/settlement-statement-pdf.tsx"]) {
      const src = read(f);
      expect(src, `${f} must import shared font module`).toContain('from "@/lib/pdf-fonts"');
      // 빌라명·파트너/공급자명 등 한글 가능 동적 텍스트는 mixedTextChildren으로 감쌀 것
      expect(src, `${f} must wrap villa/partner name`).toContain("mixedTextChildren(");
    }
  });

  it("청구서 PDF가 파트너 국가별 언어(ko/vi/en) 라벨 사전을 가진다", () => {
    const src = read("lib/partner-invoice-pdf.tsx");
    expect(src).toContain("Record<InvoiceLocale, InvoiceLabels>");
    for (const loc of ["vi:", "ko:", "en:"]) expect(src).toContain(loc);
  });
});
