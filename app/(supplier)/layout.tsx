import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";

export default async function SupplierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  // 공급자 라우트는 사용자 locale(기본 vi) 메시지를 중첩 제공
  // (i18n/request.ts는 cookie 기반·기본 ko — 수정 금지 구역이라 여기서 우회)
  const locale = session.user.locale === "ko" ? "ko" : "vi";
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <NextIntlClientProvider locale={locale} messages={messages}>
        {/* TODO(a6 태스크): 모바일 하단 탭바 추가 */}
        <main>{children}</main>
      </NextIntlClientProvider>
    </div>
  );
}
