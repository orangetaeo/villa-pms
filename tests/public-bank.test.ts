import { beforeEach, describe, expect, it, vi } from "vitest";

// #6a 공개 제안 입금 계좌 — 통화별 계좌 세트 선택 + 미설정 폴백.
const mockFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findMany: (...a: unknown[]) => mockFindMany(...a) } },
}));

import { bankKeySetFor, getPublicBankInfo } from "@/app/p/_components/public-bank";
import type { Currency } from "@prisma/client";

const KRW = "KRW" as Currency;
const VND = "VND" as Currency;
const USD = "USD" as Currency;

beforeEach(() => vi.clearAllMocks());

describe("bankKeySetFor — 통화별 계좌 키 세트", () => {
  it("VND → 베트남 계좌 키", () => {
    expect(bankKeySetFor(VND)).toEqual({
      name: "BANK_VN_NAME",
      number: "BANK_VN_ACCOUNT_NUMBER",
      holder: "BANK_VN_ACCOUNT_HOLDER",
    });
  });
  it("KRW·그 외 → 한국 계좌 키", () => {
    expect(bankKeySetFor(KRW).name).toBe("BANK_NAME");
    expect(bankKeySetFor(USD).name).toBe("BANK_NAME"); // VND 외 전부 한국 폴백
  });
});

describe("getPublicBankInfo — 조회·폴백", () => {
  it("VND 통화 → VND 키로 조회, 전 필드 반환", async () => {
    mockFindMany.mockResolvedValue([
      { key: "BANK_VN_NAME", value: "Vietcombank" },
      { key: "BANK_VN_ACCOUNT_NUMBER", value: "0123456789" },
      { key: "BANK_VN_ACCOUNT_HOLDER", value: "CONG TY ABC" },
    ]);
    const info = await getPublicBankInfo(VND);
    expect(info).toEqual({ name: "Vietcombank", number: "0123456789", holder: "CONG TY ABC" });
    // VND 키로만 조회 (KRW 키 미조회)
    const where = mockFindMany.mock.calls[0][0].where.key.in as string[];
    expect(where).toContain("BANK_VN_NAME");
    expect(where).not.toContain("BANK_NAME");
  });

  it("예금주 없어도 은행명·번호만 있으면 반환(holder null)", async () => {
    mockFindMany.mockResolvedValue([
      { key: "BANK_NAME", value: "KB" },
      { key: "BANK_ACCOUNT_NUMBER", value: "111-222" },
    ]);
    expect(await getPublicBankInfo(KRW)).toEqual({ name: "KB", number: "111-222", holder: null });
  });

  it("은행명 또는 번호 미설정 → null (부분 설정은 미노출)", async () => {
    mockFindMany.mockResolvedValue([{ key: "BANK_NAME", value: "KB" }]); // 번호 없음
    expect(await getPublicBankInfo(KRW)).toBeNull();
  });

  it("계좌 전혀 미설정 → null (안전 폴백)", async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await getPublicBankInfo(KRW)).toBeNull();
  });
});
