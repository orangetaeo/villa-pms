"use client";

// 원천 공급자(VENDOR) 계정 진입 버튼 — 좌측 상단 고정.
//   공급자 AccountLink 미러 — /vendor/profile(비번변경·지급정보·로그아웃)로 이동.
//   우측 상단 클러스터(알림 벨 right-20 + LocaleSwitcher right-3)와 대칭으로 좌측에 배치.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export default function VendorAccountLink() {
  const t = useTranslations("account");
  const pathname = usePathname();

  // 계정 화면 자신에서는 중복 진입 숨김
  if (pathname === "/vendor/profile") return null;

  return (
    <Link
      href="/vendor/profile"
      aria-label={t("title")}
      title={t("title")}
      className="fixed left-3 top-3 z-[60] flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white/90 text-neutral-600 shadow-sm backdrop-blur transition-colors hover:text-teal-600"
    >
      <span className="material-symbols-outlined text-[20px]">account_circle</span>
    </Link>
  );
}
