// components/brand/villa-go-header-logo.tsx — 공개 페이지 헤더 로고(마크 + 워드마크)
//
// 공개 트리(홈·블로그·빌라·패싯 등) 헤더가 전부 공유한다. 예전엔 각 페이지가 텍스트 "Villa GO"만
// 복붙해서 마크(핀)가 빠져 있었다(테오 지적 2026-07-24). 여기 한 곳으로 모아 재발을 막는다.
import Link from "next/link";
import { VillaGoMark } from "@/components/brand/villa-go-logo";

export function VillaGoHeaderLogo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="Villa GO 홈">
      <VillaGoMark className="h-7 w-auto" />
      {/* 대비: 흰 헤더 위 teal-600(2.9:1)은 WCAG 미달 → teal-700(4.3:1)로 상향 */}
      <span className="text-lg font-extrabold tracking-tight text-teal-700">Villa GO</span>
    </Link>
  );
}
