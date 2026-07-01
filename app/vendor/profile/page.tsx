// /vendor/profile — 원천 공급자(VENDOR) 계정(비번변경 + 지급정보 + 로그아웃) (ADR-0023 S3 §6).
//   임시 비번으로 로그인한 공급자가 첫 진입하는 화면(미들웨어가 mustChangePassword 시 여기로).
//   공용 AccountScreen 셸 사용(SUPPLIER/PARTNER와 동일 구조) + VENDOR 전용 슬롯(지급정보·강제변경 안내).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import AccountScreen from "@/components/account/account-screen";
import VendorPayoutForm from "@/components/vendor/vendor-payout-form";

export const metadata: Metadata = {
  title: "Tài khoản — Villa Go",
};

export default async function VendorProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "VENDOR") redirect("/login");

  const locale = await getSupplierLocale(session.user.locale);
  const tVendor = await getTranslations({ locale, namespace: "vendor" });
  const mustChange = session.user.mustChangePassword === true;

  return (
    <AccountScreen
      locale={locale}
      loggedInName={session.user.name ?? ""}
      // 강제변경 사용자는 뒤로가기 숨김(먼저 변경해야 함)
      backHref={mustChange ? null : "/vendor"}
      containerClassName="mx-auto w-full max-w-md px-4 pb-16 pt-6"
      // 첫 진입(임시 비번) 안내
      notice={
        mustChange ? (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <span className="material-symbols-outlined text-amber-500">info</span>
            <p className="text-sm font-medium text-amber-800">{tVendor("firstLoginNotice")}</p>
          </div>
        ) : null
      }
      // 지급 정보 자기관리 — 은행명·계좌번호·예금주·연락처(본인 vendorId 스코프, 마진·판매가 무관).
      // 강제 비번변경 사용자에게는 숨김(먼저 비번부터 변경).
      extra={
        mustChange ? null : (
          <div className="mt-6 rounded-2xl border border-neutral-100 bg-white p-6 shadow-sm">
            <h2 className="mb-1 text-lg font-bold text-neutral-900">{tVendor("payout.title")}</h2>
            <p className="mb-5 text-sm text-neutral-500">{tVendor("payout.subtitle")}</p>
            <VendorPayoutForm />
          </div>
        )
      }
    />
  );
}
