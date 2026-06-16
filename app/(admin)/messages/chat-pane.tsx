"use client";

// /messages 우측 대화창 (b14 RIGHT pane) — 헤더 + 스레드 + 입력 푸터 (ADR-0009)
// - 헤더 리디자인: 아바타(D8)+별명(D9)+상대타입 배지(D1)+번역언어 드롭다운(D7)
// - 첨부 메뉴(D2): 상대 타입별 가시성 — SUPPLIER=사진+빌라+정산 / CUSTOMER=사진+빌라+제안 / UNKNOWN=사진만
// - 공유 카드 버블(D3/D5): msgType별 렌더(photo / villa_share / proposal_share / settlement_share / text)
// - 읽음 처리: 대화 열람 시 PATCH MARK_READ (멱등)
// - 번역(D7): translateMode=OFF면 입력창 미리보기 숨김. VI/EN이면 해당 언어 미리보기.
// ★ 누수: 공유 후보 목록·카드 모두 마진·반대편 통화 미포함(서버 select 화이트리스트 + page.tsx 최소 필드).
//   상대 분류 컨트롤(b15 블록④): 헤더 드롭다운 재변경 + UNKNOWN 대화 상단 배너 → PATCH SET_COUNTERPARTY_TYPE.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ClassifyBanner, CounterpartyDropdown } from "./counterparty-control";
import ChatPhotoLightbox from "./photo-lightbox";
import { allowedShareKinds, isSellSideType } from "@/lib/zalo-counterparty";
import {
  VillaShareModal,
  ProposalShareModal,
  SettlementShareModal,
  NicknameModal,
} from "./share-modals";

// 답글 대상 — 발송 시 quotedMessageId로 전송, 미리보기엔 발신자/본문 스냅샷.
export interface ReplyTarget {
  messageId: string;
  sender: string; // 미리보기 라벨(상대 이름 또는 "나")
  text: string; // 인용 본문(공유 카드는 라벨로 대체)
}

export type CounterpartyType =
  | "SUPPLIER"
  | "CUSTOMER"
  | "TRAVEL_AGENCY"
  | "LAND_AGENCY"
  | "UNKNOWN";
export type TranslateMode = "OFF" | "VI" | "EN";
export type ShareKind = "VILLA" | "PROPOSAL" | "SETTLEMENT";

// 분류 5종 i18n 라벨 키 (adminMessages.counterparty.*)
const COUNTERPARTY_LABEL_KEY: Record<CounterpartyType, string> = {
  SUPPLIER: "counterparty.supplier",
  CUSTOMER: "counterparty.customer",
  TRAVEL_AGENCY: "counterparty.travelAgency",
  LAND_AGENCY: "counterparty.landAgency",
  UNKNOWN: "counterparty.unknown",
};

export interface ChatHeader {
  name: string;
  initials: string;
  avatarUrl: string | null;
  connected: boolean;
  villaName: string | null;
  zaloOriginalName: string | null;
  counterpartyType: CounterpartyType;
  translateMode: TranslateMode;
  nickname: string;
}

export interface ChatMessage {
  id: string;
  kind: "inbound" | "outbound" | "system";
  msgType: string; // text | photo | villa_share | proposal_share | settlement_share
  text: string;
  translatedText: string | null;
  attachmentUrls: string[];
  time: string;
  status: string;
  dayDivider: string | null;
  avatarUrl: string | null;
  initials: string;
  // 답글 인용 스냅샷(R3-2) — 둘 중 하나라도 있으면 버블 위 인용 블록 렌더.
  quotedText: string | null;
  quotedSender: string | null;
  // 리액션 집계(R3-3) {HEART:2,...} — 있으면 버블 하단 배지.
  reactions: Record<string, number> | null;
}

// 리액션 아이콘 키 → 이모지 (picker·배지 표시). 키는 REACTION_KEYS(zca-js Reactions enum)와 동일.
// 서버에 없는 키가 와도(미래 확장) 배지엔 키 그대로 폴백 표시.
const REACTION_EMOJI: Record<string, string> = {
  HEART: "❤️",
  LIKE: "👍",
  HAHA: "😆",
  WOW: "😮",
  CRY: "😢",
  ANGRY: "😠",
};
// picker 노출 순서 — 위 맵 키 순서(REACTION_KEYS 6종 기준). 서버 검증이 단일 진실원.
const REACTION_PICKER_KEYS = Object.keys(REACTION_EMOJI);
const reactionEmoji = (key: string) => REACTION_EMOJI[key] ?? key;

// 공유 후보(page.tsx에서 누수 분기·최소 필드로 조회). VND 금액은 직렬화되어 string.
export interface VillaCandidate {
  id: string;
  name: string;
  complex: string | null;
  bedrooms: number;
  bathrooms: number;
  photoUrl: string | null;
  priceLabelKind: "supplierCostVnd" | "salePriceKrw" | "salePriceVnd";
  priceVnd: string | null; // 원가(SUPPLIER) 또는 판매가 VND(TRAVEL_AGENCY/LAND_AGENCY) — 점 표기
  priceKrw: number | null; // 고객 판매가(원, CUSTOMER)
}
export interface ProposalCandidate {
  id: string;
  clientName: string;
  villaNames: string[];
  currency: "KRW" | "VND";
  totalKrw: number | null;
  totalVnd: string | null;
  expiresInHours: number;
}
export interface SettlementCandidate {
  id: string;
  yearMonth: string;
  label: string;
  totalVnd: string;
  itemCount: number;
  status: string; // DRAFT | CONFIRMED | PAID
}

