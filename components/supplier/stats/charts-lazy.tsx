"use client";

// 공급자·벤더 통계 차트 lazy 래퍼 (perf, 2026-06-27)
// RevenueBar/OccupancyArea는 recharts(~90KB+) 의존인데 /earnings·/vendor/stats가 서버 컴포넌트라
// 거기선 next/dynamic(ssr:false)를 못 쓴다. 이 "use client" 모듈에서 dynamic 처리해 코드 스플리팅하고
// 서버 컴포넌트는 여기서 import만 한다(차트 청크는 마운트 시 로드 → 첫 진입 JS 축소·TTI 개선).
import dynamic from "next/dynamic";

const chartLoading = () => (
  <div className="flex h-56 w-full items-center justify-center rounded-xl bg-neutral-50 text-sm text-neutral-300">
    …
  </div>
);

export const RevenueBar = dynamic(() => import("./revenue-bar"), {
  ssr: false,
  loading: chartLoading,
});

export const OccupancyArea = dynamic(() => import("./occupancy-area"), {
  ssr: false,
  loading: chartLoading,
});
