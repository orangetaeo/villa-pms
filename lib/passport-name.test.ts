import { describe, expect, it } from "vitest";
import {
  extractPassportPhotoFileName,
  fileBelongsToUploader,
} from "./passport-name";

// 사진면(접두 없음) — storage.buildFileName 형식
const PHOTO_NAME = "1760000000000-guest-bk1-0a1b2c3d-e4f5-6789-abcd-ef0123456789.jpg";
const PHOTO_URL = `/api/passports/${PHOTO_NAME}`;
const SIG_URL = "/api/passports/sig-1760000000000-x-0a1b2c3d-e4f5-6789-abcd-ef0123456789.png";
const DOC_URL = "/api/passports/doc-1760000000000-x-0a1b2c3d-e4f5-6789-abcd-ef0123456789.jpg";

describe("extractPassportPhotoFileName — tạm trú 전달 소스 가드 (ADR-0029 B3)", () => {
  it("사진면 URL → 파일명 추출", () => {
    expect(extractPassportPhotoFileName(PHOTO_URL)).toBe(PHOTO_NAME);
  });

  it("bare 파일명도 허용", () => {
    expect(extractPassportPhotoFileName(PHOTO_NAME)).toBe(PHOTO_NAME);
  });

  it("sig-(서명)·doc-(지류) 접두는 거부 (B3 혼입 금지)", () => {
    expect(extractPassportPhotoFileName(SIG_URL)).toBeNull();
    expect(extractPassportPhotoFileName(DOC_URL)).toBeNull();
  });

  it("경로주입·경로탈출·외부 URL·빈 값 거부", () => {
    for (const bad of [
      "/api/passports/../secret.jpg",
      "/api/passports/a/b.jpg",
      "../../etc/passwd",
      "https://evil.example/p.jpg",
      "/uploads/p.jpg",
      "",
      "name with space.jpg",
    ]) {
      expect(extractPassportPhotoFileName(bad)).toBeNull();
    }
  });

  it("bare 파일명에 .. 포함 거부", () => {
    expect(extractPassportPhotoFileName("..evil.jpg")).toBeNull();
  });
});

describe("fileBelongsToUploader (회귀)", () => {
  it("업로더 id가 박힌 파일은 소유 일치", () => {
    expect(fileBelongsToUploader(PHOTO_NAME, "guest-bk1")).toBe(true);
  });
  it("다른 업로더는 불일치", () => {
    expect(fileBelongsToUploader(PHOTO_NAME, "other")).toBe(false);
  });
});
