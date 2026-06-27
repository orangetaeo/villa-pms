// lib/money-display.ts — 다통화 표시 보조(나이키식 "VND 크게 + ≈₩원화 작게").
//
// ★ ADMIN(canViewFinance) 전용 표시 보조 — 환산값은 현재 FX_VND_PER_KRW 기준 **표시용 근사치**다
//   (정산·저장 금액 아님). 통화 합산(ADR-0003) 금지 원칙은 유지하되, 운영자 한눈 파악용으로
//   통합 환산(VND) 옆에 원화 근사를 병기한다.
import { formatThousands } from "@/lib/format";
import { suggestSalePriceKrw } from "@/lib/pricing";

/**
 * VND 금액을 현재 환율(fxVndPerKrw)로 KRW 근사 환산해 "≈ ₩1,234,567" 문자열로.
 *  - 환율 미설정·0·환산 불가(형식 오류)면 null → 호출부가 ≈₩ 줄을 숨긴다.
 *  - 음수(손실 등)는 부호 보존.
 */
export function krwApproxText(vnd: bigint, fxVndPerKrw: string | null): string | null {
  if (!fxVndPerKrw || vnd === 0n) return null;
  const abs = vnd < 0n ? -vnd : vnd;
  let krw: number;
  try {
    krw = suggestSalePriceKrw(abs, fxVndPerKrw);
  } catch {
    return null;
  }
  return `≈ ₩${formatThousands(vnd < 0n ? -krw : krw)}`;
}
