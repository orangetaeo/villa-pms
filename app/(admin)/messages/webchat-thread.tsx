"use client";

// 웹 채팅 스레드 뷰 (T-webchat-inbox) — 우측 패널
// INBOUND=왼쪽(원문 + ko 번역 병기, 없으면 원문만+미번역). OUTBOUND=오른쪽(ko + translationFailed 뱃지).
// 헤더: 언어·연락처·sourcePage·생성일·차단/해제 버튼. CLOSED/BLOCKED는 입력창 대신 상태 배너.
// 안전 렌더: dangerouslySetInnerHTML 미사용(텍스트만, whitespace-pre-wrap) — 위젯/인박스 공통 규약.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { type WebChatThreadData, type QuickLinkKind, localeBadge } from "./webchat-types";
import { SourcePageLabel } from "./webchat-source-badge";
import { WebChatBookingBar } from "./webchat-booking-bar";
import { WebChatQuickLinks } from "./webchat-quick-links";
import { Linkify } from "@/components/linkify";
import { WebChatLinkCard } from "@/components/webchat-link-card";
import { isWebChatCardKind, parseWebChatCardPayload, isSafeCardUrl } from "@/lib/webchat-card";

function msgTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function WebChatThread({
  thread,
  loading,
  sending,
  blocking,
  canCreateProposal,
  onBack,
  onSend,
  onToggleBlock,
  onLinkBooking,
  onUnlinkBooking,
  onSendLink,
  onSendProposal,
  onSendVilla,
}: {
  thread: WebChatThreadData | null;
  loading: boolean;
  sending: boolean;
  blocking: boolean;
  /** 제안 생성 권한(canSetPrice) — 제안 모달 B 섹션 게이트. */
  canCreateProposal: boolean;
  onBack: () => void;
  onSend: (text: string) => void;
  onToggleBlock: (nextBlocked: boolean) => void;
  onLinkBooking: (bookingId: string) => Promise<boolean>;
  onUnlinkBooking: () => Promise<boolean>;
  onSendLink: (kind: QuickLinkKind) => Promise<{ ok: boolean; error?: string }>;
  onSendProposal: (proposalId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 빌라 공유 발송 — 빌라 모달에서 선택한 villaId로 send-link(kind=villa). */
  onSendVilla: (villaId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useTranslations("adminWebchat");
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 새 메시지 도착·스레드 전환 시 맨 아래로.
  const lastId = thread?.messages[thread.messages.length - 1]?.id ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, thread?.id]);

  if (!thread) {
    // 로딩 중(모바일에서 선택됨)엔 전체폭으로 표시, 순수 빈 상태는 데스크톱에서만(모바일은 인박스 전체폭).
    return (
      <div
        className={
          loading
            ? "flex-1 flex items-center justify-center bg-slate-950/40 text-sm text-slate-500"
            : "flex-1 hidden lg:flex items-center justify-center bg-slate-950/40 text-sm text-slate-500"
        }
      >
        {loading ? t("loading") : t("selectSession")}
      </div>
    );
  }

  const blocked = thread.status === "BLOCKED";
  const closed = thread.status === "CLOSED";
  const canReply = thread.status === "OPEN";

  const contacts: { icon: string; label: string; value: string }[] = [];
  if (thread.contactEmail)
    contacts.push({ icon: "mail", label: t("contact.email"), value: thread.contactEmail });
  if (thread.contactZalo)
    contacts.push({ icon: "chat", label: t("contact.zalo"), value: thread.contactZalo });
  if (thread.contactKakao)
    contacts.push({ icon: "chat_bubble", label: t("contact.kakao"), value: thread.contactKakao });

  const submit = () => {
    const text = draft.trim();
    if (!text || sending || !canReply) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-950/40">
      {/* 헤더 */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-800 bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="lg:hidden shrink-0 mt-0.5 text-slate-400 hover:text-white"
              aria-label={t("back")}
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </button>
            <span
              className="w-9 h-9 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center font-black text-[11px] shrink-0"
              title={thread.visitorLocale}
            >
              {localeBadge(thread.visitorLocale)}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <SourcePageLabel sourcePage={thread.sourcePage} />
                <span className="text-[10px] font-bold text-slate-400 bg-slate-800 rounded px-1.5 py-0.5">
                  {t("lang")}: {thread.visitorLocale}
                </span>
                {blocked && (
                  <span className="text-[10px] font-bold text-red-400 bg-red-500/15 rounded px-1.5 py-0.5">
                    {t("blockedBadge")}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
                <span>{t("createdAt", { date: dateLabel(thread.createdAt) })}</span>
                {contacts.length === 0 ? (
                  <span>{t("contact.none")}</span>
                ) : (
                  contacts.map((c) => (
                    <span key={c.label} className="inline-flex items-center gap-1 text-slate-300">
                      <span className="material-symbols-outlined text-[13px] leading-none">
                        {c.icon}
                      </span>
                      {c.value}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onToggleBlock(!blocked)}
            disabled={blocking}
            className={
              blocked
                ? "shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                : "shrink-0 inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/20 disabled:opacity-50"
            }
          >
            <span className="material-symbols-outlined text-[15px] leading-none">
              {blocked ? "lock_open" : "block"}
            </span>
            {blocked ? t("block.unblock") : t("block.block")}
          </button>
        </div>

        {/* 예약 연결 배지 / 연결 버튼 */}
        <div className="mt-2.5">
          <WebChatBookingBar
            sessionId={thread.id}
            booking={thread.booking}
            onLink={onLinkBooking}
            onUnlink={onUnlinkBooking}
          />
        </div>
      </div>

      {/* 메시지 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-3">
        {thread.messages.length === 0 ? (
          <p className="text-center text-xs text-slate-500 py-8">{t("noMessages")}</p>
        ) : (
          thread.messages.map((m) =>
            m.direction === "INBOUND" ? (
              <div key={m.id} className="flex justify-start">
                <div className="max-w-[78%] rounded-2xl rounded-tl-sm bg-slate-800 px-3.5 py-2.5">
                  <p className="text-sm text-white whitespace-pre-wrap break-words">
                    <Linkify text={m.text} linkClassName="text-sky-300 underline underline-offset-2 break-all" />
                  </p>
                  {m.translatedText ? (
                    <p className="mt-1.5 pt-1.5 border-t border-slate-700/60 text-sm text-teal-300 whitespace-pre-wrap break-words">
                      <Linkify text={m.translatedText} linkClassName="text-teal-200 underline underline-offset-2 break-all" />
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] text-slate-500">{t("untranslated")}</p>
                  )}
                  <p className="mt-1 text-[10px] text-slate-500 text-right tabular-nums">
                    {msgTime(m.createdAt)}
                  </p>
                </div>
              </div>
            ) : (
              (() => {
                // OUTBOUND: kind 있으면 카드, 없으면 기존 텍스트(구 메시지·일반 답장 하위호환).
                // ── 빌라 공유 카드(kind=villa) — 간단정보+대표가 캡션(ko/번역) + payload.url 있으면 "상세 보기" ──
                //   다른 링크 카드와 달리 캡션(text/translatedText)을 그대로 노출하고, URL은 payload에만 있으면 버튼.
                if (m.kind === "villa") {
                  const villaUrl = m.payload?.url;
                  const showLink = !!villaUrl && isSafeCardUrl(villaUrl);
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[78%] flex flex-col items-end">
                        <div className="w-full rounded-2xl rounded-tr-sm border border-teal-500/40 bg-teal-950/40 px-3.5 py-3 flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5 text-sm font-bold text-white">
                            <span className="material-symbols-outlined text-[16px] leading-none text-teal-300">
                              villa
                            </span>
                            {t("card.villa")}
                          </div>
                          <p className="text-sm text-white whitespace-pre-wrap break-words">
                            {m.text}
                          </p>
                          {m.translatedText && (
                            <p className="pt-1.5 border-t border-teal-700/40 text-sm text-teal-200 whitespace-pre-wrap break-words">
                              {m.translatedText}
                            </p>
                          )}
                          {m.translationFailed && (
                            <p className="self-start text-[10px] font-bold text-amber-200 bg-amber-500/20 rounded px-1.5 py-0.5 inline-block">
                              {t("translationFailedBadge")}
                            </p>
                          )}
                          {showLink && (
                            <a
                              href={villaUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-0.5 inline-flex items-center gap-1 self-start rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white no-underline hover:bg-teal-500"
                            >
                              <span className="material-symbols-outlined text-[15px] leading-none">
                                open_in_new
                              </span>
                              {t("card.villaOpen")}
                            </a>
                          )}
                        </div>
                        <p className="mt-1 text-[10px] text-teal-200/80 tabular-nums">
                          {msgTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                }
                const card = isWebChatCardKind(m.kind)
                  ? parseWebChatCardPayload(m.payload)
                  : null;
                if (card && isWebChatCardKind(m.kind)) {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[78%] flex flex-col items-end">
                        <WebChatLinkCard
                          title={t(`card.${m.kind}`)}
                          subtitle={t("card.hint")}
                          openLabel={t("card.open")}
                          url={card.url}
                          className="w-full rounded-2xl rounded-tr-sm border border-blue-500/40 bg-blue-950/50 px-3.5 py-3 flex flex-col gap-1.5"
                          titleClassName="text-sm font-bold text-white"
                          subtitleClassName="text-[11px] text-blue-200/80"
                          buttonClassName="mt-0.5 inline-flex items-center gap-1 self-start rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white no-underline hover:bg-blue-500"
                        />
                        <p className="mt-1 text-[10px] text-blue-200/80 tabular-nums">
                          {msgTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[78%] rounded-2xl rounded-tr-sm bg-blue-600 px-3.5 py-2.5">
                      <p className="text-sm text-white whitespace-pre-wrap break-words">
                        <Linkify text={m.text} linkClassName="text-blue-100 underline underline-offset-2 break-all" />
                      </p>
                      {m.translationFailed && (
                        <p className="mt-1.5 text-[10px] font-bold text-amber-200 bg-amber-500/20 rounded px-1.5 py-0.5 inline-block">
                          {t("translationFailedBadge")}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-blue-200/80 text-right tabular-nums">
                        {msgTime(m.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })()
            )
          )
        )}
      </div>

      {/* 빠른 링크(열림 상태) — 제안 보내기는 항상, 예약 링크 3종은 연결된 세션만(내부 게이트) */}
      {canReply && (
        <div className="shrink-0 border-t border-slate-800">
          <WebChatQuickLinks
            sessionId={thread.id}
            hasBooking={!!thread.booking}
            canCreateProposal={canCreateProposal}
            defaultClientName={
              thread.contactZalo ?? thread.contactKakao ?? t("proposal.defaultClientName")
            }
            onSend={onSendLink}
            onSendProposal={onSendProposal}
            onSendVilla={onSendVilla}
          />
        </div>
      )}

      {/* 답장 or 상태 배너 */}
      {canReply ? (
        <div className="shrink-0 px-3 pb-3 pt-1 bg-slate-900">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder={t("composer.placeholder")}
              className="flex-1 resize-none bg-slate-800/60 border border-slate-700 text-sm rounded-lg px-3 py-2 max-h-32 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={submit}
              disabled={sending || draft.trim().length === 0}
              className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px] leading-none">send</span>
              {sending ? t("composer.sending") : t("composer.send")}
            </button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 px-4 py-3 border-t border-slate-800 bg-slate-900 text-center text-xs text-slate-400">
          {blocked ? t("banner.blocked") : closed ? t("banner.closed") : t("banner.notOpen")}
        </div>
      )}
    </div>
  );
}
