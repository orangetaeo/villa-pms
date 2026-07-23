import { prisma } from "@/lib/prisma";
import type { Currency } from "@prisma/client";

// 한국(KRW)·베트남(VND) 입금 계좌 키 — 예약/제안 통화에 따라 자동 선택 (운영자 AppSetting).
// done 페이지(BANK_KEY_SETS)와 동일 키 — 공개 입금 안내의 단일 소스.
const BANK_KEY_SETS = {
  KRW: { name: "BANK_NAME", number: "BANK_ACCOUNT_NUMBER", holder: "BANK_ACCOUNT_HOLDER" },
  VND: { name: "BANK_VN_NAME", number: "BANK_VN_ACCOUNT_NUMBER", holder: "BANK_VN_ACCOUNT_HOLDER" },
} as const;

export type PublicBankInfo = { name: string; number: string; holder: string | null };

/** 통화 → 계좌 키 세트 (VND→베트남, 그 외→한국). 테스트용 노출. */
export function bankKeySetFor(currency: Currency) {
  return currency === "VND" ? BANK_KEY_SETS.VND : BANK_KEY_SETS.KRW;
}

/**
 * 제안/예약 통화에 맞는 입금 계좌 조회 — 은행명·번호가 모두 설정됐을 때만 반환, 아니면 null.
 * 공개 정보(고객 입금처)라 누수 무관 — 마진·원가·다른 AppSetting은 조회하지 않는다.
 */
export async function getPublicBankInfo(currency: Currency): Promise<PublicBankInfo | null> {
  const keySet = bankKeySetFor(currency);
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [keySet.name, keySet.number, keySet.holder] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const name = byKey.get(keySet.name);
  const number = byKey.get(keySet.number);
  if (!name || !number) return null; // 은행명·번호 둘 다 있어야 안내 (부분 설정은 미노출)
  return { name, number, holder: byKey.get(keySet.holder) ?? null };
}

// ── 한국·베트남 계좌 동시 안내 ──────────────────────────────────────────────
// 계좌를 하나만 보여주면 고객이 "이게 한국 계좌인가 베트남 계좌인가"를 알 수 없다(실사용 혼선).
// 설정된 계좌를 전부 국가 라벨과 함께 보여주고, 제안 통화에 해당하는 계좌를 맨 앞 + 배지로 강조한다.
export type BankCountry = "KR" | "VN";
export type PublicBankAccount = PublicBankInfo & {
  country: BankCountry;
  /** 이 제안·예약의 결제 통화에 해당하는 계좌인가 (배지·정렬 우선) */
  primary: boolean;
};

const COUNTRY_OF: Record<BankCountry, (typeof BANK_KEY_SETS)[keyof typeof BANK_KEY_SETS]> = {
  KR: BANK_KEY_SETS.KRW,
  VN: BANK_KEY_SETS.VND,
};

/** AppSetting 행 맵 → 국가별 계좌 목록(설정된 것만). 순수 함수 — 테스트용 노출. */
export function buildBankAccounts(
  byKey: Map<string, string>,
  primaryCurrency: Currency
): PublicBankAccount[] {
  // USD처럼 전용 계좌가 없는 통화는 primary 없음 — 아무 계좌나 "이 제안 통화"로 표시하면 오안내다.
  const primaryCountry: BankCountry | null =
    primaryCurrency === "VND" ? "VN" : primaryCurrency === "KRW" ? "KR" : null;
  const accounts = (Object.keys(COUNTRY_OF) as BankCountry[]).flatMap((country) => {
    const keySet = COUNTRY_OF[country];
    const name = byKey.get(keySet.name);
    const number = byKey.get(keySet.number);
    if (!name || !number) return []; // 부분 설정은 미노출 (기존 규칙 유지)
    return [{ country, name, number, holder: byKey.get(keySet.holder) ?? null, primary: country === primaryCountry }];
  });
  // 결제 통화 계좌를 먼저 — 고객이 넣어야 할 계좌가 위에 오도록
  return accounts.sort((a, b) => Number(b.primary) - Number(a.primary));
}

/**
 * 공개 페이지에 노출할 입금 계좌 전체(한국·베트남) 조회.
 * primaryCurrency = 제안·예약 통화. USD처럼 전용 계좌가 없는 통화면 primary 없이 두 계좌만 안내한다.
 */
export async function getPublicBankAccounts(primaryCurrency: Currency): Promise<PublicBankAccount[]> {
  const allKeys = Object.values(BANK_KEY_SETS).flatMap((s) => [s.name, s.number, s.holder]);
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: allKeys } },
    select: { key: true, value: true },
  });
  return buildBankAccounts(new Map(rows.map((r) => [r.key, r.value])), primaryCurrency);
}
