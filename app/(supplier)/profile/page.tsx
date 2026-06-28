// /account — 공급자 본인 계정(비밀번호 변경). vi 기본, 모바일 라이트 UI.
// (supplier) layout이 로그인 보장. 임시 비번으로 로그인한 공급자가 직접 변경하는 화면.
import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import ChangePasswordForm from "@/components/account/change-password-form";

export const metadata: Metadata = {
  title: "Tài khoản",
};

export default async function SupplierAccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "account" });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-28">
      {/* 뒤로 — 역할별 홈으로 라우팅하는 루트("/")로(공급자=/my-villas·청소자=/cleaning 등).
          /my-villas 고정 시 CLEANER가 /login 루프에 빠지므로 루트 분기 사용. */}
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-800"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        {t("back")}
      </Link>

      <section className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">{t("title")}</h1>
        <p className="text-sm text-neutral-500">{t("subtitle")}</p>
      </section>

      <div className="rounded-2xl border border-neutral-100 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-bold text-neutral-900">{t("changeTitle")}</h2>
        <p className="mb-5 text-sm text-neutral-500">{t("changeSubtitle")}</p>
        <ChangePasswordForm variant="supplier" />
      </div>

      {/* 계정 — 로그인 정보 + 로그아웃 (NextAuth signOut 서버 액션, 완료 후 /login).
          공급자·청소자(CLEANER)·비번변경 중인 파트너가 공용으로 도달하는 화면 — 이 버튼이
          유일한 로그아웃 경로가 되는 역할(특히 CLEANER: 탭바에 안내 없음)이 있으므로 항상 노출. */}
      <section className="mt-6 rounded-2xl border border-neutral-100 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          {t("sectionTitle")}
        </h2>
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3 text-sm text-neutral-600">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100">
              <span className="material-symbols-outlined text-neutral-500">person</span>
            </span>
            <span className="truncate">
              {t("loggedInAs", { name: session.user.name ?? "" })}
            </span>
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
