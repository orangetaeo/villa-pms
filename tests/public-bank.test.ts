import { beforeEach, describe, expect, it, vi } from "vitest";

// #6a 공개 제안 입금 계좌 — 통화별 계좌 세트 선택 + 미설정 폴백.
const mockFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findMany: (...a: unknown[]) => mockFindMany(...a) } },
}));

import {
  bankKeySetFor,
  buildBankAccounts,
  getPublicBankAccounts,
  getPublicBankInfo,
} from "@/app/p/_components/public-bank";
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

// ★ 한국·베트남 계좌 동시 안내 (2026-07-23) — 계좌 하나만 보여주면 고객이 어느 나라 계좌인지 모른다.
describe("buildBankAccounts — 국가 라벨 + 결제 통화 우선", () => {
  const full = new Map([
    ["BANK_NAME", "KB국민"],
    ["BANK_ACCOUNT_NUMBER", "111-222"],
    ["BANK_ACCOUNT_HOLDER", "테오"],
    ["BANK_VN_NAME", "Vietcombank"],
    ["BANK_VN_ACCOUNT_NUMBER", "0123456789"],
  ]);

  it("설정된 계좌를 모두 국가와 함께 반환한다", () => {
    const accounts = buildBankAccounts(full, KRW);
    expect(accounts.map((a) => a.country)).toEqual(["KR", "VN"]);
    expect(accounts[1]).toEqual({
      country: "VN",
      name: "Vietcombank",
      number: "0123456789",
      holder: null, // 예금주 미설정도 허용
      primary: false,
    });
  });

  it("VND 제안이면 베트남 계좌가 맨 앞 + primary", () => {
    const accounts = buildBankAccounts(full, VND);
    expect(accounts[0].country).toBe("VN");
    expect(accounts[0].primary).toBe(true);
    expect(accounts[1].primary).toBe(false); // 한국 계좌도 함께 보이되 배지는 없다
  });

  it("USD 처럼 전용 계좌가 없는 통화는 primary 없이 두 계좌만 안내", () => {
    const accounts = buildBankAccounts(full, USD);
    expect(accounts).toHaveLength(2);
    expect(accounts.some((a) => a.primary)).toBe(false);
  });

  it("부분 설정(번호 없음) 계좌는 제외하고 나머지만 보여준다", () => {
    const partial = new Map([
      ["BANK_NAME", "KB국민"], // 번호 없음 → 한국 계좌 미노출
      ["BANK_VN_NAME", "Vietcombank"],
      ["BANK_VN_ACCOUNT_NUMBER", "0123456789"],
    ]);
    expect(buildBankAccounts(partial, KRW).map((a) => a.country)).toEqual(["VN"]);
  });
});

describe("getPublicBankAccounts — 한국·베트남 키를 한 번에 조회", () => {
  it("두 나라 계좌 키를 모두 조회한다", async () => {
    mockFindMany.mockResolvedValue([]);
    await getPublicBankAccounts(KRW);
    const where = mockFindMany.mock.calls[0][0].where.key.in as string[];
    expect(where).toContain("BANK_NAME");
    expect(where).toContain("BANK_VN_NAME");
  });

  it("미설정이면 빈 배열 (섹션 미렌더)", async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await getPublicBankAccounts(VND)).toEqual([]);
  });
});
