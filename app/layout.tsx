import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import "./globals.css";

export const metadata: Metadata = {
  title: "Villa PMS",
  description: "푸꾸옥 빌라 임대 관리 시스템",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
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
