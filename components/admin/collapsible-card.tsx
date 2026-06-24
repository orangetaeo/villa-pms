// 운영자 상세 화면 공통 접기/펴기 카드 — 네이티브 <details>로 JS 없이 동작(RSC·클라 양쪽 가능).
// 기본 접힘(defaultOpen=false). 제목(+아이콘)만 summary로 두어 토글, action(저장 버튼 등)은
// 본문 상단 바로 내려 summary 클릭과 충돌하지 않게 한다.
import type { ReactNode } from "react";

export default function CollapsibleCard({
  title,
  icon,
  defaultOpen = false,
  /** 제목 우측 메타(개수·읽기전용 배지 등) — summary 안에 표시(비대화형만 권장) */
  headerMeta,
  /** 본문 상단 액션 바(저장 버튼·상태 메시지 등 대화형) */
  action,
  children,
  className = "",
}: {
  title: ReactNode;
  icon?: string;
  defaultOpen?: boolean;
  headerMeta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      className={`group bg-admin-card rounded-xl border border-slate-800 shadow-xl overflow-hidden ${className}`}
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="list-none cursor-pointer select-none flex items-center justify-between gap-3 p-6 [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg font-bold flex items-center gap-2 whitespace-nowrap">
          {icon ? (
            <span className="material-symbols-outlined text-admin-primary">{icon}</span>
          ) : null}
          {title}
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          {headerMeta}
          <span
            className="material-symbols-outlined text-slate-500 transition-transform group-open:rotate-180"
            aria-hidden
          >
            expand_more
          </span>
        </div>
      </summary>
      <div className="border-t border-slate-800">
        {action ? (
          <div className="px-6 py-3 border-b border-slate-800 flex items-center justify-end gap-3">
            {action}
          </div>
        ) : null}
        <div className="p-6">{children}</div>
      </div>
    </details>
  );
}
