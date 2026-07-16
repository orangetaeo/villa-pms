"use client";

// app/webchat/widget/webchat-widget.tsx — 방문자 채팅 위젯 client (T-webchat-mvp)
//
// 라이트 테마 단순 채팅. 폴링(창 보일 때만 3~5s, 60s 유휴 15s 백오프), 5언어 자체 판정,
// OUTBOUND=번역문 주표시+원문 토글, 연락처 카드, 3상태(paused/expired/blocked) UX.
// ⚠ next-intl 미사용. 서버 전용 lib/webchat.ts 직접 import 금지 — 순수 상수만 constants에서.
// ⚠ dangerouslySetInnerHTML 금지 — 평문 렌더(+ http(s) 자동링크는 안전 파서로).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MSG_MAX_LEN,
  POLL_MIN_MS,
  POLL_MAX_MS,
  POLL_IDLE_BACKOFF_MS,
  POLL_IDLE_AFTER_MS,
  WEBCHAT_LOCALES,
  mapNavigatorLocale,
  coerceWebChatLocale,
  type WebChatLocale,
} from "@/lib/webchat-constants";
import {
  widgetStrings,
  LOCALE_CHIP_LABEL,
  type WidgetStrings,
} from "@/lib/webchat-widget-i18n";

// ───────────────────────── 타입 ─────────────────────────

type Direction = "INBOUND" | "OUTBOUND";

interface Msg {
  id: string;
  direction: Direction;
  text: string;
  translatedText: string | null;
  translationFailed: boolean;
  createdAt: string;
  pending?: boolean; // 낙관적 발신(서버 확정 전)
  sendError?: boolean; // 발신 실패
}

type ChatStatus = "active" | "paused" | "expired" | "blocked";

const LS_LOCALE = "webchat:locale";
const LS_LAST_SEEN = "webchat:lastSeen";

const POLL_BASE_MS = Math.round((POLL_MIN_MS + POLL_MAX_MS) / 2);

// ───────────────────────── 안전 렌더러(평문 + http(s) 자동링크) ─────────────────────────
// chat-pane.tsx RichText의 http(s)-only 패턴을 위젯용으로 최소 이식. dangerouslySetInnerHTML 없음.

const URL_RE = /https?:\/\/[^\s<]+/g;

function LinkifiedText({ text }: { text: string }) {
  if (!text.includes("http")) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
    if (trail) url = url.slice(0, url.length - trail.length);
    out.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="wc-link"
      >
        {url}
      </a>
    );
    if (trail) out.push(trail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

// ───────────────────────── Turnstile(선택) ─────────────────────────

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void }
  ) => string;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// ───────────────────────── 컴포넌트 ─────────────────────────

