import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Villa PMS",
  description: "푸꾸옥 빌라 임대 관리 시스템",
  applicationName: "Villa PMS",
  // PWA: app/manifest.ts·icon.svg·apple-icon.tsx는 Next가 자동 링크.
  // iOS 홈화면 설치 시 전체화면(앱처럼) + 상태바 스타일.
  appleWebApp: {
    capable: true,
    title: "Villa PMS",
    statusBarStyle: "default",
  },
};

// PWA viewport — 모바일 상태바 teal(브랜드), safe-area(노치/홈바) 대응.
// 디자인의 safe-bottom(env safe-area-inset)과 정합하려면 viewportFit cover 필요.
export const viewport: Viewport = {
  themeColor: "#0D9488",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 접근성·SEO: 현재 locale 쿠키(미들웨어가 설정)를 <html lang>에 반영. 기본 vi
  const cookieLocale = (await cookies()).get("locale")?.value;
  const lang = cookieLocale === "ko" ? "ko" : "vi";
  return (
    <html lang={lang}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700;800&family=Public+Sans:wght@400;500;600;700;800&family=Noto+Sans+KR:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* [QA D-2b] 전체 messages 직렬화 금지 — admin 라벨(마진·판매가)이 모든 화면
            (공급자·공개 제안 페이지 포함) HTML에 노출됐던 누수 경로.
            locale 컨텍스트만 유지(서버에서 자동 상속)하고 messages는 비움.
            클라이언트 useTranslations가 필요한 구역은 각 구역 레이아웃에서
            화이트리스트 provider로 공급: (admin)/layout.tsx, (supplier)/layout.tsx */}
        <NextIntlClientProvider messages={{}}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
