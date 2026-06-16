import { LocaleSwitcher } from "@/components/locale-switcher";
import { getSupplierLocale } from "@/lib/locale";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // 인증 화면 유효 locale: 사용자 선택(pref-locale) > vi 기본 (비로그인 — 계정 locale 없음)
  const locale = await getSupplierLocale(null);
  return (
    <div className="bg-slate-50 text-slate-900 min-h-screen flex flex-col">
      {/* 우측 상단 언어 전환 — 비로그인 화면이라 DB 영속(persist) 없이 쿠키만 */}
      <LocaleSwitcher current={locale} />
      {children}
    </div>
  );
}
