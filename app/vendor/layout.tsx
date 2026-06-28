// app/vendor/layout.tsx — 원천 공급자(ServiceVendor) 대시보드 레이아웃 (ADR-0023 S3 §6)
//   Role=VENDOR 전용, vi 기본·라이트·모바일. 빌라 공급자 layout 미러.
//   ★ 누수: pickMessages 화이트리스트로 vendor·account 네임스페이스만 클라 직렬화.
//      adminXxx(판매가·마진 라벨) RSC payload 노출 금지.
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";
import VendorNotificationBell from "@/components/vendor/vendor-notification-bell";
import { getSupplierLocale } from "@/lib/locale";

// VENDOR 클라이언트 컴포넌트가 useTranslations로 실제 사용하는 네임스페이스만 직렬화.
// - vendor: 발주함/예약현황/정산/응답 시트 (vendor 화면 전용)
// - account: 비밀번호 변경 폼(ChangePasswordForm "account" 네임스페이스 재사용)
// - pagination: 목록 화면의 공용 PaginationBar(useTranslations("pagination")). 누락 시 라벨이 raw 키로 깨짐.
// - vendorNotif: 인앱 알림센터 벨·시트(VendorNotificationBell). 누락 시 라벨이 raw 키로 깨짐.
// 운영자(adminXxx)·빌라공급자(earnings 등) 네임스페이스는 직렬화하지 않는다(누수 방지).
const VENDOR_CLIENT_NAMESPACES = ["vendor", "account", "pagination", "vendorNotif"] as const;

function pickMessages(all: AbstractIntlMessages): AbstractIntlMessages {
  const picked: AbstractIntlMessages = {};
  for (const ns of VENDOR_CLIENT_NAMESPACES) {
    if (all[ns] !== undefined) picked[ns] = all[ns];
  }
  return picked;
}

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // 원천 공급자 전용 — 운영자·빌라공급자·게스트 접근 차단
  if (session.user.role !== "VENDOR") redirect("/login");

  // vi 기본(빌라 공급자와 동일 우선순위: pref-locale > 계정 기본 > vi)
  const locale = await getSupplierLocale(session.user.locale);
  const allMessages = (await import(`../../messages/${locale}.json`)).default;
  const messages = pickMessages(allMessages);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <NextIntlClientProvider locale={locale} messages={messages}>
        {/* 상단 우측 고정 클러스터 — 알림 벨 + 언어 전환.
            LocaleSwitcher가 자체 `fixed right-3 top-3`이라 벨은 그 왼쪽(right-20)에 고정해 겹침 방지.
            페이지들은 pt-16으로 이 영역 아래에서 시작(레이아웃 흐름 비침범). */}
        <div className="fixed right-20 top-3 z-[60]">
          <VendorNotificationBell />
        </div>
        <LocaleSwitcher current={locale} persist />
        <main>{children}</main>
      </NextIntlClientProvider>
    </div>
  );
}
