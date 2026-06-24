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
