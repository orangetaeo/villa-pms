// SUPPLIER 정산서 목록 (T-supplier-settlement-list, SPEC F6) — design/stitch/a8-my-settlements 변환 (라이트 teal, vi, 390px)
// 마진 비공개 원칙: select는 id·yearMonth·status·totalVnd·paidAt·statementUrl만 —
// 판매가(KRW/VND)·마진·고객명·고객 연락처는 조회 자체를 하지 않는다.
// PDF는 기존 GET /api/settlements/[id]/statement 가 소유 공급자에게만 서빙(생성기가 원가 VND만 보장).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { SettlementStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** 공급자 VND 점 구분 표기 (15.000.000₫, DESIGN.md — ADMIN 쉼표와 다름). BigInt 문자열 정규식 — Number() 금지 */
function formatVndDot(value: bigint): string {
  const raw = value.toString();
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped}₫`;
}

export const metadata: Metadata = {
  title: "Bảng quyết toán — Villa Go",
};

export default async function SupplierSettlementsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  // 실제 렌더 locale은 미들웨어가 설정하는 locale 쿠키가 결정(earnings/page.tsx QA D-3 주석 참조).
  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "supplierSettlements" });

  // 자기 정산만 — supplierId = 세션 사용자 강제. DRAFT(내부 초안)는 공급자 비노출 → CONFIRMED 이상만.
  // 마진 비공개: 원가 VND 합계(totalVnd)·상태·월·PDF 링크만 select (판매가·마진·KRW·고객 필드 비조회).
  const settlements = await prisma.settlement.findMany({
    where: {
      supplierId: session.user.id,
      status: { not: SettlementStatus.DRAFT },
    },
    orderBy: { yearMonth: "desc" },
    select: {
      id: true,
      yearMonth: true,
      status: true,
      totalVnd: true,
      paidAt: true,
      statementUrl: true,
    },
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top AppBar (a8) — 뒤로가기(=/earnings 진입) + 제목 */}
      <nav className="sticky top-0 z-50 w-full bg-white shadow-sm">
        <div className="mx-auto flex h-16 w-full max-w-md items-center gap-1 px-2">
          <Link
            href="/earnings"
            aria-label={t("back")}
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition-all active:scale-90 active:bg-slate-100"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </Link>
          <h1 className="whitespace-nowrap text-lg font-bold text-slate-900">{t("title")}</h1>
        </div>
      </nav>

      <main className="mx-auto max-w-md space-y-4 px-4 py-6">
        <p className="px-1 text-sm font-medium text-slate-500">{t("subtitle")}</p>

        {settlements.length === 0 ? (
          /* 빈 상태 (a8 Empty state) */
          <section className="mt-2 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-50">
              <span className="material-symbols-outlined text-[36px] text-slate-300">
                receipt_long
              </span>
            </div>
            <p className="font-bold text-slate-700">{t("empty")}</p>
            <p className="text-sm leading-relaxed text-slate-400">{t("emptyHint")}</p>
          </section>
        ) : (
          <div className="space-y-4">
            {settlements.map((s) => {
              const isPaid = s.status === SettlementStatus.PAID;
              const monthNum = Number(s.yearMonth.slice(5, 7));
              const yearNum = Number(s.yearMonth.slice(0, 4));
              const hasPdf = Boolean(s.statementUrl);
              return (
                <section
                  key={s.id}
                  className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0 space-y-2">
                      <h2 className="whitespace-nowrap text-base font-bold text-slate-900">
                        {t("monthLabel", { month: monthNum, year: yearNum })}
                      </h2>
                      {isPaid ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                          <span
                            className="material-symbols-outlined text-[14px] [font-variation-settings:'FILL'_1]"
                          >
                            check_circle
                          </span>
                          {t("statusPaid")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                          <span
                            className="material-symbols-outlined text-[14px] [font-variation-settings:'FILL'_1]"
                          >
                            schedule
                          </span>
                          {t("statusPending")}
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        {t("totalLabel")}
                      </p>
                      <p className="whitespace-nowrap text-xl font-extrabold tracking-tight text-teal-700">
                        {formatVndDot(s.totalVnd)}
                      </p>
                    </div>
                  </div>
                  <div className="px-4 pb-4">
                    {hasPdf ? (
                      <a
                        href={`/api/settlements/${s.id}/statement`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("viewPdfAria", { month: monthNum, year: yearNum })}
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-teal-600 text-sm font-bold text-teal-700 transition-all active:scale-[0.98] active:bg-teal-50"
                      >
                        <span className="material-symbols-outlined text-[20px]">picture_as_pdf</span>
                        {t("viewPdf")}
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 text-sm font-bold text-slate-400"
                      >
                        <span className="material-symbols-outlined text-[20px]">hourglass_empty</span>
                        {t("pdfPreparing")}
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
