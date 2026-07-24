// app/fonts.ts — next/font 셀프호스팅 (LCP 최적화)
//
// ★ 왜 next/font인가 (Lighthouse LCP 4.3s 진단, 2026-07-24):
//   기존엔 fonts.googleapis.com 외부 <link rel="stylesheet">로 3종 폰트를 받았다.
//   → ⑴ 외부 CSS 요청이 렌더를 막음(render-blocking ~670ms)
//     ⑵ 폰트 파일이 gstatic에서 늦게 도착해 텍스트 페인트가 지연됨(font-display ~1020ms).
//   next/font는 폰트를 **빌드 타임에 받아 우리 오리진에서 셀프호스팅**하고, 임계 @font-face를
//   HTML에 인라인하며(외부 CSS 요청 제거), display:swap + 프리로드를 자동 처리한다.
//   ★ CSP enforce 하에서도 안전 — 외부 폰트 CSS onload 트릭(인라인 핸들러) 불필요.
//
// 각 폰트는 CSS 변수(variable)로 노출 → globals.css body / tailwind fontFamily가 참조한다.
import { Be_Vietnam_Pro, Public_Sans, Noto_Sans_KR } from "next/font/google";

// 전역 기본 — 베트남 사용자 우선(vietnamese 서브셋 포함). 공개 홈 헤드라인/본문도 이 폰트.
export const beVietnam = Be_Vietnam_Pro({
  weight: ["400", "600", "700", "800"],
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-be-vietnam",
});

// 운영자(ADMIN) 폰트 — font-admin. 공개 홈 임계경로는 아니지만 전역 로드.
export const publicSans = Public_Sans({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-public-sans",
});

// 한글 폴백 — CJK는 용량이 커서 프리로드하지 않는다(preload:false). 한글 글리프는
//   생성된 @font-face의 unicode-range로 필요할 때 로드된다(서브셋 키 불필요).
export const notoKR = Noto_Sans_KR({
  weight: ["400", "500", "700", "900"],
  display: "swap",
  variable: "--font-noto-kr",
  preload: false,
});

/** <html> 에 부착할 폰트 변수 클래스(세 폰트 CSS 변수 등록). */
export const fontVariables = `${beVietnam.variable} ${publicSans.variable} ${notoKR.variable}`;
