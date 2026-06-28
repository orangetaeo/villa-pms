// [QA] 파일 매직바이트(시그니처) 검증 — 보안 P3-S1 방어심화.
// sniffImageMime은 순수 함수(부수효과 없음). saveFile/savePassportFile은 비이미지 바이트를
// 디스크/R2 접촉 전에 거부함을 확인(throw가 fs.write보다 앞).
import { describe, expect, it } from "vitest";
import { sniffImageMime, saveFile, savePassportFile } from "@/lib/storage";

// 시그니처 + 12바이트 이상 패딩으로 최소 길이 충족
const pad = (head: number[]) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);

const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// "RIFF" + size(4) + "WEBP"
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(8)]);
// size(4) + "ftyp" + brand(4)
const heic = (brand: string) =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp"), Buffer.from(brand), Buffer.alloc(8)]);

describe("sniffImageMime — 허용 이미지 시그니처 (P3-S1)", () => {
  it("JPEG(FF D8 FF) → image/jpeg", () => expect(sniffImageMime(JPEG)).toBe("image/jpeg"));
  it("PNG(89 50 4E 47…) → image/png", () => expect(sniffImageMime(PNG)).toBe("image/png"));
  it("WebP(RIFF…WEBP) → image/webp", () => expect(sniffImageMime(WEBP)).toBe("image/webp"));
  it("HEIC brand(heic/heix/hevc) → image/heic", () => {
    expect(sniffImageMime(heic("heic"))).toBe("image/heic");
    expect(sniffImageMime(heic("heix"))).toBe("image/heic");
    expect(sniffImageMime(heic("hevc"))).toBe("image/heic");
  });
  it("HEIF brand(mif1/mif2/msf1/heif) → image/heif", () => {
    expect(sniffImageMime(heic("mif1"))).toBe("image/heif");
    expect(sniffImageMime(heic("mif2"))).toBe("image/heif");
    expect(sniffImageMime(heic("heif"))).toBe("image/heif");
  });
  it("major brand이 비-HEIC라도 compatible brands에 heic/mif1 있으면 통과(가용성)", () => {
    // [size][ftyp][major="mp42"][minor 4B][compatible="heic"] + pad
    const buf = Buffer.concat([
      Buffer.from([0, 0, 0, 0x20]),
      Buffer.from("ftyp"),
      Buffer.from("mp42"), // major (offset 8)
      Buffer.from([0, 0, 0, 0]), // minor (offset 12)
      Buffer.from("heic"), // compatible (offset 16)
      Buffer.alloc(8),
    ]);
    expect(sniffImageMime(buf)).toBe("image/heic");
  });
});

describe("sniffImageMime — 위장·비허용 거부 (null)", () => {
  it("SVG(스크립트 실행 가능)는 거부", () =>
    expect(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull());
  it("HTML은 거부", () =>
    expect(sniffImageMime(Buffer.from("<!DOCTYPE html><html><body>x</body></html>"))).toBeNull());
  it("GIF(화이트리스트 외)는 거부", () =>
    expect(sniffImageMime(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(8)]))).toBeNull());
  it("일반 텍스트는 거부", () => expect(sniffImageMime(Buffer.from("just some text bytes here"))).toBeNull());
  it("빈/너무 짧은 버퍼는 거부", () => {
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull(); // <12바이트
  });
  it("미지의 ftyp brand는 거부(heic/heif 계열만 허용)", () =>
    expect(sniffImageMime(heic("mp42"))).toBeNull());
});

describe("saveFile/savePassportFile — 위장 바이트는 저장 전 거부", () => {
  const SVG_DISGUISED = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

  it("declared가 image/jpeg여도 실제 SVG 바이트면 saveFile이 INVALID_IMAGE_BYTES throw", async () => {
    await expect(saveFile(SVG_DISGUISED, "image/jpeg", "user-1")).rejects.toThrow("INVALID_IMAGE_BYTES");
  });
  it("여권 경로(savePassportFile)도 위장 바이트 거부", async () => {
    await expect(savePassportFile(SVG_DISGUISED, "image/png", "user-1")).rejects.toThrow("INVALID_IMAGE_BYTES");
  });
});
