"use client";

// /messages 우측 대화창 (b14 RIGHT pane) — 헤더 + 스레드 + 입력 푸터
// - 읽음 처리: 대화 열람 시 PATCH /api/zalo/conversations/[id] (멱등)
// - INBOUND: vi 원문 + ko 번역 병기(숨기기 토글)
// - 입력: ko 입력 + vi 미리보기(POST /api/zalo/translate) + 전송(POST /api/zalo/messages)
// - 48h 경과(windowOpen=false): 입력 비활성 + amber 경고 배너
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export interface ChatHeader {
  name: string;
  initials: string;
  connected: boolean;
  villaName: string | null;
}

export interface ChatMessage {
  id: string;
  kind: "inbound" | "outbound" | "system";
  text: string;
  translatedText: string | null;
  time: string;
  status: string;
  dayDivider: string | null;
  initials: string;
}

export function ChatPane({
  conversationId,
  header,
  messages,
  windowOpen,
  hasUnread,
}: {
  conversationId: string | null;
  header: ChatHeader | null;
  messages: ChatMessage[];
  windowOpen: boolean;
  hasUnread: boolean;
}) {
  const t = useTranslations("adminMessages");
  const router = useRouter();

  // 읽음 처리 — 대화 열람 + 미읽음 있을 때만 1회 (멱등). 성공 시 router.refresh로 뱃지 갱신.
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    if (markedRef.current === conversationId) return;
    markedRef.current = conversationId;
    void fetch(`/api/zalo/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "MARK_READ" }),
    })
      .then((res) => {
        if (res.ok) router.refresh();
      })
      .catch(() => {});
  }, [conversationId, hasUnread, router]);

  if (!conversationId || !header) {
    return (
      <section className="flex-1 flex flex-col items-center justify-center bg-[#0F172A] min-w-0 text-center px-6">
        <span className="material-symbols-outlined text-slate-700 text-5xl mb-3">forum</span>
        <p className="text-sm text-slate-500">{t("selectConversation")}</p>
      </section>
    );
  }

  return (
    <section className="flex-1 flex flex-col bg-[#0F172A] min-w-0">
      {/* 헤더 */}
      <header className="h-16 shrink-0 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between px-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center font-bold text-xs shrink-0">
            {header.initials}
          </div>
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-sm font-bold text-white truncate">{header.name}</span>
            {header.connected && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-500 text-[10px] font-bold shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {t("connected")}
              </span>
            )}
            {header.villaName && (
              <span className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800/50 text-slate-300 text-[10px] font-medium shrink-0">
                {header.villaName}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 스레드 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-6 space-y-5">
        {messages.length === 0 ? (
          <p className="text-center text-xs text-slate-500 pt-8">{t("noMessages")}</p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} t={t} />)
        )}
      </div>

      {/* 입력 푸터 */}
      <Composer conversationId={conversationId} windowOpen={windowOpen} t={t} router={router} />
    </section>
  );
}

function MessageBubble({
  message,
  t,
}: {
  message: ChatMessage;
  t: ReturnType<typeof useTranslations>;
}) {
  const [showTranslation, setShowTranslation] = useState(true);

  return (
    <>
      {message.dayDivider && (
        <div className="text-center">
          <span className="text-[10px] text-slate-600 bg-slate-800/50 px-3 py-1 rounded-full">
            {message.dayDivider}
          </span>
        </div>
      )}

      {message.kind === "inbound" && (
        <div className="flex items-end gap-2 max-w-[70%]">
          <div className="w-7 h-7 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center font-bold text-[10px] shrink-0">
            {message.initials}
          </div>
          <div>
            <div className="bg-slate-800 rounded-xl rounded-bl-sm px-4 py-3">
              <p className="text-sm text-slate-100 whitespace-pre-wrap break-words">
                {message.text}
              </p>
              {message.translatedText && showTranslation && (
                <div className="border-t border-slate-700 mt-2 pt-2 flex items-start justify-between gap-3">
                  <p className="text-sm text-slate-300 flex-1 whitespace-pre-wrap break-words">
                    {message.translatedText}
                    <span className="text-[9px] text-slate-500 font-bold ml-1.5 align-middle">
                      {t("translationLabel")}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowTranslation(false)}
                    title={t("hideTranslation")}
                    className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                  >
                    <span className="material-symbols-outlined text-[16px]">visibility_off</span>
                  </button>
                </div>
              )}
              {message.translatedText && !showTranslation && (
                <button
                  type="button"
                  onClick={() => setShowTranslation(true)}
                  className="border-t border-slate-700 mt-2 pt-2 text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">visibility</span>
                  {t("showTranslation")}
                </button>
              )}
            </div>
            <span className="text-[10px] text-slate-600 tabular-nums mt-1 inline-block">
              {message.time}
            </span>
          </div>
        </div>
      )}

      {message.kind === "outbound" && (
        <div className="flex justify-end">
          <div className="max-w-[70%] text-right">
            <div className="bg-blue-600 rounded-xl rounded-br-sm px-4 py-3 inline-block text-left">
              <p className="text-sm text-white whitespace-pre-wrap break-words">{message.text}</p>
            </div>
            <div className="text-[10px] text-slate-600 tabular-nums mt-1">
              {message.time} ·{" "}
              {message.status === "FAILED" ? (
                <span className="text-red-400">{t("statusFailed")}</span>
              ) : (
                t("statusSent")
              )}
            </div>
          </div>
        </div>
      )}

      {message.kind === "system" && (
        <div className="flex justify-end">
          <div className="max-w-[70%] text-right">
            <div className="border border-slate-700 bg-slate-800/40 rounded-xl px-4 py-3 inline-block text-left">
              <span className="inline-block bg-slate-700/80 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded mb-1.5">
                {t("systemBadge")}
              </span>
              <p className="text-sm text-slate-300 whitespace-pre-wrap break-words">
                {message.text}
              </p>
            </div>
            <div className="text-[10px] text-slate-600 tabular-nums mt-1">
              {message.time} · {t("statusAuto")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Composer({
  conversationId,
  windowOpen,
  t,
  router,
}: {
  conversationId: string;
  windowOpen: boolean;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState("");
  const [translating, setTranslating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 48h 경과 — 입력 비활성 + 경고 배너
  if (!windowOpen) {
    return (
      <footer className="shrink-0 border-t border-slate-800 bg-slate-900 px-6 py-4">
        <div className="flex items-center gap-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5 mb-3">
          <span className="material-symbols-outlined text-amber-500 text-[18px]">schedule</span>
          <p className="text-xs text-amber-200 font-medium">{t("windowClosedWarning")}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-800 rounded-xl flex items-center gap-3 px-4 py-3 opacity-60">
          <input
            disabled
            placeholder={t("windowClosedPlaceholder")}
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-slate-600 placeholder:text-slate-600 p-0"
          />
          <button
            disabled
            className="bg-slate-700 text-slate-500 text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 cursor-not-allowed shrink-0"
          >
            <span className="material-symbols-outlined text-sm">send</span>
            {t("send")}
          </button>
        </div>
      </footer>
    );
  }

  async function translate() {
    if (!text.trim()) {
      setPreview("");
      return;
    }
    setTranslating(true);
    setError(null);
    try {
      const res = await fetch("/api/zalo/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), target: "vi" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { translated: string };
        setPreview(data.translated);
      } else if (res.status === 503) {
        setPreview("");
        setError(t("translateUnavailable"));
      } else {
        setPreview("");
      }
    } catch {
      setPreview("");
    } finally {
      setTranslating(false);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/zalo/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, text: body }),
      });
      if (res.ok) {
        setText("");
        setPreview("");
        router.refresh();
      } else if (res.status === 409) {
        setError(t("windowClosedWarning"));
      } else {
        setError(t("sendFailed"));
      }
    } catch {
      setError(t("sendFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <footer className="shrink-0 border-t border-slate-800 bg-slate-900 px-6 py-4">
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden focus-within:border-blue-500 transition-colors">
        <div className="flex items-center gap-3 px-4 pt-3">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={translate}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t("inputPlaceholder")}
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-slate-100 placeholder:text-slate-500 p-0"
          />
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || sending}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors active:scale-95 shrink-0"
          >
            <span className="material-symbols-outlined text-sm">send</span>
            {t("send")}
          </button>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 mt-2 bg-slate-900/60 border-t border-slate-800">
          <span className="text-[10px] font-bold text-teal-400 shrink-0 uppercase tracking-wider">
            {t("previewLabel")}
          </span>
          <p className="text-xs text-slate-400 flex-1 truncate">
            {translating ? t("translating") : preview || t("previewEmpty")}
          </p>
          <button
            type="button"
            onClick={translate}
            title={t("retranslate")}
            className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
