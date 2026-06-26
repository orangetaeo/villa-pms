// /vendor/profile — 원천 공급자 비밀번호 변경 (ADR-0023 S3 §6).
//   임시 비번으로 로그인한 공급자가 첫 진입하는 화면(미들웨어가 mustChangePassword 시 여기로).
//   빌라 공급자 /profile 미러 — ChangePasswordForm(variant="supplier") + /api/account/password 재사용.
//   변경 성공 시 폼이 signOut→/login (재로그인하면 게이트 풀려 /vendor 진입).
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import ChangePasswordForm from "@/components/account/change-password-form";

export const metadata: Metadata = {
  title: "Tài khoản — Villa Go",
};

export default async function VendorProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "VENDOR") redirect("/login");

  const locale = await getSupplierLocale(session.user.locale);
  const tAcc = await getTranslations({ locale, namespace: "account" });
  const tVendor = await getTranslations({ locale, namespace: "vendor" });
  const mustChange = session.user.mustChangePassword === true;

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-16 pt-16">
      {/* 강제변경 사용자는 뒤로가기 숨김(먼저 변경해야 함) */}
      {!mustChange && (
        <Link
          href="/vendor"
          className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-800"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {tAcc("back")}
        </Link>
      )}

      <section className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">{tAcc("title")}</h1>
        <p className="text-sm text-neutral-500">{tAcc("subtitle")}</p>
      </section>

      {/* 첫 진입(임시 비번) 안내 */}
      {mustChange && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <span className="material-symbols-outlined text-amber-500">info</span>
          <p className="text-sm font-medium text-amber-800">{tVendor("firstLoginNotice")}</p>
        </div>
      )}

      <div className="rounded-2xl border border-neutral-100 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-bold text-neutral-900">{tAcc("changeTitle")}</h2>
        <p className="mb-5 text-sm text-neutral-500">{tAcc("changeSubtitle")}</p>
        <ChangePasswordForm variant="supplier" />
      </div>
    </div>
  );
}
