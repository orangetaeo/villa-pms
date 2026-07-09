// /vendor/zalo-connect — 원천 공급자(VENDOR) Zalo 알림 연결 온보딩.
//   공용 ZaloConnectScreen 재사용(공급자 화면과 동일 UI). role VENDOR 전용, 완료→/vendor.
//   locale은 vendor 포털 규칙(getSupplierLocale: pref-locale > 계정 기본 > vi) 그대로.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSupplierLocale } from "@/lib/locale";
import { ZaloConnectScreen } from "@/components/zalo-connect/zalo-connect-screen";

export const metadata: Metadata = {
  title: "Kết nối Zalo — Villa Go",
};

export default async function VendorZaloConnectPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // 원천 공급자 전용 — 타 역할은 각자 홈으로(레이아웃 가드와 동일 톤). 미들웨어/레이아웃 뒤 방어선.
  if (session.user.role !== "VENDOR") redirect("/login");

  const locale = await getSupplierLocale(session.user.locale);
  return <ZaloConnectScreen userId={session.user.id} locale={locale} doneHref="/vendor" />;
}