// 라이트박스 열기 핸들러 — PhotoCard(중첩 버블)에서 ChatPane 최상위로 전달용(컨텍스트).
// (props 드릴링 회피 + 라이트박스 오버레이는 z-index/스크롤잠금 위해 ChatPane에서 렌더)
const LightboxContext = createContext<((urls: string[], startIndex: number) => void) | null>(null);

export function ChatPane({
  conversationId,
  header,
  messages,
  windowOpen,
  hasUnread,
  villaCandidates,
  proposalCandidates,
  settlementCandidates,
}: {
  conversationId: string | null;
  header: ChatHeader | null;
  messages: ChatMessage[];
  windowOpen: boolean;
  hasUnread: boolean;
  villaCandidates: VillaCandidate[];
  proposalCandidates: ProposalCandidate[];
  settlementCandidates: SettlementCandidate[];
}) {
  const t = useTranslations("adminMessages");
  const router = useRouter();

  // ── 답글 대상 (R3-2) — 메시지에서 "답글" 클릭 시 Composer 위에 인용 미리보기 ──
  // 대화 전환 시 자동 해제(아래 effect). 미리보기엔 보낸이·본문 스냅샷만 보관.
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);

  // ── 라이트박스 (채팅 이미지 확대) ──
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const openLightbox = useCallback((urls: string[], startIndex: number) => {
    if (urls.length > 0) setLightbox({ urls, index: startIndex });
  }, []);

  // ── 자동 스크롤 + "새 메시지 ↓" 버튼 (Nike 채팅 패턴) ──
  const threadRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 사용자가 위로 스크롤해 과거를 보는 중인지 — 하단 근처(임계값 80px)이면 false.
  const atBottomRef = useRef(true);
  // 내가 방금 전송했는지 — true면 과거 보던 중이어도 무조건 하단으로(Composer가 set).
  const justSentRef = useRef(false);
  // 직전 렌더의 마지막 메시지 id·개수 — 폴링 refresh 후 새 메시지 유입 판단.
  const prevLastIdRef = useRef<string | null>(null);
  const prevCountRef = useRef(0);
  const prevConvRef = useRef<string | null>(null);
  const [showNewMsg, setShowNewMsg] = useState(false);

  const NEAR_BOTTOM_PX = 80;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setShowNewMsg(false);
  }, []);

  // 스크롤 위치 추적 — 하단 근처면 atBottom, 아니면(과거 열람 중) 자동 스크롤 보류.
  const onThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance <= NEAR_BOTTOM_PX;
    atBottomRef.current = near;
    if (near) setShowNewMsg(false);
  }, []);

  // Composer 전송 시 호출 — 다음 메시지 반영 때 무조건 하단으로.
  const markJustSent = useCallback(() => {
    justSentRef.current = true;
  }, []);

  // 메시지 목록 변화 감지 → 자동 스크롤 판단 (폴링 refresh·전송·대화 전환 모두 정합)
  useEffect(() => {
    const last = messages[messages.length - 1];
    const lastId = last?.id ?? null;
    const count = messages.length;
    const convChanged = prevConvRef.current !== conversationId;
    const grew = count > prevCountRef.current || (lastId !== null && lastId !== prevLastIdRef.current);

    if (convChanged) {
      // 대화를 새로 열면 항상 최하단으로(읽기 시작점).
      scrollToBottom("auto");
    } else if (justSentRef.current) {
      // 내가 전송 → 과거 보던 중이어도 무조건 하단.
      justSentRef.current = false;
      scrollToBottom("auto");
    } else if (grew) {
      // 새 메시지 수신: 하단 근처면 자동 스크롤, 위로 보던 중이면 "새 메시지" 버튼.
      if (atBottomRef.current) scrollToBottom("smooth");
      else setShowNewMsg(true);
    }

    prevLastIdRef.current = lastId;
    prevCountRef.current = count;
    prevConvRef.current = conversationId;
    // conversationId·messages 변화에만 반응 (scrollToBottom은 안정 ref)
  }, [conversationId, messages, scrollToBottom]);

  // 읽음 처리 — 대화 열람 중 미읽음이 생길 때마다 0으로. in-flight 가드만.
  const markingRef = useRef(false);
  useEffect(() => {
    if (!conversationId || !hasUnread || markingRef.current) return;
    markingRef.current = true;
    void fetch(`/api/zalo/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "MARK_READ" }),
    })
      .then((res) => {
        if (res.ok) router.refresh();
      })
      .catch(() => {})
      .finally(() => {
        markingRef.current = false;
      });
  }, [conversationId, hasUnread, router]);

  // 대화 전환 시 답글 대상 해제 — 다른 대화에 엉뚱한 인용이 남지 않도록.
  useEffect(() => {
    setReplyTarget(null);
  }, [conversationId]);

  if (!conversationId || !header) {
    // 모바일(<lg): 대화 미선택 시 인박스가 전체폭 → 빈 안내 pane 숨김. 데스크톱(lg:)만 표시.
    return (
      <section className="hidden lg:flex flex-1 flex-col items-center justify-center bg-[#0F172A] min-w-0 text-center px-6">
        <span className="material-symbols-outlined text-slate-700 text-5xl mb-3">forum</span>
        <p className="text-sm text-slate-500">{t("selectConversation")}</p>
      </section>
    );
  }

  return (
    <LightboxContext.Provider value={openLightbox}>
      <section className="flex-1 flex flex-col bg-[#0F172A] min-w-0">
        <ChatHeaderBar conversationId={conversationId} header={header} t={t} router={router} />

        {/* 미분류 대화 분류 배너 (b15 블록④) — 분류 전엔 사진만 공유 가능, 여기서 바로 분류 */}
        {header.counterpartyType === "UNKNOWN" && (
          <div className="shrink-0 px-6 pt-4">
            <ClassifyBanner conversationId={conversationId} t={t} router={router} />
          </div>
        )}

        {/* 스레드 — relative: "새 메시지 ↓" 플로팅 버튼 기준 */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={threadRef}
            onScroll={onThreadScroll}
            className="absolute inset-0 overflow-y-auto custom-scrollbar px-6 py-6 space-y-5"
          >
            {messages.length === 0 ? (
              <p className="text-center text-xs text-slate-500 pt-8">{t("noMessages")}</p>
            ) : (
              messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  conversationId={conversationId}
                  contactName={header.name}
                  onReply={setReplyTarget}
                  t={t}
                  router={router}
                />
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* 위로 스크롤 중 새 메시지 수신 시만 표시 → 클릭하면 최하단으로 */}
          {showNewMsg && (
            <button
              type="button"
              onClick={() => scrollToBottom("smooth")}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold pl-3.5 pr-3 py-2 shadow-lg shadow-blue-900/40 transition-colors active:scale-95"
            >
              {t("newMessage")}
              <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
            </button>
          )}
        </div>

        {/* 입력 푸터 */}
        <Composer
          conversationId={conversationId}
          windowOpen={windowOpen}
          translateMode={header.translateMode}
          counterpartyType={header.counterpartyType}
          contactName={header.name}
          villaCandidates={villaCandidates}
          proposalCandidates={proposalCandidates}
          settlementCandidates={settlementCandidates}
          replyTarget={replyTarget}
          onClearReply={() => setReplyTarget(null)}
          onSent={markJustSent}
          t={t}
          router={router}
        />
      </section>

      {/* 라이트박스 — 최상위 z-index, 배경/X/ESC 닫기 */}
      {lightbox && (
        <ChatPhotoLightbox
          urls={lightbox.urls}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </LightboxContext.Provider>
  );
}

// ════════════════════════ 헤더 ════════════════════════

function ChatHeaderBar({
  conversationId,
  header,
  t,
  router,
}: {
  conversationId: string;
  header: ChatHeader;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);

  async function saveNickname(value: string) {
    setNicknameSaving(true);
    try {
      const res = await fetch(`/api/zalo/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SET_NICKNAME", nickname: value.trim() || null }),
      });
      if (res.ok) {
        setNicknameOpen(false);
        router.refresh();
      }
    } catch {
      /* noop — 실패 시 모달 유지 */
    } finally {
      setNicknameSaving(false);
    }
  }

  return (
    <header className="relative z-30 shrink-0 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-6 py-3 flex items-center justify-between gap-4">
      {/* 좌측: (모바일) 뒤로가기 + 아바타 + 별명(편집) + 배지 + 연결/원본 */}
      <div className="flex items-center gap-3 min-w-0">
        {/* 모바일 전용 뒤로가기 — 목록(인박스)으로. 데스크톱(lg:)은 2-pane 유지라 숨김. */}
        <button
          type="button"
          onClick={() => router.push("/messages")}
          title={t("back")}
          aria-label={t("back")}
          className="lg:hidden -ml-1 w-9 h-9 rounded-lg text-slate-300 hover:bg-slate-800 flex items-center justify-center shrink-0 transition-colors"
        >
          <span className="material-symbols-outlined text-[22px]">arrow_back</span>
        </button>
        {header.avatarUrl && !avatarBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={header.avatarUrl}
            alt=""
            onError={() => setAvatarBroken(true)}
            className="w-9 h-9 rounded-full object-cover shrink-0 bg-slate-700"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center font-bold text-xs shrink-0">
            {header.initials}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-white truncate">{header.name}</span>
            <button
              type="button"
              onClick={() => setNicknameOpen(true)}
              title={t("nickname.edit")}
              className="text-slate-500 hover:text-blue-400 transition-colors shrink-0"
            >
              <span className="material-symbols-outlined text-[15px]">edit</span>
            </button>
            <CounterpartyDropdown
              conversationId={conversationId}
              type={header.counterpartyType}
              t={t}
              router={router}
            />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {header.connected && (
              <span className="flex items-center gap-1 text-green-500 text-[10px] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {t("connected")}
              </span>
            )}
            {header.connected && header.zaloOriginalName && (
              <span className="text-slate-600 text-[10px]">·</span>
            )}
            {header.zaloOriginalName && (
              <span className="text-slate-400 text-[10px] truncate">
                {t("zaloOriginalInline", { name: header.zaloOriginalName })}
              </span>
            )}
            {header.villaName && (
              <span className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800/50 text-slate-300 text-[10px] font-medium shrink-0">
                {header.villaName}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 우측: 번역언어 드롭다운 */}
      <div className="flex items-center gap-2 shrink-0">
        <TranslateDropdown
          conversationId={conversationId}
          mode={header.translateMode}
          t={t}
          router={router}
        />
      </div>

      {nicknameOpen && (
        <NicknameModal
          initial={header.nickname}
          zaloOriginalName={header.zaloOriginalName}
          onClose={() => setNicknameOpen(false)}
          onSubmit={saveNickname}
          submitting={nicknameSaving}
          t={t}
        />
      )}
    </header>
  );
}

function TranslateDropdown({
  conversationId,
  mode,
  t,
  router,
}: {
  conversationId: string;
  mode: TranslateMode;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const options: { mode: TranslateMode; label: string; icon: string; iconColor: string }[] = [
    { mode: "OFF", label: t("translateMode.off"), icon: "do_not_disturb_on", iconColor: "text-slate-500" },
    { mode: "VI", label: t("translateMode.vi"), icon: "translate", iconColor: "text-teal-400" },
    { mode: "EN", label: t("translateMode.en"), icon: "translate", iconColor: "text-teal-400" },
  ];
  const current = options.find((o) => o.mode === mode) ?? options[0];

  async function setMode(next: TranslateMode) {
    if (next === mode) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/zalo/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SET_TRANSLATE_MODE", mode: next }),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    } catch {
      /* noop */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className="flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-200 text-xs font-medium transition-colors disabled:opacity-50"
      >
        <span
          className={`material-symbols-outlined text-[16px] ${
            mode === "OFF" ? "text-slate-500" : "text-teal-400"
          }`}
        >
          {mode === "OFF" ? "do_not_disturb_on" : "translate"}
        </span>
        <span>{current.label}</span>
        <span className="material-symbols-outlined text-[16px] text-slate-500">expand_more</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl py-1.5 z-50">
            <p className="px-3 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {t("translateMode.heading")}
            </p>
            {options.map((o) => {
              const active = o.mode === mode;
              return (
                <button
                  key={o.mode}
                  type="button"
                  onClick={() => setMode(o.mode)}
                  className={
                    active
                      ? "w-full flex items-center justify-between px-3 py-2 text-sm text-white bg-slate-700/40 hover:bg-slate-700/60"
                      : "w-full flex items-center justify-between px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/60"
                  }
                >
                  <span className="flex items-center gap-2">
                    <span className={`material-symbols-outlined text-[16px] ${o.iconColor}`}>
                      {o.icon}
                    </span>
                    {o.label}
                  </span>
                  {active && (
                    <span className="material-symbols-outlined text-[18px] text-teal-400">
                      check
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════ 메시지 버블 ════════════════════════

function MessageBubble({
  message,
  conversationId,
  contactName,
  onReply,
  t,
  router,
}: {
  message: ChatMessage;
  conversationId: string;
  contactName: string;
  onReply: (target: ReplyTarget) => void;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
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
        <InboundBubble
          message={message}
          conversationId={conversationId}
          contactName={contactName}
          onReply={onReply}
          t={t}
          router={router}
        />
      )}
      {message.kind === "outbound" && (
        <OutboundBubble
          message={message}
          conversationId={conversationId}
          contactName={contactName}
          onReply={onReply}
          t={t}
          router={router}
        />
      )}
      {message.kind === "system" && <SystemBubble message={message} t={t} />}
    </>
  );
}

/** 답글 인용 블록 — 버블 위 작은 회색 박스(보낸이 + 본문 1~2줄). b14 slate 톤. */
function QuotedBlock({
  sender,
  text,
  align,
  t,
}: {
  sender: string | null;
  text: string;
  align: "left" | "right";
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      className={`mb-1 max-w-full rounded-lg border-l-2 border-slate-600 bg-slate-800/60 px-2.5 py-1.5 ${
        align === "right" ? "ml-auto text-left" : "text-left"
      }`}
    >
      <p className="text-[10px] font-bold text-slate-400 truncate">
        {sender ?? t("reply.you")}
      </p>
      <p className="text-[11px] text-slate-400 line-clamp-2 break-words">{text}</p>
    </div>
  );
}

/** 메시지 hover 액션(답글·리액션) — 버블 옆 작은 버튼군. 리액션은 6종 picker. */
function MessageActions({
  conversationId,
  messageId,
  replyTarget,
  align,
  onReply,
  t,
  router,
}: {
  conversationId: string;
  messageId: string;
  replyTarget: ReplyTarget;
  align: "left" | "right";
  onReply: (target: ReplyTarget) => void;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function react(icon: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setPickerOpen(false);
    try {
      const res = await fetch(`/api/zalo/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REACT", messageId, icon }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      // 400 REACTION_NOT_SUPPORTED(과거 메시지) → 안내, 502 → 발송 실패.
      let code: string | null = null;
      try {
        code = ((await res.json()) as { error?: string }).error ?? null;
      } catch {
        /* generic */
      }
      if (res.status === 400 && code === "REACTION_NOT_SUPPORTED") {
        setError(t("react.notSupported"));
      } else {
        setError(t("react.failed"));
      }
    } catch {
      setError(t("react.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`relative flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${
        align === "right" ? "flex-row-reverse" : ""
      }`}
    >
      {/* 답글 */}
      <button
        type="button"
        onClick={() => onReply(replyTarget)}
        disabled={busy}
        title={t("reply.action")}
        aria-label={t("reply.action")}
        className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 flex items-center justify-center transition-colors disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[16px]">reply</span>
      </button>
      {/* 리액션 picker 토글 */}
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        disabled={busy}
        title={t("react.action")}
        aria-label={t("react.action")}
        className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 flex items-center justify-center transition-colors disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[16px]">add_reaction</span>
      </button>

      {pickerOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
          <div
            className={`absolute bottom-full mb-1.5 z-50 flex items-center gap-0.5 rounded-full bg-slate-800 border border-slate-700 shadow-2xl px-1.5 py-1 ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {REACTION_PICKER_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => void react(key)}
                title={key}
                className="w-8 h-8 rounded-full hover:bg-slate-700 flex items-center justify-center text-[18px] transition-transform hover:scale-125"
              >
                {reactionEmoji(key)}
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <span
          className={`absolute top-full mt-1 whitespace-nowrap text-[10px] text-red-400 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {error}
        </span>
      )}
    </div>
  );
}

/** 리액션 배지 — reactions Json({HEART:2,...}) → 아이콘+카운트 칩. */
function ReactionBadges({
  reactions,
  align,
}: {
  reactions: Record<string, number> | null;
  align: "left" | "right";
}) {
  if (!reactions) return null;
  const entries = Object.entries(reactions).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 mt-1 ${align === "right" ? "justify-end" : ""}`}>
      {entries.map(([key, n]) => (
        <span
          key={key}
          className="inline-flex items-center gap-0.5 rounded-full bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200 tabular-nums"
        >
          <span className="text-[12px] leading-none">{reactionEmoji(key)}</span>
          {n}
        </span>
      ))}
    </div>
  );
}

function InboundAvatar({ message }: { message: ChatMessage }) {
  const [broken, setBroken] = useState(false);
  if (message.avatarUrl && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={message.avatarUrl}
        alt=""
        onError={() => setBroken(true)}
        className="w-7 h-7 rounded-full object-cover shrink-0 bg-slate-700"
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center font-bold text-[10px] shrink-0">
      {message.initials}
    </div>
  );
}

/** 메시지 → 답글 미리보기용 본문(공유/사진/파일은 라벨, 일반은 본문). */
function replyPreviewText(message: ChatMessage, t: ReturnType<typeof useTranslations>): string {
  switch (message.msgType) {
    case "photo":
      return t("preview.photo");
    case "file":
      return message.text || t("reply.fileFallback");
    case "villa_share":
      return t("preview.villaShare");
    case "proposal_share":
      return t("preview.proposalShare");
    case "settlement_share":
      return t("preview.settlementShare");
    default:
      return message.text;
  }
}

function InboundBubble({
  message,
  conversationId,
  contactName,
  onReply,
  t,
  router,
}: {
  message: ChatMessage;
  conversationId: string;
  contactName: string;
  onReply: (target: ReplyTarget) => void;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [showTranslation, setShowTranslation] = useState(true);
  const replyTarget: ReplyTarget = {
    messageId: message.id,
    sender: contactName,
    text: replyPreviewText(message, t),
  };
  return (
    <div className="group flex items-end gap-2 max-w-[80%]">
      <InboundAvatar message={message} />
      <div className="min-w-0">
        {(message.quotedText || message.quotedSender) && (
          <QuotedBlock
            sender={message.quotedSender}
            text={message.quotedText ?? ""}
            align="left"
            t={t}
          />
        )}
        {message.msgType === "photo" && message.attachmentUrls.length > 0 ? (
          <PhotoCard urls={message.attachmentUrls} caption={message.text} inbound />
        ) : message.msgType === "file" ? (
          <FileCard
            fileName={message.text}
            url={message.attachmentUrls[0] ?? null}
            inbound
            t={t}
          />
        ) : (
          <div className="bg-slate-800 rounded-xl rounded-bl-sm px-4 py-3">
            <p className="text-sm text-slate-100 whitespace-pre-wrap break-words">{message.text}</p>
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
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-slate-600 tabular-nums">{message.time}</span>
          <MessageActions
            conversationId={conversationId}
            messageId={message.id}
            replyTarget={replyTarget}
            align="left"
            onReply={onReply}
            t={t}
            router={router}
          />
        </div>
        <ReactionBadges reactions={message.reactions} align="left" />
      </div>
    </div>
  );
}

function OutboundBubble({
  message,
  conversationId,
  contactName,
  onReply,
  t,
  router,
}: {
  message: ChatMessage;
  conversationId: string;
  contactName: string;
  onReply: (target: ReplyTarget) => void;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const replyTarget: ReplyTarget = {
    messageId: message.id,
    sender: t("reply.you"),
    text: replyPreviewText(message, t),
  };
  const statusLine = (
    <div className="text-[10px] text-slate-600 tabular-nums mt-1">
      {message.time} ·{" "}
      {message.status === "FAILED" ? (
        <span className="text-red-400">{t("statusFailed")}</span>
      ) : (
        t("statusSent")
      )}
    </div>
  );

  // 공유 카드 버블 — msgType 분기 (D5). 저장 text는 발송 본문 그대로(이미 누수 필터됨).
  // 카드 본문(card)과 폭(maxW)만 분기로 만들고, 인용·상태·액션·리액션은 공통 셸에서 래핑.
  let card: ReactNode;
  let maxW = "max-w-[70%]";
  if (message.msgType === "photo" && message.attachmentUrls.length > 0) {
    card = <PhotoCard urls={message.attachmentUrls} caption={message.text} />;
  } else if (message.msgType === "file") {
    card = <FileCard fileName={message.text} url={message.attachmentUrls[0] ?? null} t={t} />;
  } else if (message.msgType === "villa_share") {
    maxW = "max-w-[78%]";
    card = (
      <ShareTextCard
        kind="villa"
        label={t("card.villaShare")}
        text={message.text}
        icon="villa"
        border="border-blue-500/40"
        headerBg="bg-blue-600/15 border-blue-500/30"
        iconColor="text-blue-400"
        titleColor="text-blue-300"
      />
    );
  } else if (message.msgType === "proposal_share") {
    maxW = "max-w-[78%]";
    card = (
      <ShareTextCard
        kind="proposal"
        label={t("card.proposalShare")}
        text={message.text}
        icon="description"
        border="border-indigo-500/40"
        headerBg="bg-indigo-500/10 border-indigo-500/30"
        iconColor="text-indigo-300"
        titleColor="text-indigo-200"
      />
    );
  } else if (message.msgType === "settlement_share") {
    maxW = "max-w-[78%]";
    card = (
      <ShareTextCard
        kind="settlement"
        label={t("card.settlementShare")}
        text={message.text}
        icon="receipt_long"
        border="border-amber-500/40"
        headerBg="bg-amber-500/10 border-amber-500/30"
        iconColor="text-amber-400"
        titleColor="text-amber-300"
      />
    );
  } else {
    // 기본 텍스트 버블
    card = (
      <div className="bg-blue-600 rounded-xl rounded-br-sm px-4 py-3 inline-block text-left">
        <p className="text-sm text-white whitespace-pre-wrap break-words">{message.text}</p>
      </div>
    );
  }

  return (
    <div className="group flex justify-end">
      <div className={`${maxW} text-right min-w-0`}>
        {(message.quotedText || message.quotedSender) && (
          <QuotedBlock
            sender={message.quotedSender}
            text={message.quotedText ?? ""}
            align="right"
            t={t}
          />
        )}
        {card}
        <div className="flex items-center justify-end gap-2">
          <MessageActions
            conversationId={conversationId}
            messageId={message.id}
            replyTarget={replyTarget}
            align="right"
            onReply={onReply}
            t={t}
            router={router}
          />
          {statusLine}
        </div>
        <ReactionBadges reactions={message.reactions} align="right" />
      </div>
    </div>
  );
}

function SystemBubble({
  message,
  t,
}: {
  message: ChatMessage;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] text-right">
        <div className="border border-slate-700 bg-slate-800/40 rounded-xl px-4 py-3 inline-block text-left">
          <span className="inline-block bg-slate-700/80 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded mb-1.5">
            {t("systemBadge")}
          </span>
          <p className="text-sm text-slate-300 whitespace-pre-wrap break-words">{message.text}</p>
        </div>
        <div className="text-[10px] text-slate-600 tabular-nums mt-1">
          {message.time} · {t("statusAuto")}
        </div>
      </div>
    </div>
  );
}

/** 사진 카드 버블 — 발신은 blue, 수신은 slate (b14) */
function PhotoCard({
  urls,
  caption,
  inbound = false,
}: {
  urls: string[];
  caption: string;
  inbound?: boolean;
}) {
  const openLightbox = useContext(LightboxContext);
  const wrap = inbound
    ? "bg-slate-800 rounded-xl rounded-bl-sm p-1.5 inline-block text-left overflow-hidden"
    : "bg-blue-600 rounded-xl rounded-br-sm p-1.5 inline-block text-left overflow-hidden";
  const captionColor = inbound ? "text-slate-300" : "text-blue-100";
  return (
    <div className={wrap}>
      {/* 클릭 → 라이트박스(원본 크기). 첫 장 기준, 여러 장이면 라이트박스에서 좌우 이동. */}
      <button
        type="button"
        onClick={() => openLightbox?.(urls, 0)}
        className="block relative rounded-lg overflow-hidden group cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={urls[0]}
          alt=""
          className="rounded-lg w-56 h-36 object-cover transition-transform group-hover:scale-[1.02]"
        />
        {/* 여러 장 표시 배지 */}
        {urls.length > 1 && (
          <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
            <span className="material-symbols-outlined text-[12px]">photo_library</span>
            {urls.length}
          </span>
        )}
      </button>
      {caption && <p className={`text-xs px-2 py-1.5 ${captionColor}`}>{caption}</p>}
    </div>
  );
}

/** 파일 카드 버블 — 파일 아이콘 + 파일명(text) + 다운로드 링크. 발신 blue, 수신 slate (b14). */
function FileCard({
  fileName,
  url,
  inbound = false,
  t,
}: {
  fileName: string;
  url: string | null;
  inbound?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const wrap = inbound
    ? "bg-slate-800 rounded-xl rounded-bl-sm px-3 py-2.5 inline-flex items-center gap-3 text-left w-[260px] max-w-full"
    : "bg-blue-600 rounded-xl rounded-br-sm px-3 py-2.5 inline-flex items-center gap-3 text-left w-[260px] max-w-full";
  const iconWrap = inbound ? "bg-slate-700 text-slate-200" : "bg-blue-500 text-white";
  const nameColor = inbound ? "text-slate-100" : "text-white";
  const linkColor = inbound
    ? "text-blue-400 hover:text-blue-300"
    : "text-blue-100 hover:text-white";
  return (
    <div className={wrap}>
      <span
        className={`material-symbols-outlined text-[22px] w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconWrap}`}
      >
        description
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium truncate ${nameColor}`}>{fileName}</p>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download
            className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold transition-colors ${linkColor}`}
          >
            <span className="material-symbols-outlined text-[14px]">download</span>
            {t("fileCard.download")}
          </a>
        )}
      </div>
    </div>
  );
}

/** 공유 텍스트 카드 — 헤더(아이콘+라벨) + 발송 본문(누수 필터된 그대로) */
function ShareTextCard({
  label,
  text,
  icon,
  border,
  headerBg,
  iconColor,
  titleColor,
}: {
  kind: "villa" | "proposal" | "settlement";
  label: string;
  text: string;
  icon: string;
  border: string;
  headerBg: string;
  iconColor: string;
  titleColor: string;
}) {
  return (
    <div
      className={`bg-slate-800 border ${border} rounded-xl rounded-br-sm overflow-hidden inline-block text-left w-[320px] max-w-full`}
    >
      <div className={`flex items-center gap-1.5 border-b px-3 py-1.5 ${headerBg}`}>
        <span className={`material-symbols-outlined text-[16px] ${iconColor}`}>{icon}</span>
        <span className={`text-[11px] font-bold uppercase tracking-wider ${titleColor}`}>
          {label}
        </span>
      </div>
      <div className="p-3">
        <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{text}</p>
      </div>
    </div>
  );
}

// ════════════════════════ Composer ════════════════════════

function Composer({
  conversationId,
  windowOpen,
  translateMode,
  counterpartyType,
  contactName,
  villaCandidates,
  proposalCandidates,
  settlementCandidates,
  replyTarget,
  onClearReply,
  onSent,
  t,
  router,
}: {
  conversationId: string;
  windowOpen: boolean;
  translateMode: TranslateMode;
  counterpartyType: CounterpartyType;
  contactName: string;
  villaCandidates: VillaCandidate[];
  proposalCandidates: ProposalCandidate[];
  settlementCandidates: SettlementCandidate[];
  replyTarget: ReplyTarget | null;
  onClearReply: () => void;
  onSent: () => void;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState("");
  const [translating, setTranslating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewEnabled = translateMode !== "OFF";
  const previewLabel = translateMode === "EN" ? t("previewLabelEn") : t("previewLabel");

  // 48h 경과 — 입력 비활성 + 경고 배너 (ADR-0006 D5.5에선 미발생이나 안전 보존)
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
    if (!previewEnabled || !text.trim()) {
      setPreview("");
      return;
    }
    setTranslating(true);
    setError(null);
    try {
      // 단일 진실원 — conversationId로 서버가 translateMode 조회(OFF면 빈 응답).
      const res = await fetch("/api/zalo/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), conversationId }),
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
      // 답글 대상이 있으면 quotedMessageId 포함(R3-2). 일반 발신이면 생략.
      const payload: Record<string, unknown> = { conversationId, text: body };
      if (replyTarget) payload.quotedMessageId = replyTarget.messageId;
      const res = await fetch("/api/zalo/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setText("");
        setPreview("");
        onClearReply();
        // 내가 전송 → 다음 메시지 반영 때 무조건 최하단으로(과거 보던 중이어도).
        onSent();
        router.refresh();
      } else if (res.status === 409) {
        setError(t("windowClosedWarning"));
      } else if (res.status === 400) {
        // QUOTE_NOT_SUPPORTED(과거 메시지 인용 불가) → 안내 후 답글 해제(일반 발신으로 재시도 유도).
        let code: string | null = null;
        try {
          code = ((await res.json()) as { error?: string }).error ?? null;
        } catch {
          /* generic */
        }
        if (code === "QUOTE_NOT_SUPPORTED") {
          setError(t("reply.notSupported"));
          onClearReply();
        } else {
          setError(t("sendFailed"));
        }
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
      {/* overflow-hidden 제거: 첨부 메뉴(absolute bottom-full, 위로 뜸)가 잘리지 않게.
          rounded 시각은 유지 — 번역 미리보기 바에 rounded-b-xl + overflow-hidden을 직접 부여해
          하단 모서리만 클립(입력행 상단은 bg-transparent라 클립 불필요). */}
      {/* 답글 인용 미리보기 — 답글 대상 있을 때만. 취소 버튼으로 해제. */}
      {replyTarget && (
        <div className="flex items-start gap-2 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 mb-2">
          <span className="material-symbols-outlined text-[16px] text-blue-400 mt-0.5 shrink-0">
            reply
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-blue-300 truncate">
              {t("reply.replyingTo", { name: replyTarget.sender })}
            </p>
            <p className="text-xs text-slate-400 line-clamp-2 break-words">{replyTarget.text}</p>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            title={t("reply.cancel")}
            aria-label={t("reply.cancel")}
            className="shrink-0 text-slate-500 hover:text-slate-200 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl focus-within:border-blue-500 transition-colors">
        <div className="flex items-center gap-2 px-3 pt-3">
          <AttachMenu
            conversationId={conversationId}
            counterpartyType={counterpartyType}
            contactName={contactName}
            villaCandidates={villaCandidates}
            proposalCandidates={proposalCandidates}
            settlementCandidates={settlementCandidates}
            onError={setError}
            t={t}
            router={router}
          />
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
        {/* 번역 미리보기 — OFF면 영역 자체를 미렌더 (D7.5).
            rounded-b-xl + overflow-hidden: 부모 overflow-hidden 제거에 따른 하단 모서리 클립 보존. */}
        {previewEnabled && (
          <div className="flex items-center gap-2 px-4 py-2.5 mt-2 bg-slate-900/60 border-t border-slate-800 rounded-b-xl overflow-hidden">
            <span className="text-[10px] font-bold text-teal-400 shrink-0 uppercase tracking-wider">
              {previewLabel}
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
        )}
      </div>
    </footer>
  );
}

// ════════════════════════ 첨부 메뉴 + 공유 흐름 ════════════════════════

// 파일 업로드 에러코드 → i18n 라벨 키. 미매핑 코드는 generic.
const FILE_ERROR_KEYS = new Set([
  "TOO_LARGE",
  "BLOCKED_TYPE",
  "IS_IMAGE",
  "NO_EXTENSION",
  "UPLOAD_FAILED",
]);

function AttachMenu({
  conversationId,
  counterpartyType,
  contactName,
  villaCandidates,
  proposalCandidates,
  settlementCandidates,
  onError,
  t,
  router,
}: {
  conversationId: string;
  counterpartyType: CounterpartyType;
  contactName: string;
  villaCandidates: VillaCandidate[];
  proposalCandidates: ProposalCandidate[];
  settlementCandidates: SettlementCandidate[];
  onError: (msg: string | null) => void;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | "VILLA" | "PROPOSAL" | "SETTLEMENT">(null);
  const [submitting, setSubmitting] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 가시성 (D2/R2-5) — 하드코딩 분기 대신 allowedShareKinds 헬퍼로 도출(분류 확장에 자동 대응).
  //  원가측(SUPPLIER)=사진+빌라+정산 / 판매가측(고객·여행사·랜드사)=사진+빌라+제안 / UNKNOWN=사진만
  const kinds = allowedShareKinds(counterpartyType);
  const canVilla = kinds.includes("VILLA");
  const canProposal = kinds.includes("PROPOSAL");
  const canSettlement = kinds.includes("SETTLEMENT");
  const locked = counterpartyType === "UNKNOWN";
  const typeLabel = t(COUNTERPARTY_LABEL_KEY[counterpartyType]);

  async function uploadPhoto(file: File) {
    setSubmitting(true);
    setOpen(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/zalo/conversations/${conversationId}/share`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) router.refresh();
    } catch {
      /* noop */
    } finally {
      setSubmitting(false);
    }
  }

  // 일반 파일(비이미지 문서 등) — type=FILE 강제. 에러코드별 안내를 onError로 입력 영역에 표시.
  async function uploadFile(file: File) {
    setSubmitting(true);
    setOpen(false);
    onError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", "FILE");
      const res = await fetch(`/api/zalo/conversations/${conversationId}/share`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      // 400 에러코드 → i18n 안내(매핑 없으면 generic).
      let code: string | null = null;
      try {
        const data = (await res.json()) as { error?: string };
        code = data.error ?? null;
      } catch {
        /* 본문 파싱 실패 → generic */
      }
      onError(code && FILE_ERROR_KEYS.has(code) ? t(`fileError.${code}`) : t("fileError.generic"));
    } catch {
      onError(t("fileError.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  async function shareJson(body: Record<string, unknown>) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/zalo/conversations/${conversationId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setModal(null);
        router.refresh();
      }
    } catch {
      /* noop */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={submitting}
        title={t("attach.button")}
        className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 flex items-center justify-center transition-colors"
      >
        <span className="material-symbols-outlined text-[20px]">add</span>
      </button>

      {/* 숨은 파일 입력 — 갤러리 / 카메라(촬영) */}
      <input
        ref={galleryRef}
        type="file"
        aria-label={t("attach.photo")}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadPhoto(f);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        aria-label={t("attach.camera")}
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadPhoto(f);
          e.target.value = "";
        }}
      />
      {/* 숨은 파일 입력 — 일반 파일(문서 등). accept 제한 없음(서버가 위험 확장자·크기 검증). */}
      <input
        ref={fileRef}
        type="file"
        aria-label={t("attach.file")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadFile(f);
          e.target.value = "";
        }}
      />

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full mb-2 w-52 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-50">
            <p className="px-3 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {t("attach.heading")}{" "}
              <span className="text-teal-400 normal-case">({typeLabel})</span>
            </p>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-700/60"
            >
              <span className="material-symbols-outlined text-[20px] text-blue-400">
                photo_library
              </span>
              {t("attach.photo")}
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-700/60"
            >
              <span className="material-symbols-outlined text-[20px] text-blue-400">
                photo_camera
              </span>
              {t("attach.camera")}
            </button>
            {/* 파일 — 상대 타입 무관 항상 표시(파일은 누수 무관). */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-700/60"
            >
              <span className="material-symbols-outlined text-[20px] text-blue-400">
                attach_file
              </span>
              {t("attach.file")}
            </button>

            {(canVilla || canProposal || canSettlement || locked) && (
              <div className="my-1 border-t border-slate-700/70" />
            )}

            {canVilla && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setModal("VILLA");
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-700/60"
              >
                <span className="material-symbols-outlined text-[20px] text-teal-400">villa</span>
                {t("attach.villa")}
              </button>
            )}
            {canProposal && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setModal("PROPOSAL");
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-700/60"
              >
                <span className="material-symbols-outlined text-[20px] text-blue-400">
                  description
                </span>
                {t("attach.proposal")}
              </button>
            )}
            {canSettlement && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setModal("SETTLEMENT");
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-700/60"
              >
                <span className="material-symbols-outlined text-[20px] text-amber-400">
                  receipt_long
                </span>
                {t("attach.settlement")}
              </button>
            )}
            {locked && (
              <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-amber-300 bg-amber-500/5">
                <span className="material-symbols-outlined text-[16px] text-amber-400">lock</span>
                {t("attach.lockedHint")}
              </div>
            )}
          </div>
        </>
      )}

      {/* 공유 선택 모달 */}
      {modal === "VILLA" && canVilla && (
        <VillaShareModal
          candidates={villaCandidates}
          counterparty={isSellSideType(counterpartyType) ? "CUSTOMER" : "SUPPLIER"}
          contactName={contactName}
          onClose={() => setModal(null)}
          onSubmit={(villaId) => void shareJson({ type: "VILLA", villaId })}
          submitting={submitting}
          t={t}
        />
      )}
      {modal === "PROPOSAL" && canProposal && (
        <ProposalShareModal
          candidates={proposalCandidates}
          contactName={contactName}
          onClose={() => setModal(null)}
          onSubmit={(proposalId) => void shareJson({ type: "PROPOSAL", proposalId })}
          submitting={submitting}
          t={t}
        />
      )}
      {modal === "SETTLEMENT" && canSettlement && (
        <SettlementShareModal
          candidates={settlementCandidates}
          contactName={contactName}
          onClose={() => setModal(null)}
          onSubmit={(settlementId) => void shareJson({ type: "SETTLEMENT", settlementId })}
          submitting={submitting}
          t={t}
        />
      )}
    </div>
  );
}
