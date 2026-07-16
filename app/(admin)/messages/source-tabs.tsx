"use client";

// /messages 소스 탭 (Zalo | 웹 채팅) — T-webchat-inbox
//
// 기존 Zalo 인박스는 무변경. 이 바는 page.tsx가 두 브랜치(zalo/webchat) 공통으로 상단에 렌더한다.
// ?tab=webchat searchParams로 분기. tabHref는 기존 searchParams 클론 패턴(상대 탭 선택 파라미터만 제거).
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

export function SourceTabs({
  active,
  zaloUnread,
  webchatUnread,
}: {
  active: "zalo" | "webchat";
  zaloUnread: number;
  webchatUnread: number;
}) {
  const t = useTranslations("adminWebchat");
  const sp = useSearchParams();

  // 기존 searchParams 클론 → 탭 전환 시 상대 탭의 선택 파라미터만 제거(다른 필터는 보존).
  const zaloHref = (() => {
    const p = new URLSearchParams(sp?.toString() ?? "");
    p.delete("tab");
    p.delete("session"); // 웹챗 선택 파라미터 제거
    const q = p.toString();
    return q ? `/messages?${q}` : "/messages";
  })();
  const webchatHref = (() => {
    const p = new URLSearchParams(sp?.toString() ?? "");
    p.set("tab", "webchat");
    p.delete("c"); // Zalo 선택 파라미터 제거
    return `/messages?${p.toString()}`;
  })();

  return (
    <div className="shrink-0 flex items-stretch gap-1 px-3 sm:px-5 pt-3 pb-2 bg-slate-900 border-b border-slate-800">
      <Tab
        href={zaloHref}
        active={active === "zalo"}
        icon="forum"
        label={t("tab.zalo")}
        unread={zaloUnread}
      />
      <Tab
        href={webchatHref}
        active={active === "webchat"}
        icon="chat"
        label={t("tab.webchat")}
        unread={webchatUnread}
      />
    </div>
  );
}

function Tab({
  href,
  active,
  icon,
  label,
  unread,
}: {
  href: string;
  active: boolean;
  icon: string;
  label: string;
  unread: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-bold bg-slate-800 text-white border border-slate-700"
          : "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent transition-colors"
      }
    >
      <span className="material-symbols-outlined text-[18px] leading-none">{icon}</span>
      <span>{label}</span>
      {unread > 0 && (
        <span className="bg-blue-600 text-white text-[10px] font-black min-w-[16px] px-1 py-0.5 rounded-full text-center leading-none">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
