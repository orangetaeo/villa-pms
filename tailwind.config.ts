import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#0D9488",
        secondary: "#F59E0B",
        surface: "#FFFFFF",
        border: "#E2E8F0",
        textMain: "#0F172A",
        // 운영자(ADMIN) 다크 토큰 — Stitch b9/b10 export에서 추출 (T1.2)
        admin: {
          primary: "#3B82F6",
          "primary-dark": "#2563EB",
          bg: "#0F172A",
          card: "#1E293B",
          border: "#334155",
          muted: "#94A3B8",
          pending: "#F59E0B",
          active: "#16A34A",
          inactive: "#475569",
          alert: "#DC2626",
          // 통계 통화 구분색 (b17 Stitch): KRW=블루(admin-primary 동일), VND=에메랄드
          krw: "#3B82F6",
          vnd: "#10B981",
        },
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        lg: "1rem",
        xl: "1.5rem",
        full: "9999px",
      },
      fontFamily: {
        // 운영자(ADMIN) 폰트 — DESIGN.md 한글 폴백 규칙
        // next/font 셀프호스팅 CSS 변수 참조(app/fonts.ts) — 외부 폰트 링크 제거(LCP)
        admin: ["var(--font-public-sans)", "var(--font-noto-kr)", "sans-serif"],
        headline: ["var(--font-be-vietnam)", "var(--font-noto-kr)", "sans-serif"],
        display: ["var(--font-be-vietnam)", "var(--font-noto-kr)", "sans-serif"],
        body: ["var(--font-be-vietnam)", "var(--font-noto-kr)", "sans-serif"],
        label: ["var(--font-be-vietnam)", "var(--font-noto-kr)", "sans-serif"],
      },
    },
  },
  plugins: [
    // 터치(coarse 포인터) 기기 분기 변형. 채팅 메시지 액션(답글·리액션) 버튼을
    // 호버가 없는 모바일/태블릿에서 상시 노출(`pointer-coarse:opacity-100`)하는 데 사용.
    plugin(({ addVariant }) => {
      addVariant("pointer-coarse", "@media (pointer: coarse)");
    }),
  ],
};

export default config;
