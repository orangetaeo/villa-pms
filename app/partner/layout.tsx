// app/partner/layout.tsx — 파트너(여행사·랜드사) 포털 레이아웃 (ADR-0028 PP3)
//   Role=PARTNER 전용. 파트너는 한국 여행사·랜드사가 다수 → 기본 ko, pref-locale 토글로 vi 지원.
//   가드: 미인증/PARTNER 아님 → /login. 승인 안 됨 → 승인대기/거절 안내(포털 비노출).
//   ★ 누수: 클라이언트엔 partner 네임스페이스만 직렬화(탭바 라벨). 운영(adminXxx)·
//      공급자(earnings 등) 네임스페이스는 클라 payload에 노출하지 않는다.
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { cookies } from "next/headers";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { normalizeLocale, type AppLocale } from "@/lib/locale";
import { getPartnerForUser } from "@/lib/partner-auth";
import { PartnerTabBar } from "@/components/partner/partner-tab-bar";

// 파트너 포털 유효 locale: 사용자 명시 선택(pref-locale) > 계정 기본(session) > ko 기본(한국 여행사·랜드사).
// (i18n/request.ts가 읽는 `locale` 쿠키는 middleware가 같은 우선순위로 맞춘다.)
async function getPartnerLocale(sessionLocale?: string | null): Promise<AppLocale> {
  const pref = (await cookies()).get("pref-locale")?.value;
  if (pref === "ko" || pref === "vi") return pref;
  return normalizeLocale(sessionLocale, "ko");
}

export default async function PartnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // 파트너 전용 — 운영자·공급자·VENDOR·게스트 접근 차단
  if (session.user.role !== "PARTNER") redirect("/login");

  const locale = await getPartnerLocale(session.user.locale);
  const partner = await getPartnerForUser(session.user.id);

  // 승인 게이트 — 미연결(파트너 엔티티 없음)도 대기 취급(포털 비노출).
  if (!partner || partner.approvalStatus !== "APPROVED") {
    return (
      <PartnerShell locale={locale} partnerName={partner?.name ?? null}>
        <ApprovalGate
          status={partner?.approvalStatus ?? "PENDING_APPROVAL"}
          rejectionReason={partner?.rejectionReason ?? null}
        />
      </PartnerShell>
    );
  }

  return (
    <PartnerShell locale={locale} partnerName={partner.name} showNav>
      {children}
    </PartnerShell>
  );
}

// 라이트·모바일우선 셸 — 상단 헤더(마크+워드마크+파트너사명) + (선택)탭 내비.
async function PartnerShell({
  locale,
  partnerName,
  showNav = false,
  children,
}: {
  locale: AppLocale;
  partnerName: string | null;
  showNav?: boolean;
  children: React.ReactNode;
}) {
  // 클라이언트(PartnerTabBar)는 partner 네임스페이스만 사용 — 그것만 직렬화(누수 차단).
  const allMessages = (await import(`../../messages/${locale}.json`)).default;
  const clientMessages: AbstractIntlMessages = {
    partner: (allMessages as Record<string, unknown>).partner as AbstractIntlMessages,
  };
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <NextIntlClientProvider locale={locale} messages={clientMessages}>
        {/* 헤더 */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-neutral-100 bg-white/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <VillaGoMark className="h-7 w-7" />
            <VillaGoWordmark className="text-lg" />
            {partnerName && (
              <span className="ml-1 max-w-[40vw] truncate text-sm font-medium text-neutral-500">
                · {partnerName}
              </span>
            )}
          </div>
          <LocaleSwitcher current={locale} persist />
        </header>

        <main className="mx-auto max-w-md px-4 py-6 pb-24">{children}</main>

        {showNav && <PartnerTabBar />}
      </NextIntlClientProvider>
    </div>
  );
}

// 승인대기·거절 안내 — vendor ApprovalGate 톤 재사용. partner 네임스페이스(서버 번역).
async function ApprovalGate({
  status,
  rejectionReason,
}: {
  status: string;
  rejectionReason: string | null;
}) {
  const t = await getTranslations("partner.approvalGate");
  const rejected = status === "REJECTED";

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div
        className={`mb-6 flex h-20 w-20 items-center justify-center rounded-full ${
          rejected ? "bg-rose-50" : "bg-amber-50"
        }`}
      >
        <span
          className={`material-symbols-outlined text-5xl [font-variation-settings:'FILL'_1] ${
            rejected ? "text-rose-500" : "text-amber-500"
          }`}
        >
          {rejected ? "cancel" : "hourglass_top"}
        </span>
      </div>
      <h1 className="text-2xl font-bold text-neutral-900">
        {rejected ? t("rejectedTitle") : t("pendingTitle")}
      </h1>
      <p className="mt-3 max-w-sm leading-relaxed text-neutral-500">
        {rejected ? t("rejectedBody") : t("pendingBody")}
      </p>

      {rejected && rejectionReason && (
        <div className="mt-5 w-full rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-left">
          <p className="text-[11px] font-bold uppercase tracking-wider text-rose-400">
            {t("rejectedReasonLabel")}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-rose-700">
            {rejectionReason}
          </p>
        </div>
      )}

      <Link
        href="/profile"
        className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 active:scale-95"
      >
        <span className="material-symbols-outlined text-[18px]">lock</span>
        {t("changePassword")}
      </Link>
    </div>
  );
}
