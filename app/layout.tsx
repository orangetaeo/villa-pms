import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { cookies } from "next/headers";
import "./globals.css";
import SplashIntro from "@/components/splash-intro";
import { fontVariables } from "./fonts";

// T-splash-intro — 페인트 전 동기 게이트: sessionStorage(세션당 1회)·reduced-motion·
// 제외경로(/p·/g) 판정 후 html[data-splash]를 세팅한다(스플래시 표시는 CSS가 결정).
// 어떤 예외든 조용히 스킵(스플래시 미표시 폴백). ※ 향후 CSP enforce 시 nonce 필요.
//   ★ T-seo-s1: 공개 SEO 트리(`/` 공개 홈·`/blog/**`)도 제외한다. 전면 오버레이가 본문을
//     가리면 크롤러·방문자 모두에게 인터스티셜로 보이고, 검색 유입의 첫인상을 스플래시가 잡아먹는다.
const SPLASH_GATE = `(function(){try{if(sessionStorage.getItem('vg-splash'))return;if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;var p=location.pathname;if(p==='/'||p==='/blog'||p.indexOf('/blog/')===0||p.indexOf('/p/')===0||p.indexOf('/g/')===0||p.indexOf('/webchat')===0||p==='/chat'||p.indexOf('/chat/')===0||p==='/privacy'||p.indexOf('/privacy/')===0||p==='/card'||p.indexOf('/card/')===0)return;document.documentElement.setAttribute('data-splash','1');}catch(e){}})();`;

// 검색엔진 소유확인 — 네이버 서치어드바이저·Google Search Console·Bing Webmaster.
//   값은 env로만 주입한다(테오가 각 콘솔에서 발급). 미설정이면 메타 자체가 출력되지 않는다.
//   ★ generateMetadata(함수)로 두는 이유: 모듈 상수로 두면 정적 렌더 경로에서 **빌드 타임 env**가
//     구워진다(robots.txt에서 실제로 터진 사고와 동일 원인). 함수는 요청 시점에 평가된다.
function verificationMeta(): Metadata["verification"] {
  const naver = process.env.NAVER_SITE_VERIFICATION?.trim();
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = process.env.BING_SITE_VERIFICATION?.trim();
  return {
    ...(google ? { google } : {}),
    other: {
      ...(naver ? { "naver-site-verification": naver } : {}),
      ...(bing ? { "msvalidate.01": bing } : {}),
    },
  };
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Villa Go",
    description: "푸꾸옥 빌라 임대 관리 시스템",
    applicationName: "Villa Go",
    verification: verificationMeta(),
    // PWA: app/manifest.ts·icon.svg·apple-icon.tsx는 Next가 자동 링크.
    // iOS 홈화면 설치 시 전체화면(앱처럼) + 상태바 스타일.
    appleWebApp: {
      capable: true,
      title: "Villa Go",
      statusBarStyle: "default",
    },
  };
}

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
    <html lang={lang} className={fontVariables}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SPLASH_GATE }} />
        {/* 본문 폰트(Be Vietnam Pro·Public Sans·Noto Sans KR)는 next/font로 셀프호스팅
            한다(app/fonts.ts) — 외부 렌더블로킹 CSS 제거 + display:swap로 LCP 개선.
            아이콘 폰트(Material Symbols)만 외부 링크로 남기되 &display=swap을 붙여
            텍스트/아이콘 페인트를 막지 않게 한다. preconnect는 이 아이콘 폰트용. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
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
