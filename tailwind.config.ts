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
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        lg: "1rem",
        xl: "1.5rem",
        full: "9999px",
      },
      fontFamily: {
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
