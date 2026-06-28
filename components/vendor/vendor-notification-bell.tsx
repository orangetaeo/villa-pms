"use client";

// 원천 공급자 인앱 알림센터 벨 (ADR-0023 후속) — 헤더 종 + 미읽음 뱃지 + 하단 시트 목록.
//   GET /api/vendor/notifications(목록·미읽음 수), POST /read(읽음 처리).
//   ★ 누수: API가 가격 없는 InAppNotification만 내려줌(판매가·마진 없음). 이 컴포넌트는 그 shape만 사용.
//   SSE 아님 — 마운트 시 + 주기 폴링(POLL_MS)으로 미읽음 갱신. 시트 열 때 read 호출해 0으로.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const POLL_MS = 45_000; // 45초 폴링 — 모바일 배터리·부하 고려(SSE 미사용)

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

/** ISO(UTC 타임스탬프) → "dd/MM HH:mm" — VN 현지시각(UTC+7, DST 없음)으로 표시.
 *  UTC 순간에 +7h를 더한 뒤 getUTC*로 읽어 VN 벽시계를 얻는다(서버/클라 TZ 무관 안정). */
function formatWhen(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

export default function VendorNotificationBell() {
  const t = useTranslations("vendorNotif");
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notif[] | null>(null);
  const [error, setError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 미읽음 수만 가볍게 갱신(폴링) — 목록은 시트 열 때만 로드
  const refreshUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number };
      setUnread(data.unread ?? 0);
    } catch {
      // 폴링 실패는 조용히 무시(다음 주기 재시도)
    }
  }, []);

  // 목록 로드 + (미읽음 있으면) 읽음 처리
  const loadList = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/vendor/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { unread: number; notifications: Notif[] };
      setItems(data.notifications);
      // 시트를 연 시점에 전체 읽음 처리(낙관적으로 뱃지 0)
      if ((data.unread ?? 0) > 0) {
        setUnread(0);
        void fetch("/api/vendor/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).catch(() => {
          // 읽음 처리 실패 시 다음 폴링이 실제 미읽음 수로 복원
        });
      } else {
        setUnread(0);
      }
    } catch {
      setError(true);
      setItems([]);
    }
  }, []);

  // 마운트 시 + 폴링 시작
  useEffect(() => {
    void refreshUnread();
    pollRef.current = setInterval(() => void refreshUnread(), POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshUnread]);

  const openSheet = useCallback(() => {
    setOpen(true);
    void loadList();
  }, [loadList]);

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label={t("ariaOpen")}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 active:scale-95"
      >
        <span className="material-symbols-outlined text-2xl">notifications</span>
        {unread > 0 && (
          <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40">
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl">
            <div className="shrink-0 space-y-3 px-5 pb-2 pt-4">
              <div className="mx-auto h-1.5 w-12 rounded-full bg-neutral-200" />
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-neutral-900">{t("title")}</h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("close")}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 active:scale-95"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
              {items === null ? (
                <p className="py-12 text-center text-sm text-neutral-400">{t("loading")}</p>
              ) : error ? (
                <button
                  type="button"
                  onClick={() => void loadList()}
                  className="w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 active:scale-[0.99]"
                >
                  {t("loadError")}
                </button>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <span className="material-symbols-outlined text-5xl text-teal-600">
                    notifications_off
                  </span>
                  <p className="text-sm text-neutral-500">{t("empty")}</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {items.map((n) => {
                    const inner = (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 font-bold text-neutral-900">{n.title}</p>
                          {!n.readAt && (
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                          )}
                        </div>
                        {n.body && (
                          <p className="whitespace-pre-line break-words text-sm text-neutral-600">
                            {n.body}
                          </p>
                        )}
                        <p className="text-[11px] text-neutral-400">{formatWhen(n.createdAt)}</p>
                      </>
                    );
                    const cls =
                      "block space-y-1 rounded-xl border-l-4 bg-white p-3 shadow-sm " +
                      (n.readAt ? "border-neutral-200" : "border-rose-400");
                    return (
                      <li key={n.id}>
                        {n.href ? (
                          <a href={n.href} className={`${cls} active:scale-[0.99]`}>
                            {inner}
                          </a>
                        ) : (
                          <div className={cls}>{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
