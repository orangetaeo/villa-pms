// 공급자 온보딩 가이드 (T4.3, SPEC F0) — design/stitch/a-guide 변환 (라이트 teal, vi, 390px)
// 정적 안내 화면: 판매가·마진·재고 데이터를 일절 참조하지 않음 (QA leak-checklist 자명 통과).
// 하단 진입은 공통 TabBar(고정)가 담당하므로, 디자인의 pinned 버튼은 본문 인라인 CTA로 변환(이중 하단바 방지).
import type { Metadata } from "next";
import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Hướng dẫn — Villa Go",
};

// 4개 핵심 기능 → 각 기능 화면으로 이동(탭하면 바로 시작 가능). 아이콘은 material-symbols.
const STEPS = [
  { icon: "add_home_work", href: "/my-villas/new", titleKey: "step1Title", descKey: "step1Desc" },
  { icon: "calendar_month", href: "/calendar", titleKey: "step2Title", descKey: "step2Desc" },
  { icon: "cleaning_services", href: "/cleaning", titleKey: "step3Title", descKey: "step3Desc" },
  { icon: "notifications_active", href: "/zalo-connect", titleKey: "step4Title", descKey: "step4Desc" },
] as const;

export default async function GuidePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  // [QA D-3] 명시 locale은 메시지 번들을 바꾸지 못함 — 실제 렌더 locale은 미들웨어 locale 쿠키가 결정
  // (T-i18n-supplier-ko-toggle: pref-locale>계정>vi 우선순위). earnings 패턴
  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "guide" });

  return (
    <div className="min-h-screen bg-neutral-50 text-slate-900">
      {/* 헤더 — 탭 진입 화면이므로 뒤로가기 없이 제목만 (디자인 a-guide 헤더 간소화) */}
      <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-center border-b border-neutral-100 bg-white px-4">
        <h1 className="font-semibold text-lg text-teal-600">{t("headerTitle")}</h1>
      </header>

      <main className="px-5 pt-8 pb-28">
        {/* 히어로 */}
        <div className="mb-10 text-center">
          <h2 className="mb-2 text-3xl font-extrabold tracking-tight text-teal-600">
            {t("heroTitle")}
          </h2>
          <p className="font-medium text-slate-500">{t("heroSubtitle")}</p>
        </div>

        {/* 4단계 가이드 카드 — 탭하면 해당 기능으로 이동 */}
        <ol className="space-y-6">
          {STEPS.map((step, i) => (
            <li key={step.href}>
              <Link
                href={step.href}
                className="relative flex items-start gap-4 rounded-xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(13,148,136,0.05)] transition-transform active:scale-[0.98]"
              >
                <span className="absolute -left-2 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 font-bold text-white shadow-[0_2px_8px_rgba(13,148,136,0.2)]">
                  {i + 1}
                </span>
                <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-teal-50">
                  <span className="material-symbols-outlined text-3xl text-teal-600">{step.icon}</span>
                </span>
                <span className="block">
                  <span className="block text-lg font-bold leading-tight text-slate-800">
                    {t(step.titleKey)}
                  </span>
                  <span className="mt-1 block text-sm text-slate-500">{t(step.descKey)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>

        {/* 인라인 CTA (디자인의 하단 pinned 버튼 → 본문 끝으로, TabBar와 겹치지 않게) */}
        <div className="mt-10 flex flex-col gap-2">
          <Link
            href="/my-villas"
            className="flex h-14 w-full items-center justify-center rounded-xl bg-teal-600 px-6 text-lg font-medium text-white transition-all active:scale-[0.98]"
          >
            <span className="material-symbols-outlined mr-2">play_circle</span>
            {t("ctaStart")}
          </Link>
          <Link
            href="/zalo-connect"
            className="flex flex-col items-center justify-center py-2 text-sm font-medium text-teal-600 transition-all active:scale-[0.98]"
          >
            <span className="material-symbols-outlined mb-0.5 text-2xl">chat</span>
            {t("ctaZalo")}
          </Link>
        </div>

        {/* 계정 — 로그인 정보 + 로그아웃 (NextAuth signOut 서버 액션, 완료 후 /login) */}
        <section className="mt-12 border-t border-slate-100 pt-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t("accountTitle")}
          </h3>
          <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-4">
            <span className="flex items-center gap-3 text-sm text-slate-600">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                <span className="material-symbols-outlined text-slate-500">person</span>
              </span>
              {t("loggedInAs", { name: session.user.name ?? "" })}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 active:scale-95"
              >
                <span className="material-symbols-outlined text-lg">logout</span>
                {t("logout")}
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}
