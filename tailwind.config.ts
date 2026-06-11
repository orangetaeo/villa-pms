import type { Config } from "tailwindcss";

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
        admin: ["Public Sans", "Noto Sans KR", "sans-serif"],
        headline: ["Be Vietnam Pro", "Noto Sans KR", "sans-serif"],
        display: ["Be Vietnam Pro", "Noto Sans KR", "sans-serif"],
        body: ["Be Vietnam Pro", "Noto Sans KR", "sans-serif"],
        label: ["Be Vietnam Pro", "Noto Sans KR", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
