"use client";

// 라이트 포털 공용 브랜드 마크 — 상단 중앙 고정(헤더 없는 SUPPLIER/CLEANER/VENDOR 셸).
//   좌상단 계정 아이콘·우상단 언어전환과 같은 띠(top-3)에 중앙 배치(겹침 없음).
//   PARTNER는 자체 헤더에 로고가 있으므로 이 컴포넌트를 쓰지 않는다.
//   풀스크린 플로우(빌라 등록 마법사·체크인/아웃)에서는 숨김(PortalAccountLink와 동일 규칙).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";

export function PortalBrand({
  href,
  fullscreenPrefixes = [],
}: {
  /** 로고 클릭 시 이동할 포털 홈(공급자/청소="/", 벤더="/vendor"). */
  href: string;
  fullscreenPrefixes?: string[];
}) {
  const pathname = usePathname();
  if (fullscreenPrefixes.some((p) => pathname.startsWith(p))) return null;

  return (
    <Link
      href={href}
      aria-label="Villa Go"
      className="fixed left-1/2 top-3 z-[55] flex h-9 -translate-x-1/2 items-center gap-1.5"
    >
      <VillaGoMark className="h-6 w-6" />
      <VillaGoWordmark className="text-base" />
    </Link>
  );
}
