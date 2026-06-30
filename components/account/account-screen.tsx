// 라이트 포털 공용 계정(회원정보) 화면 셸 — SUPPLIER·CLEANER·VENDOR·PARTNER 공통.
//   구성: (선택)뒤로가기 · 제목 · (슬롯)안내 · 비밀번호 변경 카드 · (슬롯)역할별 확장 · 계정/로그아웃.
//   i18n는 `account.*` 단일 네임스페이스(중복 키 vendor.accountSection.* 폐지).
//   로그아웃은 NextAuth signOut 서버 액션(완료 후 /login). 비번변경 폼(ChangePasswordForm)은 클라이언트.
//   ★ 누수: 본인 로그인명·본인 지급정보(extra)만 노출 — 운영자 마진·판매가와 무관.
import type { ReactNode } from "react";
import Link from "next/link";
import { signOut } from "@/auth";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/lib/locale";
import ChangePasswordForm from "@/components/account/change-password-form";

export default async function AccountScreen({
  locale,
  loggedInName,
  backHref,
  notice,
  extra,
  containerClassName = "mx-auto w-full max-w-md px-4 pt-6 pb-28",
}: {
  locale: AppLocale;
  loggedInName: string;
  /** 뒤로가기 목적지. null/undefined면 뒤로가기 링크 숨김(예: 강제 비번변경 진입). */
  backHref?: string | null;
  /** 비번변경 카드 위에 노출할 안내 슬롯(예: 임시 비번 첫 진입 안내). */
  notice?: ReactNode;
  /** 비번변경 카드 아래에 노출할 역할별 확장 슬롯(예: 원천공급자 지급정보 폼). */
  extra?: ReactNode;
  containerClassName?: string;
}) {
  const t = await getTranslations({ locale, namespace: "account" });

  return (
    <div className={containerClassName}>
      {/* 뒤로 — 각 포털 홈으로. (공급자/청소는 "/" 루트 분기, 벤더 "/vendor", 파트너 "/partner") */}
      {backHref && (
        <Link
          href={backHref}
          className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-800"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {t("back")}
        </Link>
      )}

      <section className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">{t("title")}</h1>
        <p className="text-sm text-neutral-500">{t("subtitle")}</p>
      </section>

      {notice}

      <div className="rounded-2xl border border-neutral-100 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-bold text-neutral-900">{t("changeTitle")}</h2>
        <p className="mb-5 text-sm text-neutral-500">{t("changeSubtitle")}</p>
        <ChangePasswordForm variant="supplier" />
      </div>

      {extra}

      {/* 계정 — 로그인 정보 + 로그아웃 (signOut 서버 액션, 완료 후 /login).
          모든 라이트 역할이 공용으로 도달하는 화면 — 이 버튼이 유일한 로그아웃 경로가 되는
          역할(특히 CLEANER: 탭바에 안내 없음, 강제 비번변경 중인 VENDOR)이 있으므로 항상 노출. */}
      <section className="mt-6 rounded-2xl border border-neutral-100 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          {t("sectionTitle")}
        </h2>
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3 text-sm text-neutral-600">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100">
              <span className="material-symbols-outlined text-neutral-500">person</span>
            </span>
            <span className="truncate">{t("loggedInAs", { name: loggedInName })}</span>
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 active:scale-95"
            >
              <span className="material-symbols-outlined text-lg">logout</span>
              {t("logout")}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
