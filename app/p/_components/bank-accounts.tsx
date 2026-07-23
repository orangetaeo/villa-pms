import type { PublicLang } from "@/lib/public-i18n";
import { PUBLIC_LABELS } from "@/lib/public-i18n";
import type { PublicBankAccount } from "./public-bank";
import { CopyButton } from "./copy-button";

/**
 * 입금 계좌 안내 — 한국·베트남 계좌를 **국가 라벨과 함께** 나열한다 (제안 페이지·가예약 완료 페이지 공용).
 * ★ 계좌를 하나만 보여주면 고객이 어느 나라 계좌인지 몰라 잘못 송금한다(실사용 혼선). 라벨은 필수.
 * 결제 통화 계좌(primary)는 맨 위 + 배지로 강조하되, 다른 나라 계좌도 함께 보여 선택지를 남긴다.
 */
export function BankAccountsSection({
  accounts,
  lang,
  labels,
  tone = "neutral",
  footer,
}: {
  accounts: PublicBankAccount[];
  lang: PublicLang;
  /** 섹션 문구 — 페이지별 사전(proposal / donePage)에서 주입 */
  labels: { label: string; title: string; name: string; number: string; holder: string; note?: string };
  /** 카드 색조 — 제안 페이지(neutral) / 완료 페이지(slate) */
  tone?: "neutral" | "slate";
  /** 계좌 목록 아래 추가 영역 — 완료 페이지의 "입금 금액" 행 */
  footer?: React.ReactNode;
}) {
  if (accounts.length === 0) return null;
  const t = PUBLIC_LABELS[lang];
  const muted = tone === "slate" ? "text-slate-500" : "text-neutral-500";
  const divider = tone === "slate" ? "border-slate-100" : "border-neutral-50";

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-neutral-100 p-6 space-y-5">
      <div className="space-y-1">
        <p className="text-xs font-bold text-teal-600 tracking-wider">{labels.label}</p>
        <h4 className="text-base font-bold">{labels.title}</h4>
      </div>

      {accounts.map((acc) => (
        <div
          key={acc.country}
          className={`rounded-xl border p-4 space-y-3 ${
            acc.primary ? "border-teal-200 bg-teal-50/40" : "border-neutral-100"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">{t.bankCountry[acc.country]}</p>
            {acc.primary && (
              <span className="text-[10px] font-bold bg-teal-600 text-white px-2 py-0.5 rounded-full shrink-0">
                {t.bankPrimaryBadge}
              </span>
            )}
          </div>
          <div className="space-y-3">
            <div className={`flex justify-between items-center text-sm border-b ${divider} pb-3`}>
              <span className={muted}>{labels.name}</span>
              <span className="font-semibold">{acc.name}</span>
            </div>
            <div
              className={`flex justify-between items-center text-sm ${acc.holder ? `border-b ${divider} pb-3` : ""}`}
            >
              <span className={muted}>{labels.number}</span>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{acc.number}</span>
                <CopyButton text={acc.number} lang={lang} />
              </div>
            </div>
            {acc.holder && (
              <div className="flex justify-between items-center text-sm">
                <span className={muted}>{labels.holder}</span>
                <span className="font-semibold">{acc.holder}</span>
              </div>
            )}
          </div>
        </div>
      ))}

      {footer}

      {labels.note && <p className="text-xs text-neutral-400 leading-relaxed">{labels.note}</p>}
    </section>
  );
}
