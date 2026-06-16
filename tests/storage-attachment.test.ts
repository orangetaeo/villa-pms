// [QA] 일반 파일 첨부 검증 정책(storage.validateAttachment) 단위 테스트.
// 순수 함수(부수효과 없음) — R2/디스크 미접촉. 위험 확장자·크기 상한·이미지 분리·경로/확장자.
import { describe, expect, it } from "vitest";
import { validateAttachment, MAX_ATTACHMENT_SIZE } from "@/lib/storage";

describe("validateAttachment — 허용", () => {
  it("일반 문서(pdf/docx/xlsx/zip)는 허용 + 정규화된 확장자 반환", () => {
    for (const [name, ext] of [
      ["계약서.pdf", "pdf"],
      ["견적.DOCX", "docx"],
      ["명단.xlsx", "xlsx"],
      ["사진모음.zip", "zip"],
    ] as const) {
      const r = validateAttachment(name, 1024);
      expect(r).toEqual({ ok: true, ext });
    }
  });
});

describe("validateAttachment — 거부", () => {
  it("위험 확장자(exe/bat/js/sh/ps1/jar 등) 차단", () => {
    for (const name of [
      "v.exe", "run.bat", "x.js", "s.sh", "p.ps1", "a.jar", "m.msi", "l.lnk", "h.hta",
    ]) {
      const r = validateAttachment(name, 100);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("BLOCKED_TYPE");
    }
  });
  it("확장자 없으면 NO_EXTENSION", () => {
    const r = validateAttachment("README", 100);
    expect(r).toEqual({ ok: false, reason: "NO_EXTENSION" });
  });
  it("이미지 확장자는 IS_IMAGE(별도 photo 경로로)", () => {
    for (const name of ["p.jpg", "p.png", "p.webp", "p.heic"]) {
      const r = validateAttachment(name, 100);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("IS_IMAGE");
    }
  });
  it("크기 상한 초과 TOO_LARGE", () => {
    const r = validateAttachment("big.pdf", MAX_ATTACHMENT_SIZE + 1);
    expect(r).toEqual({ ok: false, reason: "TOO_LARGE" });
  });
  it("상한 경계값(정확히 MAX)은 허용", () => {
    const r = validateAttachment("edge.pdf", MAX_ATTACHMENT_SIZE);
    expect(r.ok).toBe(true);
  });
});
