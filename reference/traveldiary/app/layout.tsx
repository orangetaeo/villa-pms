// [SHARED-MODULE] from traveldiary-mvp app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://traveldiary-mvp-production.up.railway.app";

export const metadata: Metadata = {
  title: {
    default: "TRAVELDIARY — 베트남 자유여행 AI 동반자",
    template: "%s — TRAVELDIARY",
  },
  description: "AI가 추천한 일정에 근거까지. 베트남 6개 도시 완전 지원. 여행 중에는 살아 움직여요.",
  metadataBase: new URL(APP_URL),
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "TRAVELDIARY",
    title: "TRAVELDIARY — 베트남 자유여행 AI 동반자",
    description: "AI가 추천한 일정에 근거까지. 베트남 6개 도시 완전 지원.",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "TravelDiary" }],
  },
  twitter: {
    card: "summary",
    title: "TRAVELDIARY — 베트남 자유여행 AI 동반자",
    description: "AI가 추천한 일정에 근거까지. 베트남 6개 도시 완전 지원.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TravelDiary",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // L1: Lighthouse a11y — maximumScale=1 + userScalable=false 페널티 제거
  viewportFit: "cover", // safe-area-inset 활성화 (iPhone notch/home indicator)
  themeColor: "#F8FAFC",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* Agoda Partner 사이트 소유권 검증 — partners.agoda.com 매뉴얼 검증 단계 */}
        <meta name="agd-partner-manual-verification" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* L1: preconnect — 폰트 CDN 사전 연결 (LCP 개선) */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* DNS prefetch — 외부 API 사전 해석 */}
        <link rel="dns-prefetch" href="https://maps.googleapis.com" />
        <link rel="dns-prefetch" href="https://openapi.naver.com" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body>
        <div className="mobile-container">
          {children}
        </div>
        <InstallPrompt />
        <script
          dangerouslySetInnerHTML={{
            __html: `if("serviceWorker"in navigator){window.addEventListener("load",()=>{navigator.serviceWorker.register("/sw.js")})}`,
          }}
        />
      </body>
    </html>
  );
}
