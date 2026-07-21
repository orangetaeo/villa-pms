import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { cookies } from "next/headers";
import "./globals.css";
import SplashIntro from "@/components/splash-intro";

// T-splash-intro — 페인트 전 동기 게이트: sessionStorage(세션당 1회)·reduced-motion·
// 제외경로(/p·/g) 판정 후 html[data-splash]를 세팅한다(스플래시 표시는 CSS가 결정).
// 어떤 예외든 조용히 스킵(스플래시 미표시 폴백). ※ 향후 CSP enforce 시 nonce 필요.
// ※ data-splash 세팅과 동시에 <html>에 인라인 티얼 배경을 칠한다 — 외부 globals.css가
//    적용되기 전(HTML 스트리밍 첫 페인트)에 흰 <body>가 잠깐 보이던 깜빡임 제거.
//    배경 해제는 스플래시 종료 시점(splash-intro.tsx finish)에서 style 초기화로 처리한다.
const SPLASH_GATE = `(function(){try{if(sessionStorage.getItem('vg-splash'))return;if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;var p=location.pathname;if(p.indexOf('/p/')===0||p.indexOf('/g/')===0||p.indexOf('/webchat')===0||p==='/chat'||p.indexOf('/chat/')===0||p==='/privacy'||p.indexOf('/privacy/')===0)return;var d=document.documentElement;d.setAttribute('data-splash','1');d.style.backgroundColor='#12857a';}catch(e){}})();`;

export const metadata: Metadata = {
  title: "Villa Go",
  description: "푸꾸옥 빌라 임대 관리 시스템",
  applicationName: "Villa Go",
  // PWA: app/manifest.ts·icon.svg·apple-icon.tsx는 Next가 자동 링크.
  // iOS 홈화면 설치 시 전체화면(앱처럼) + 상태바 스타일.
  appleWebApp: {
    capable: true,
    title: "Villa Go",
    // black-translucent — 상태바를 투명하게 만들어 화면(스플래시 teal·운영자 다크·공급자 상단
    // teal 스트립)이 상태바 뒤까지 채우게 한다. "default"(흰 상태바)의 이질감 제거.
    // ⚠ 투명 상태바는 글자색이 항상 흰색으로 고정되므로, 최상단 safe-area는 반드시 어두운/teal
    //    배경으로 채워야 한다(각 상단 바 .pt-safe + 배경). 흰 배경 위에 두면 시간·배터리가 안 보임.
    statusBarStyle: "black-translucent",
    // iOS 설치 PWA 부팅 중 흰 런치 화면 제거 — teal 스플래시(핀 로고+워드마크)를 기기별로 매칭.
    //   ※ iOS는 media 쿼리가 기기 해상도와 정확히 일치해야 적용하므로 portrait 전 기종을 나열.
    //   ※ 안드로이드는 이 태그를 무시하고 manifest background_color(teal)로 런치 스플래시를 그린다.
    //   이미지 생성: scripts/gen-apple-splash.py (public/splash/apple-splash-*.png).
    startupImage: [
      { url: "/splash/apple-splash-1320x2868.png", media: "screen and (device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
      { url: "/splash/apple-splash-1206x2622.png", media: "screen and (device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
      { url: "/splash/apple-splash-1290x2796.png", media: "screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
      { url: "/splash/apple-splash-1179x2556.png", media: "screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
      { url: "/splash/apple-splash-1284x2778.png", media: "screen and (device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
      { url: "/splash/apple-splash-1170x2532.png", media: "screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
      { url: "/splash/apple-splash-1125x2436.png", media: "screen and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
      { url: "/splash/apple-splash-1242x2688.png", media: "screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
      { url: "/splash/apple-splash-828x1792.png", media: "screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
      { url: "/splash/apple-splash-750x1334.png", media: "screen and (device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
      { url: "/splash/apple-splash-640x1136.png", media: "screen and (device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    ],
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
  // T-splash-intro 태그라인: 오버레이는 빈 i18n provider 밖이라 layout(서버)에서
  // 동일 locale 로직으로 문자열을 골라 prop 전달(messages/*.json 미변경).
  const splashTagline =
    lang === "ko" ? "찾던 그 빌라, 여기 있어요" : "Villa bạn tìm, có ở đây";
  return (
    <html lang={lang}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SPLASH_GATE }} />
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
        {/* T-splash-intro — NextIntlClientProvider 밖(빈 provider)에 정적 마운트.
            표시 여부는 CSS html[data-splash="1"]가 결정(기본 display:none). */}
        <SplashIntro tagline={splashTagline} />
        <NextIntlClientProvider messages={{}}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
