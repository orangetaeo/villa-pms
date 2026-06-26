// /account — 운영자 본인 계정(비밀번호 변경). (admin) layout이 isOperator 보장.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import ChangePasswordForm from "@/components/account/change-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: `${t("title")} — Villa Go` };
}

export default async function AdminAccountPage() {
  const t = await getTranslations("account");
  return (
    <div className="max-w-md">
      <section className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight mb-1">{t("title")}</h1>
        <p className="text-admin-muted text-sm">{t("subtitle")}</p>
      </section>
      <div className="bg-admin-card border border-slate-800 rounded-xl p-6">
        <h2 className="text-base font-bold text-white mb-1">{t("changeTitle")}</h2>
        <p className="text-xs text-slate-400 mb-5">{t("changeSubtitle")}</p>
        <ChangePasswordForm variant="admin" />
      </div>
    </div>
  );
}
