"use client";

// /messages 인박스|채팅 2단 리사이즈 분할 패널 (Nike chat page.tsx 패턴 이식)
// - 데스크톱(lg+, ≥1024px)에서만 좌측 인박스 너비를 드래그 구분선으로 조절.
// - 모바일(<lg)에서는 리사이저 비활성 — 인박스/채팅이 각자 전체폭(Inbox가 자체 hide/show).
// - 너비는 localStorage("villa-messages-inbox-width-px")에 px로 저장 → 새로고침 유지.
// - min/max 제약으로 인박스가 너무 좁거나 넓어지지 않게 고정(Nike 18~45% → villa는 px 기준).
//
// RSC인 page.tsx가 <Inbox>·<ChatPane>을 children(inbox/chat)으로 넘긴다(서버 데이터 보존).
// 이 컴포넌트는 레이아웃·드래그 상호작용만 담당 — 기존 채팅 로직(송수신·번역·자동스크롤 등)은
// chat-pane.tsx에 그대로 있고 건드리지 않는다.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const STORAGE_KEY = "villa-messages-inbox-width-px";
const DEFAULT_WIDTH = 320; // 기존 lg:w-[320px]와 동일 — 초기값/폴백
const MIN_WIDTH = 240;
const MAX_WIDTH = 560;
const DESKTOP_MQ = "(min-width: 1024px)"; // tailwind lg

function clampWidth(px: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, px));
}

export function ResizableSplit({
  inbox,
  chat,
  conversationSelected,
}: {
  inbox: ReactNode;
  chat: ReactNode;
  // 모바일에서 대화 선택 시 인박스 wrapper도 숨겨 채팅이 전체폭이 되도록(Inbox 내부 로직과 정합).
  conversationSelected: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  // 데스크톱 여부 추적 — 모바일에선 인라인 너비를 적용하지 않아 인박스가 자체 w-full을 따름.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // 저장된 너비 복원 (마운트 1회). 잘못된 값은 clamp로 정상화.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const px = Number(saved);
        if (Number.isFinite(px)) setWidth(clampWidth(px));
      }
    } catch {
      // localStorage 접근 불가(프라이빗 모드 등) — 기본값 유지
    }
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const next = clampWidth(ev.clientX - rect.left);
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // 드래그 종료 시점에만 저장(이동 중 매 프레임 쓰기 방지)
      setWidth((w) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, String(w));
        } catch {
          // 저장 실패 무시
        }
        return w;
      });
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div ref={containerRef} className="flex flex-1 min-w-0">
      {/* 인박스 wrapper — 데스크톱(lg+)에서만 인라인 px 너비 적용. 모바일은 인박스 자체 w-full. */}
      <div
        className={`${
          conversationSelected ? "hidden lg:flex" : "flex"
        } w-full shrink-0 min-h-0`}
        style={isDesktop ? { width: `${width}px`, flexShrink: 0 } : undefined}
      >
        {inbox}
      </div>

      {/* 드래그 구분선 (데스크톱 전용) — 인박스와 채팅 사이. 호버/드래그 시 강조. */}
      <div
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="대화 목록 너비 조절"
        className="relative hidden lg:block w-1 shrink-0 cursor-col-resize bg-slate-800 hover:bg-blue-500/60 active:bg-blue-500 transition-colors"
      >
        {/* 클릭 영역 확대용 투명 오버레이(시각 폭 1px이라 잡기 어려움 방지) */}
        <span className="absolute -inset-x-1.5 inset-y-0" />
      </div>

      {/* 채팅 pane — 나머지 너비 차지 */}
      {chat}
    </div>
  );
}
