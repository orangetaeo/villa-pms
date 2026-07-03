"use client";

// 운영자 인앱 알림 벨 (admin-vendor-ops C) — 사이드바 하단 종 + 미읽음 뱃지 + 드롭업 패널.
//   GET /api/admin/notifications(목록·미읽음 수), POST /read(전체 읽음 처리).
//   ★ 위치: 사이드바 안이므로 패널은 fixed 금지 — 부모(positioned=relative) 기준 absolute 드롭업.
//     (포털 헤더 backdrop-blur가 fixed의 containing block이 되던 함정과 동일 계열 — 처음부터 absolute.)
//     부모 컨테이너(sidebar 하단 사용자 영역)에 반드시 `relative`가 있어야 한다.
//   ★ 누수: API가 가격 없는 InAppNotification만 내려줌(판매가·마진·costVnd 없음). 이 shape만 사용.
//   SSE 아님 — 마운트 시 + 60초 폴링으로 미읽음 갱신. 패널 열 때 read 호출해 0으로.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const POLL_MS = 60_000; // 60초 폴링 — 운영자 데스크톱 기준(SSE 미사용)

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

export default function AdminNotificationBell() {
  const t = useTranslations("adminNotif");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notif[] | null>(null);
  const [error, setError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 미읽음 수만 가볍게 갱신(폴링) — 목록은 패널 열 때만 로드
  const refreshUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number };
      setUnread(data.unread ?? 0);
    } catch {
      // 폴링 실패는 조용히 무시(다음 주기 재시도)
    }
  }, []);

  // 목록 로드 + (미읽음 있으면) 전체 읽음 처리
  const loadList = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/admin/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { unread: number; notifications: Notif[] };
      setItems(data.notifications);
      // 패널을 연 시점에 전체 읽음 처리(낙관적으로 뱃지 0)
      setUnread(0);
      if ((data.unread ?? 0) > 0) {
        void fetch("/api/admin/notifications/read", { method: "POST" }).catch(() => {
          // 읽음 처리 실패 시 다음 폴링이 실제 미읽음 수로 복원
        });
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

  const toggle = useCallback(() => {
    setOpen((v) => {
      if (!v) void loadList();
      return !v;
    });
  }, [loadList]);

  // 항목 클릭 — 패널 닫고 딥링크 이동(예약 상세·벤더 관리)
  const goTo = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={t("ariaOpen")}
        title={t("title")}
        aria-expanded={open}
        className="relative text-admin-muted hover:text-white hover:bg-admin-card rounded-lg p-2 transition-colors duration-200"
      >
        <span className="material-symbols-outlined text-[20px]">notifications</span>
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* 드롭업 패널 — 부모(relative) 기준 absolute. 사이드바 하단이므로 위로 펼침 */}
      {open && (
        <div className="absolute bottom-full left-0 right-0 z-10 mb-2 flex max-h-96 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-3 py-2">
            <h3 className="text-sm font-bold text-white">{t("title")}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("close")}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:text-white"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {items === null ? (
              <p className="py-8 text-center text-xs text-slate-500">{t("loading")}</p>
            ) : error ? (
              <button
                type="button"
                onClick={() => void loadList()}
                className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs font-medium text-red-300 active:scale-[0.99]"
              >
                {t("loadError")}
              </button>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <span className="material-symbols-outlined text-3xl text-slate-600">
                  notifications_off
                </span>
                <p className="text-xs text-slate-500">{t("empty")}</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {items.map((n) => {
                  const inner = (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-xs font-bold text-slate-100">{n.title}</p>
                        {!n.readAt && (
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                        )}
                      </div>
                      {n.body && (
                        <p className="whitespace-pre-line break-words text-[11px] text-slate-400">
                          {n.body}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-600">{formatWhen(n.createdAt)}</p>
                    </>
                  );
                  const cls =
                    "block w-full space-y-0.5 rounded-lg border-l-2 bg-slate-800/60 p-2 text-left " +
                    (n.readAt ? "border-slate-700" : "border-rose-400");
                  return (
                    <li key={n.id}>
                      {n.href ? (
                        <button
                          type="button"
                          onClick={() => goTo(n.href!)}
                          className={`${cls} transition hover:bg-slate-800 active:scale-[0.99]`}
                        >
                          {inner}
                        </button>
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
      )}
    </>
  );
}
