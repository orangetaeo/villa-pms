"use client";

// 신규 채팅 토스트 (ADR-0009 D-toast) — 현재 열람 중인 대화가 아닌 다른 상대에게
// 새 메시지가 도착하면 화면 상단에 토스트로 알린다. AutoRefresh(폴링)가 inboxItems를
// 갱신할 때마다 대화별 unreadCount 증가를 비교해 증가분만 알림으로 띄운다.
// - 초기 로드(첫 렌더)는 기존 미읽음을 알리지 않음(스냅샷만 저장).
// - 현재 선택된 대화(selectedId)는 제외(이미 보고 있음 — 스레드의 "새 메시지↓"가 담당).
// - 클릭 시 해당 대화로 이동. 4.5초 후 자동 사라짐. 동시 최대 3개.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CounterpartyBadge } from "./counterparty-badge";
import type { InboxItem } from "./inbox";

interface ToastItem {
  key: string; // 토스트 고유키(대화id + 시퀀스)
  convId: string;
  name: string;
  counterpartyType: InboxItem["counterpartyType"];
  text: string;
}

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 4500;

// 미리보기 본문 — 빈 본문(사진·공유 등)은 종류 라벨로 폴백.
function previewBody(item: InboxItem, t: ReturnType<typeof useTranslations>): string {
  if (item.lastText?.trim()) return item.lastText;
  switch (item.lastMsgType) {
    case "photo":
      return t("preview.photo");
    case "villa_share":
      return t("preview.villaShare");
    case "proposal_share":
      return t("preview.proposalShare");
    case "settlement_share":
      return t("preview.settlementShare");
    case "sticker":
      return t("preview.sticker");
    case "voice":
      return t("preview.voice");
    case "file":
      return t("reply.fileFallback");
    default:
      return t("newMessageToast.fallback");
  }
}

export function NewMessageToaster({
  items,
  selectedId,
}: {
  items: InboxItem[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("adminMessages");
  // 대화별 직전 unreadCount 스냅샷. null이면 아직 초기화 전(첫 렌더).
  const prevUnreadRef = useRef<Map<string, number> | null>(null);
  const seqRef = useRef(0); // 토스트 키 시퀀스(중복 키 방지)
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((key: string) => {
    setToasts((cur) => cur.filter((x) => x.key !== key));
  }, []);

  // inboxItems 변화 감지 → 다른 대화의 unread 증가분을 토스트로.
  useEffect(() => {
    const cur = new Map(items.map((i) => [i.id, i.unreadCount]));
    const prev = prevUnreadRef.current;
    prevUnreadRef.current = cur;
    if (prev === null) return; // 첫 렌더 — 기존 미읽음은 알리지 않음

    const fresh: ToastItem[] = [];
    for (const it of items) {
      if (it.id === selectedId) continue; // 현재 보고 있는 대화 제외
      const before = prev.get(it.id) ?? 0;
      if (it.unreadCount > before) {
        seqRef.current += 1;
        fresh.push({
          key: `${it.id}-${seqRef.current}`,
          convId: it.id,
          name: it.name,
          counterpartyType: it.counterpartyType,
          text: previewBody(it, t),
        });
      }
    }
    if (fresh.length > 0) {
      // 같은 대화의 이전 토스트는 최신으로 대체, 최대 MAX_TOASTS개 유지.
      setToasts((curr) => {
        const freshConvIds = new Set(fresh.map((f) => f.convId));
        const kept = curr.filter((x) => !freshConvIds.has(x.convId));
        return [...kept, ...fresh].slice(-MAX_TOASTS);
      });
    }
  }, [items, selectedId, t]);

  // 자동 사라짐 — 현재 토스트들에 타이머.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((tt) =>
      window.setTimeout(() => dismiss(tt.key), AUTO_DISMISS_MS),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, dismiss]);

  function openConversation(convId: string, key: string) {
    dismiss(key);
    router.push(`/messages?c=${convId}`);
  }

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-3 inset-x-3 lg:inset-x-auto lg:right-4 lg:w-80 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map((tt) => (
        <button
          key={tt.key}
          type="button"
          onClick={() => openConversation(tt.convId, tt.key)}
          className="pointer-events-auto w-full text-left flex items-start gap-2.5 rounded-xl border border-slate-700 bg-slate-800/95 backdrop-blur-md shadow-2xl shadow-black/40 px-3.5 py-3 hover:bg-slate-700/95 transition-colors animate-in"
        >
          <span className="material-symbols-outlined text-blue-400 text-[20px] shrink-0">
            chat
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-bold text-white truncate">{tt.name}</span>
              <CounterpartyBadge type={tt.counterpartyType} t={t} size="xs" />
            </div>
            <p className="text-xs text-slate-300 truncate mt-0.5">{tt.text}</p>
          </div>
          <span
            role="button"
            tabIndex={-1}
            aria-label={t("newMessageToast.dismiss")}
            onClick={(e) => {
              e.stopPropagation();
              dismiss(tt.key);
            }}
            className="shrink-0 -mr-1 -mt-0.5 w-6 h-6 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-600/50 flex items-center justify-center transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </span>
        </button>
      ))}
    </div>
  );
}
