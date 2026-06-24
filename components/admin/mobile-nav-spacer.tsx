"use client";

// 모바일 하단 네비게이션(components/admin/sidebar.tsx) 높이만큼 본문 끝에 여백을 확보.
// 고정(fixed) 네비가 콘텐츠 하단을 가리지 않게 인-플로우 스페이서로 밀어준다.
// 풀스크린 라우트(채팅 등 100dvh 레이아웃)에서는 네비를 숨기므로 스페이서도 0.
import { usePathname } from "next/navigation";

/** 하단 네비를 숨기는(=스페이서 불필요) 풀스크린 라우트 접두사 */
export const ADMIN_FULLSCREEN_PREFIXES = ["/messages"];

export default function MobileNavSpacer() {
  const pathname = usePathname();
  if (ADMIN_FULLSCREEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return <div aria-hidden className="lg:hidden h-20" />;
}
