import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";

const KEY = "test-zalo-creds-key-pXq9";

beforeAll(() => {
  process.env.ZALO_CREDS_KEY = KEY;
});

// 모듈은 encrypt/decrypt 호출 시점에 ZALO_CREDS_KEY를 읽으므로 beforeAll 이후 import해도 무방.
import { __cryptoTest } from "./zalo-credentials";

const { encrypt, decrypt, LEGACY_SALT } = __cryptoTest;

/** 레거시(고정 salt) 3세그먼트 암호문을 재현 — 폴백 검증용. */
function makeLegacyBlob(plaintext: string): string {
  const key = crypto.scryptSync(KEY, LEGACY_SALT, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${enc}`;
}

describe("zalo-credentials 암호화 — 무작위 salt + 레거시 폴백 (보안 P0-2)", () => {
  it("신형 왕복 복호화 성공 (salt:iv:authTag:ct, 4세그먼트)", () => {
    const payload = JSON.stringify({ imei: "abc", cookie: { a: 1 }, userAgent: "UA" });
    const blob = encrypt(payload);
    expect(blob.split(":")).toHaveLength(4);
    expect(decrypt(blob)).toBe(payload);
  });

  it("매 저장마다 salt가 달라 동일 평문도 암호문이 다르다", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(a.split(":")[0]).not.toBe(b.split(":")[0]); // salt 세그먼트 상이
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  it("레거시 3세그먼트(고정 salt) 암호문도 복호화 성공 (폴백 — 봇 블랙아웃 방지)", () => {
    const payload = JSON.stringify({ imei: "legacy", cookie: [], userAgent: "X" });
    const legacy = makeLegacyBlob(payload);
    expect(legacy.split(":")).toHaveLength(3);
    expect(decrypt(legacy)).toBe(payload);
  });

  it("잘못된 형식은 throw", () => {
    expect(() => decrypt("only:two")).toThrow();
  });
});
