// [SHARED-MODULE] from traveldiary-mvp app/manifest.ts
/**
 * PWA Web App Manifest — 시나리오 C Phase C2.
 *
 * 홈 화면 추가(A2HS) 지원. Next.js App Router 네이티브.
 */

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TRAVELDIARY — 베트남 자유여행 AI 동반자",
    short_name: "TravelDiary",
    description: "AI가 추천한 일정에 근거까지. 여행 중에는 살아 움직여요.",
    start_url: "/",
    id: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#7C3AED",
    orientation: "portrait",
    categories: ["travel", "lifestyle"],
    lang: "ko",
    dir: "ltr",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "새 여행 계획",
        short_name: "계획",
        url: "/onboarding",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "내 여행 목록",
        short_name: "여행",
        url: "/trips",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
