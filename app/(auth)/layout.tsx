import { LocaleSwitcher } from "@/components/locale-switcher";
import { getSupplierLocale } from "@/lib/locale";
import WebchatMount from "@/components/webchat-mount";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // 인증 화면 유효 locale: 사용자 선택(pref-locale) > vi 기본 (비로그인 — 계정 locale 없음)
  const locale = await getSupplierLocale(null);
  return (
    <div className="bg-slate-50 text-slate-900 min-h-screen flex flex-col">
      {/* iOS 투명 상태바(black-translucent) 아래 라이트 배경이 오면 흰 상태바 글자가 안 보인다.
          최상단 safe-area만 브랜드 teal로 채워 가독성 확보(데스크톱·안드로이드 safe=0이면 0높이). */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[55] h-safe-top bg-teal-600"
      />
      {/* 우측 상단 언어 전환 — 비로그인 화면이라 DB 영속(persist) 없이 쿠키만 */}
      <LocaleSwitcher current={locale} />
      {children}
      {/* 웹챗 위젯 — 로그인·가입·비번찾기 8화면 공통. sourcePage="auth"(계약 §B).
          하단 고정 CTA 없음 → offset 미지정. iframe 안이라 스플래시 게이트와 무관. */}
      <WebchatMount page="auth" />
    </div>
  );
}