export default function WebChatWidget({
  initialLocale,
  sourcePage,
  turnstileSiteKey,
  standalone = false,
}: {
  initialLocale: WebChatLocale | null;
  sourcePage: string;
  turnstileSiteKey: string | null;
  // standalone: 전체 화면 라우트(/chat)로 직접 렌더될 때 true — iframe 부모가 없으므로
  // 닫기 버튼을 숨긴다(전체 화면은 브라우저 뒤로가기가 닫기 역할). additive · 기본 false(iframe 로더).
  standalone?: boolean;
}) {
  const [locale, setLocale] = useState<WebChatLocale>(initialLocale ?? "en");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<ChatStatus>("active");
  const [hasSession, setHasSession] = useState(false);
  const [showAfterSend, setShowAfterSend] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [transientError, setTransientError] = useState<string | null>(null);

  const t: WidgetStrings = useMemo(() => widgetStrings(locale), [locale]);

  // refs for polling loop (state 스냅샷 회피)
  const hasSessionRef = useRef(false);
  const statusRef = useRef<ChatStatus>("active");
  const lastCreatedRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const localeRef = useRef<WebChatLocale>(locale);
  const turnstileTokenRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const turnstileElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    hasSessionRef.current = hasSession;
  }, [hasSession]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  // ── 초기 언어 판정: 쿠키(prop) > localStorage > navigator.language > en ──
  useEffect(() => {
    let resolved: WebChatLocale | null = initialLocale;
    if (!resolved) {
      try {
        const saved = window.localStorage.getItem(LS_LOCALE);
        if (saved && (WEBCHAT_LOCALES as readonly string[]).includes(saved)) {
          resolved = coerceWebChatLocale(saved);
        }
      } catch {
        /* localStorage 접근 불가 무시 */
      }
    }
    if (!resolved) resolved = mapNavigatorLocale(navigator.language);
    setLocale(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 스크롤 최하단 유지 ──
  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(() => {
    scrollToBottom();
  }, [messages, showAfterSend, showContact, contactSaved, scrollToBottom]);

  // ── 서버 메시지 병합(중복 제거·정렬·커서 갱신) ──
  const mergeServerMessages = useCallback(
    (incoming: Msg[]) => {
      if (incoming.length === 0) return;
      setMessages((prev) => {
        const known = new Set(prev.filter((m) => !m.pending).map((m) => m.id));
        const added = incoming.filter((m) => !known.has(m.id));
        if (added.length === 0) return prev;
        const merged = [...prev, ...added].sort((a, b) =>
          a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
        );
        return merged;
      });
      // 커서·lastSeen 갱신 + 유휴 타이머 리셋(새 답장 = 빠른 폴링 재개)
      let maxTs = lastCreatedRef.current ?? "";
      let hasOutbound = false;
      for (const m of incoming) {
        if (m.createdAt > maxTs) maxTs = m.createdAt;
        if (m.direction === "OUTBOUND") hasOutbound = true;
      }
      if (maxTs) {
        lastCreatedRef.current = maxTs;
        try {
          window.localStorage.setItem(LS_LAST_SEEN, maxTs);
        } catch {
          /* noop */
        }
      }
      if (hasOutbound) lastActivityRef.current = Date.now();
    },
    []
  );

  // ── 폴링 응답의 상태코드 처리 ──
  const applyReasonStatus = useCallback((res: Response, reason?: string) => {
    if (res.status === 503 || reason === "paused") setStatus("paused");
    else if (res.status === 410 || reason === "expired") setStatus("expired");
    else if (res.status === 403 || reason === "blocked") setStatus("blocked");
  }, []);

  // ── 폴링 1회 ──
  const pollOnce = useCallback(async () => {
    if (document.hidden) return;
    if (!hasSessionRef.current) return;
    if (statusRef.current !== "active") return;
    try {
      const cursor = lastCreatedRef.current;
      const url = cursor
        ? `/api/webchat/messages?after=${encodeURIComponent(cursor)}`
        : "/api/webchat/messages";
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 401) return; // 세션 없음 — 조용히
      if (!res.ok) {
        let reason: string | undefined;
        try {
          reason = (await res.json())?.reason;
        } catch {
          /* noop */
        }
        applyReasonStatus(res, reason);
        return;
      }
      const data = (await res.json()) as { ok?: boolean; messages?: Msg[] };
      if (data.ok && Array.isArray(data.messages)) {
        mergeServerMessages(
          data.messages.map((m) => ({
            id: m.id,
            direction: m.direction,
            text: m.text,
            translatedText: m.translatedText ?? null,
            translationFailed: !!m.translationFailed,
            createdAt: m.createdAt,
          }))
        );
      }
    } catch {
      /* 네트워크 오류는 다음 틱에서 재시도 */
    }
  }, [applyReasonStatus, mergeServerMessages]);

  // ── 폴링 스케줄러(유휴 백오프) ──
  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const idle = Date.now() - lastActivityRef.current > POLL_IDLE_AFTER_MS;
      const delay = idle ? POLL_IDLE_BACKOFF_MS : POLL_BASE_MS;
      pollTimerRef.current = setTimeout(run, delay);
    };
    const run = () => {
      pollOnce().finally(schedule);
    };
    // 첫 실행은 약간 지연(초기 로드와 겹침 방지)
    pollTimerRef.current = setTimeout(run, POLL_BASE_MS);

    const onVis = () => {
      if (!document.hidden) {
        lastActivityRef.current = Date.now();
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        run();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pollOnce]);

  // ── 초기 히스토리 로드(재방문 복원) ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/webchat/messages", { cache: "no-store" });
        if (res.status === 401) return; // 세션 없음 = 신규 방문자
        if (!res.ok) {
          let reason: string | undefined;
          try {
            reason = (await res.json())?.reason;
          } catch {
            /* noop */
          }
          applyReasonStatus(res, reason);
          return;
        }
        const data = (await res.json()) as { ok?: boolean; messages?: Msg[] };
        if (data.ok && Array.isArray(data.messages)) {
          setHasSession(true);
          hasSessionRef.current = true;
          mergeServerMessages(
            data.messages.map((m) => ({
              id: m.id,
              direction: m.direction,
              text: m.text,
              translatedText: m.translatedText ?? null,
              translationFailed: !!m.translationFailed,
              createdAt: m.createdAt,
            }))
          );
        }
      } catch {
        /* noop */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Turnstile 로드(사이트키 있을 때만) ──
  useEffect(() => {
    if (!turnstileSiteKey || hasSession) return;
    let rendered = false;
    const render = () => {
      if (rendered) return;
      const el = turnstileElRef.current;
      if (el && window.turnstile) {
        rendered = true;
        try {
          window.turnstile.render(el, {
            sitekey: turnstileSiteKey,
            callback: (token: string) => {
              turnstileTokenRef.current = token;
            },
            "error-callback": () => {
              turnstileTokenRef.current = null;
            },
          });
        } catch {
          /* noop */
        }
      }
    };
    if (window.turnstile) {
      render();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>("script[data-webchat-turnstile]");
    const s = existing ?? document.createElement("script");
    if (!existing) {
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      s.defer = true;
      s.setAttribute("data-webchat-turnstile", "1");
      document.head.appendChild(s);
    }
    s.addEventListener("load", render);
    const iv = setInterval(render, 400);
    const stop = setTimeout(() => clearInterval(iv), 8000);
    return () => {
      s.removeEventListener("load", render);
      clearInterval(iv);
      clearTimeout(stop);
    };
  }, [turnstileSiteKey, hasSession]);

  // ── 언어 칩 선택 ──
  const onPickLocale = useCallback((next: WebChatLocale) => {
    setLocale(next);
    localeRef.current = next;
    try {
      window.localStorage.setItem(LS_LOCALE, next);
      // p-locale 쿠키 갱신(1년) — 동일 오리진이라 intro 정적 페이지와도 공유.
      document.cookie = `p-locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      /* noop */
    }
  }, []);

  // ── 발신 ──
  const doSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (text.length > MSG_MAX_LEN) return;
    if (status !== "active") return;

    const isFirst = !hasSessionRef.current;
    const tmpId = `tmp-${Date.now()}`;
    const optimistic: Msg = {
      id: tmpId,
      direction: "INBOUND",
      text,
      translatedText: null,
      translationFailed: false,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setSending(true);
    setTransientError(null);
    lastActivityRef.current = Date.now();

    try {
      const res = await fetch("/api/webchat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          text,
          locale: localeRef.current,
          sourcePage: sourcePage || undefined,
          turnstileToken: isFirst ? turnstileTokenRef.current ?? undefined : undefined,
        }),
      });

      if (!res.ok) {
        let reason: string | undefined;
        try {
          reason = (await res.json())?.reason;
        } catch {
          /* noop */
        }
        // 상태성 오류는 배너로, 일시 오류는 메시지에 재시도 표식
        if (res.status === 503 || reason === "paused") setStatus("paused");
        else if (res.status === 410 || reason === "expired") {
          setStatus("expired");
        } else if (res.status === 403 && reason === "blocked") setStatus("blocked");
        else if (res.status === 429 || reason === "throttled")
          setTransientError(t.throttled);
        else if (res.status === 403 && reason === "turnstile") {
          setTransientError(t.sendFailed);
          turnstileTokenRef.current = null;
        } else setTransientError(t.sendFailed);
        // 낙관적 버블에 실패 표식
        setMessages((prev) =>
          prev.map((m) => (m.id === tmpId ? { ...m, pending: false, sendError: true } : m))
        );
        return;
      }

      const data = (await res.json()) as {
        ok?: boolean;
        sessionId?: string;
        message?: { id: string; createdAt: string };
      };
      if (data.ok && data.message) {
        setHasSession(true);
        hasSessionRef.current = true;
        // 낙관적 버블을 서버 확정값으로 교체
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tmpId
              ? {
                  ...m,
                  id: data.message!.id,
                  createdAt: data.message!.createdAt,
                  pending: false,
                }
              : m
          )
        );
        if (data.message.createdAt > (lastCreatedRef.current ?? "")) {
          lastCreatedRef.current = data.message.createdAt;
          try {
            window.localStorage.setItem(LS_LAST_SEEN, data.message.createdAt);
          } catch {
            /* noop */
          }
        }
        if (isFirst) {
          setShowAfterSend(true);
          setShowContact(true);
        }
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === tmpId ? { ...m, pending: false, sendError: true } : m))
        );
        setTransientError(t.sendFailed);
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === tmpId ? { ...m, pending: false, sendError: true } : m))
      );
      setTransientError(t.sendFailed);
    } finally {
      setSending(false);
    }
  }, [input, sending, status, sourcePage, t]);

  // ── 연락처 저장 ──
  const [contactZalo, setContactZalo] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const doSaveContact = useCallback(async () => {
    const zalo = contactZalo.trim();
    const email = contactEmail.trim();
    if (!zalo && !email) return;
    setSavingContact(true);
    try {
      const res = await fetch("/api/webchat/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          zalo: zalo || undefined,
          email: email || undefined,
        }),
      });
      if (res.ok) {
        setShowContact(false);
        setContactSaved(true);
      } else {
        setTransientError(t.sendFailed);
      }
    } catch {
      setTransientError(t.sendFailed);
    } finally {
      setSavingContact(false);
    }
  }, [contactZalo, contactEmail, t]);

  // ── 닫기(부모 로더에 postMessage) ──
  const doClose = useCallback(() => {
    try {
      window.parent?.postMessage("webchat:close", "*");
    } catch {
      /* noop */
    }
  }, []);

  // ── 새 대화(만료 후) ──
  const doNewChat = useCallback(() => {
    setStatus("active");
    setMessages([]);
    setHasSession(false);
    hasSessionRef.current = false;
    lastCreatedRef.current = null;
    setShowAfterSend(false);
    setShowContact(false);
    setContactSaved(false);
    try {
      window.localStorage.removeItem(LS_LAST_SEEN);
    } catch {
      /* noop */
    }
  }, []);

  const disabled = status !== "active";

  // ───────────────────────── 렌더 ─────────────────────────
  return (
    <div className="wc-root">
      <style>{CSS}</style>

      {/* 헤더 */}
      <header className="wc-header">
        <div className="wc-head-top">
          <div className="wc-brand">
            <span className="wc-logo" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 64 64">
                <rect width="64" height="64" rx="15" fill="#0F9488" />
                <path
                  d="M32 8c-9.4 0-17 7.4-17 16.5C15 37 32 56 32 56S49 37 49 24.5C49 15.4 41.4 8 32 8z"
                  fill="#fff"
                />
                <path d="M32 17l-9 8h2.5v9h5v-5.5h3V34h5v-9H41l-9-8z" fill="#0F9488" />
                <circle cx="35.5" cy="21.5" r="2.4" fill="#F5990E" />
              </svg>
            </span>
            <div className="wc-brand-txt">
              <strong>Villa GO</strong>
              <span>{t.headerSubtitle}</span>
            </div>
          </div>
          {!standalone && (
            <button type="button" className="wc-close" aria-label="close" onClick={doClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="wc-langs" role="group" aria-label="language">
          {WEBCHAT_LOCALES.map((lc) => (
            <button
              key={lc}
              type="button"
              className={`wc-chip${lc === locale ? " on" : ""}`}
              aria-pressed={lc === locale}
              onClick={() => onPickLocale(lc)}
            >
              {LOCALE_CHIP_LABEL[lc]}
            </button>
          ))}
        </div>
      </header>

      {/* 메시지 리스트 */}
      <div className="wc-list" ref={listRef}>
        {/* 인사(시스템) */}
        <div className="wc-row left">
          <div className="wc-bubble sys">{t.greeting}</div>
        </div>

        {messages.map((m) => {
          if (m.direction === "INBOUND") {
            return (
              <div key={m.id} className="wc-row right">
                <div className={`wc-bubble me${m.sendError ? " err" : ""}${m.pending ? " pend" : ""}`}>
                  <LinkifiedText text={m.text} />
                  {m.sendError && <span className="wc-retry-tag">!</span>}
                </div>
              </div>
            );
          }
          // OUTBOUND: 번역문 주표시, 실패 시 원문+안내, 성공 시 원문 토글
          const hasTranslation = !!m.translatedText && !m.translationFailed;
          const primary = hasTranslation ? m.translatedText! : m.text;
          const isOpen = !!expanded[m.id];
          return (
            <div key={m.id} className="wc-row left">
              <div className="wc-bubble them">
                <LinkifiedText text={primary} />
                {m.translationFailed && <div className="wc-note">{t.translationFailed}</div>}
                {hasTranslation && (
                  <>
                    <button
                      type="button"
                      className="wc-toggle"
                      onClick={() => setExpanded((e) => ({ ...e, [m.id]: !e[m.id] }))}
                    >
                      {isOpen ? t.hideOriginal : t.showOriginal}
                    </button>
                    {isOpen && (
                      <div className="wc-orig">
                        <LinkifiedText text={m.text} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* 첫 발신 후 시스템 버블 */}
        {showAfterSend && (
          <div className="wc-row left">
            <div className="wc-bubble sys">
              <div>{t.afterSendNotice}</div>
              <div className="wc-note">{t.offlineNotice}</div>
              {!showContact && !contactSaved && (
                <button type="button" className="wc-cta" onClick={() => setShowContact(true)}>
                  {t.leaveContact}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 연락처 카드 */}
        {showContact && (
          <div className="wc-row left">
            <div className="wc-bubble sys wc-contact">
              <strong>{t.contactTitle}</strong>
              <input
                className="wc-input-sm"
                type="text"
                inputMode="tel"
                placeholder={t.contactZalo}
                value={contactZalo}
                onChange={(e) => setContactZalo(e.target.value)}
              />
              <input
                className="wc-input-sm"
                type="email"
                placeholder={t.contactEmail}
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
              <div className="wc-contact-btns">
                <button
                  type="button"
                  className="wc-cta"
                  disabled={savingContact || (!contactZalo.trim() && !contactEmail.trim())}
                  onClick={doSaveContact}
                >
                  {t.contactSave}
                </button>
                <button type="button" className="wc-cta ghost" onClick={() => setShowContact(false)}>
                  {t.contactSkip}
                </button>
              </div>
            </div>
          </div>
        )}

        {contactSaved && (
          <div className="wc-row left">
            <div className="wc-bubble sys">{t.contactSaved}</div>
          </div>
        )}

        {/* 상태 배너(만료 시 새 대화 버튼) */}
        {status === "expired" && (
          <div className="wc-row left">
            <div className="wc-bubble sys">
              <div>{t.expired}</div>
              <button type="button" className="wc-cta" onClick={doNewChat}>
                {t.newChat}
              </button>
            </div>
          </div>
        )}
        {status === "paused" && (
          <div className="wc-row left">
            <div className="wc-bubble sys">{t.paused}</div>
          </div>
        )}
        {status === "blocked" && (
          <div className="wc-row left">
            <div className="wc-bubble sys">{t.blocked}</div>
          </div>
        )}
      </div>

      {/* 일시 오류(스로틀 등) */}
      {transientError && <div className="wc-toast">{transientError}</div>}

      {/* Turnstile(사이트키 있고 세션 전) */}
      {turnstileSiteKey && !hasSession && <div className="wc-turnstile" ref={turnstileElRef} />}

      {/* 입력창 */}
      <div className="wc-composer">
        <textarea
          className="wc-input"
          rows={1}
          maxLength={MSG_MAX_LEN}
          placeholder={t.placeholder}
          value={input}
          disabled={disabled || sending}
          onChange={(e) => setInput(e.target.value)}
          onFocus={scrollToBottom}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void doSend();
            }
          }}
        />
        <button
          type="button"
          className="wc-send"
          aria-label={t.send}
          disabled={disabled || sending || input.trim().length === 0}
          onClick={() => void doSend()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3.4 20.4l17.5-8.4a1 1 0 000-1.8L3.4 1.8A1 1 0 002 2.9l1.9 6.9L14 12 3.9 14.2 2 21.1a1 1 0 001.4 1.3z" />
          </svg>
        </button>
      </div>

      {/* PII 고지 */}
      <div className="wc-pii">{t.pii}</div>
    </div>
  );
}

// ───────────────────────── 스타일(라이트 고정 · 위젯 스코프) ─────────────────────────

const CSS = `
.wc-root{
  --teal:#0F9488; --teal-deep:#093B36; --teal-soft:#DCEEEB;
  --paper:#F7FAF9; --card:#FFFFFF; --ink:#22403C; --ink-soft:#5C7773; --line:#D8E6E3;
  position:fixed; inset:0; display:flex; flex-direction:column;
  background:var(--paper); color:var(--ink);
  font-family:'Be Vietnam Pro','Public Sans','Noto Sans KR','Segoe UI',system-ui,-apple-system,sans-serif;
  font-size:15px; line-height:1.5;
}
.wc-root *{box-sizing:border-box}
.wc-header{background:var(--teal-deep); color:#fff; padding:12px 14px 10px; flex:0 0 auto}
.wc-head-top{display:flex; align-items:center; justify-content:space-between; gap:10px}
.wc-brand{display:flex; align-items:center; gap:10px; min-width:0}
.wc-logo{flex:0 0 auto; display:flex}
.wc-brand-txt{display:flex; flex-direction:column; min-width:0}
.wc-brand-txt strong{font-size:16px; font-weight:800; letter-spacing:.01em}
.wc-brand-txt span{font-size:12px; color:#BFE0DB; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.wc-close{appearance:none; border:0; background:transparent; color:rgba(255,255,255,.85); cursor:pointer; padding:4px; border-radius:8px; display:flex}
.wc-close:hover{background:rgba(255,255,255,.12)}
.wc-langs{display:flex; gap:6px; margin-top:10px; flex-wrap:wrap}
.wc-chip{appearance:none; border:1px solid rgba(255,255,255,.28); background:transparent; color:rgba(255,255,255,.8);
  font:inherit; font-size:12px; font-weight:700; padding:4px 11px; border-radius:99px; cursor:pointer; letter-spacing:.03em}
.wc-chip.on{background:#fff; color:var(--teal-deep); border-color:#fff}
.wc-chip:focus-visible{outline:2px solid #F5990E; outline-offset:1px}

.wc-list{flex:1 1 auto; overflow-y:auto; padding:14px 12px; display:flex; flex-direction:column; gap:8px; -webkit-overflow-scrolling:touch}
.wc-row{display:flex}
.wc-row.left{justify-content:flex-start}
.wc-row.right{justify-content:flex-end}
.wc-bubble{max-width:82%; padding:9px 12px; border-radius:14px; word-break:break-word; white-space:pre-wrap}
.wc-bubble.me{background:var(--teal); color:#fff; border-bottom-right-radius:5px}
.wc-bubble.me.pend{opacity:.6}
.wc-bubble.me.err{background:#B44; }
.wc-bubble.them{background:var(--card); border:1px solid var(--line); border-bottom-left-radius:5px}
.wc-bubble.sys{background:var(--teal-soft); color:var(--teal-deep); border-bottom-left-radius:5px}
.wc-retry-tag{margin-left:6px; font-weight:800}
.wc-note{margin-top:6px; font-size:12.5px; color:var(--ink-soft)}
.wc-toggle{appearance:none; border:0; background:transparent; color:var(--teal); font:inherit; font-size:12.5px; font-weight:700; padding:4px 0 0; cursor:pointer}
.wc-orig{margin-top:5px; padding-top:6px; border-top:1px dashed var(--line); font-size:14px; color:var(--ink-soft)}
.wc-link{color:var(--teal); text-decoration:underline; text-underline-offset:2px; word-break:break-all}
.wc-bubble.me .wc-link{color:#EAFBF8}
.wc-cta{margin-top:10px; appearance:none; border:0; background:var(--teal); color:#fff; font:inherit; font-weight:700; font-size:13.5px; padding:8px 14px; border-radius:10px; cursor:pointer}
.wc-cta.ghost{background:transparent; color:var(--ink-soft); border:1px solid var(--line)}
.wc-cta:disabled{opacity:.5; cursor:default}

.wc-contact{display:flex; flex-direction:column; gap:8px; max-width:88%}
.wc-contact strong{font-size:14px}
.wc-input-sm{appearance:none; border:1px solid var(--line); border-radius:9px; background:#fff; color:var(--ink); font:inherit; font-size:14px; padding:8px 10px}
.wc-input-sm:focus{outline:2px solid var(--teal); outline-offset:-1px}
.wc-contact-btns{display:flex; gap:8px}
.wc-contact-btns .wc-cta{margin-top:0}

.wc-toast{flex:0 0 auto; margin:0 12px; background:#FDECEA; color:#8A2A20; border:1px solid #F3C9C3; border-radius:9px; padding:8px 12px; font-size:13px}
.wc-turnstile{flex:0 0 auto; padding:8px 12px 0; display:flex; justify-content:center}

.wc-composer{flex:0 0 auto; display:flex; gap:8px; align-items:flex-end; padding:10px 12px calc(8px + env(safe-area-inset-bottom)); border-top:1px solid var(--line); background:var(--card)}
.wc-input{flex:1 1 auto; resize:none; max-height:120px; appearance:none; border:1px solid var(--line); border-radius:12px; background:var(--paper); color:var(--ink); font:inherit; font-size:15px; padding:10px 12px; line-height:1.4}
.wc-input:focus{outline:2px solid var(--teal); outline-offset:-1px}
.wc-input:disabled{opacity:.6}
.wc-send{flex:0 0 auto; appearance:none; border:0; width:42px; height:42px; border-radius:12px; background:var(--teal); color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center}
.wc-send:disabled{opacity:.4; cursor:default}
.wc-pii{flex:0 0 auto; padding:0 12px calc(8px + env(safe-area-inset-bottom)); font-size:11px; color:var(--ink-soft); text-align:center; background:var(--card)}
`;
