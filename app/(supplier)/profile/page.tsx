// /account — 공급자 본인 계정(비밀번호 변경). vi 기본, 모바일 라이트 UI.
// (supplier) layout이 로그인 보장. 임시 비번으로 로그인한 공급자가 직접 변경하는 화면.
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
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
      <Link
        href="/my-villas"
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
    </div>
  );
}
