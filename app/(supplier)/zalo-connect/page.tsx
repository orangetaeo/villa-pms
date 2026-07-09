// /zalo-connect — 공급자·청소직원 Zalo 연결 온보딩 (T3.7 UI, Stitch a0-zalo-connect 변환)
// RSC, vi 라이트, 모바일. 탭바 숨김(풀스크린 플로우).
// 본문은 공용 ZaloConnectScreen(components/zalo-connect)로 추출 — VENDOR·PARTNER 포털이 래퍼로 재사용.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ZaloConnectScreen } from "@/components/zalo-connect/zalo-connect-screen";

export const metadata: Metadata = {
  title: "Kết nối Zalo — Villa Go",
};

export default async function ZaloConnectPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // 공급자·청소직원 모두 Zalo 알림 수신 대상 → 둘 다 허용. (VENDOR·PARTNER는 각 포털 래퍼 라우트)
  const role = session.user.role;
  if (role !== "SUPPLIER" && role !== "CLEANER") redirect("/login");

  // 청소직원은 베트남어 고정(한국어 미노출·요청 locale 무시). 공급자는 요청 locale 사용(locale 미지정).
  // 완료/스킵 후 역할별 홈 — 청소직원은 /my-villas 접근 불가라 /cleaning으로.
  return (
    <ZaloConnectScreen
      userId={session.user.id}
      locale={role === "CLEANER" ? "vi" : undefined}
      doneHref={role === "CLEANER" ? "/cleaning" : "/my-villas"}
    />
  );
}
