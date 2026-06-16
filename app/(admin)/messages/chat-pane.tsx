"use client";

// /messages 우측 대화창 (b14 RIGHT pane) — 헤더 + 스레드 + 입력 푸터 (ADR-0009)
// - 헤더 리디자인: 아바타(D8)+별명(D9)+상대타입 배지(D1)+번역언어 드롭다운(D7)
// - 첨부 메뉴(D2): 상대 타입별 가시성 — SUPPLIER=사진+빌라+정산 / CUSTOMER=사진+빌라+제안 / UNKNOWN=사진만
// - 공유 카드 버블(D3/D5): msgType별 렌더(photo / villa_share / proposal_share / settlement_share / text)
// - 읽음 처리: 대화 열람 시 PATCH MARK_READ (멱등)
// - 번역(D7): translateMode=OFF면 입력창 미리보기 숨김. VI/EN이면 해당 언어 미리보기.
// ★ 누수: 공유 후보 목록·카드 모두 마진·반대편 통화 미포함(서버 select 화이트리스트 + page.tsx 최소 필드).
//   상대 분류 컨트롤(b15 블록④): 헤더 드롭다운 재변경 + UNKNOWN 대화 상단 배너 → PATCH SET_COUNTERPARTY_TYPE.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ClassifyBanner, CounterpartyDropdown } from "./counterparty-control";
import { allowedShareKinds, isSellSideType } from "@/lib/zalo-counterparty";
import {
  VillaShareModal,
  ProposalShareModal,
  SettlementShareModal,
  NicknameModal,
} from "./share-modals";

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
}

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
    <section className="flex-1 flex flex-col bg-[#0F172A] min-w-0">
      <ChatHeaderBar conversationId={conversationId} header={header} t={t} router={router} />

      {/* 미분류 대화 분류 배너 (b15 블록④) — 분류 전엔 사진만 공유 가능, 여기서 바로 분류 */}
      {header.counterpartyType === "UNKNOWN" && (
        <div className="shrink-0 px-6 pt-4">
          <ClassifyBanner conversationId={conversationId} t={t} router={router} />
        </div>
      )}

      {/* 스레드 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-6 space-y-5">
        {messages.length === 0 ? (
          <p className="text-center text-xs text-slate-500 pt-8">{t("noMessages")}</p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} t={t} />)
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
        t={t}
        router={router}
      />
    </section>
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
    <header className="shrink-0 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-6 py-3 flex items-center justify-between gap-4">
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
    { mode: "OFF", label: t("translateMode.off"), icon: "translate_off", iconColor: "text-slate-500" },
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
          {mode === "OFF" ? "translate_off" : "translate"}
        </span>
        <span>{current.label}</span>
        <span className="material-symbols-outlined text-[16px] text-slate-500">expand_more</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl py-1.5 z-20">
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
  t,
}: {
  message: ChatMessage;
  t: ReturnType<typeof useTranslations>;
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

      {message.kind === "inbound" && <InboundBubble message={message} t={t} />}
      {message.kind === "outbound" && <OutboundBubble message={message} t={t} />}
      {message.kind === "system" && <SystemBubble message={message} t={t} />}
    </>
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

function InboundBubble({
  message,
  t,
}: {
  message: ChatMessage;
  t: ReturnType<typeof useTranslations>;
}) {
  const [showTranslation, setShowTranslation] = useState(true);
  return (
    <div className="flex items-end gap-2 max-w-[70%]">
      <InboundAvatar message={message} />
      <div>
        {message.msgType === "photo" && message.attachmentUrls.length > 0 ? (
          <PhotoCard urls={message.attachmentUrls} caption={message.text} inbound />
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
        <span className="text-[10px] text-slate-600 tabular-nums mt-1 inline-block">
          {message.time}
        </span>
      </div>
    </div>
  );
}

function OutboundBubble({
  message,
  t,
}: {
  message: ChatMessage;
  t: ReturnType<typeof useTranslations>;
}) {
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
  if (message.msgType === "photo" && message.attachmentUrls.length > 0) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] text-right">
          <PhotoCard urls={message.attachmentUrls} caption={message.text} />
          {statusLine}
        </div>
      </div>
    );
  }
  if (message.msgType === "villa_share") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] text-right">
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
          {statusLine}
        </div>
      </div>
    );
  }
  if (message.msgType === "proposal_share") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] text-right">
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
          {statusLine}
        </div>
      </div>
    );
  }
  if (message.msgType === "settlement_share") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] text-right">
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
          {statusLine}
        </div>
      </div>
    );
  }

  // 기본 텍스트 버블
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] text-right">
        <div className="bg-blue-600 rounded-xl rounded-br-sm px-4 py-3 inline-block text-left">
          <p className="text-sm text-white whitespace-pre-wrap break-words">{message.text}</p>
        </div>
        {statusLine}
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
  const wrap = inbound
    ? "bg-slate-800 rounded-xl rounded-bl-sm p-1.5 inline-block text-left overflow-hidden"
    : "bg-blue-600 rounded-xl rounded-br-sm p-1.5 inline-block text-left overflow-hidden";
  const captionColor = inbound ? "text-slate-300" : "text-blue-100";
  return (
    <div className={wrap}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urls[0]} alt="" className="rounded-lg w-56 h-36 object-cover" />
      {caption && <p className={`text-xs px-2 py-1.5 ${captionColor}`}>{caption}</p>}
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
      {/* overflow-hidden 제거: 첨부 메뉴(absolute bottom-full, 위로 뜸)가 잘리지 않게.
          rounded 시각은 유지 — 번역 미리보기 바에 rounded-b-xl + overflow-hidden을 직접 부여해
          하단 모서리만 클립(입력행 상단은 bg-transparent라 클립 불필요). */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl focus-within:border-blue-500 transition-colors">
        <div className="flex items-center gap-2 px-3 pt-3">
          <AttachMenu
            conversationId={conversationId}
            counterpartyType={counterpartyType}
            contactName={contactName}
            villaCandidates={villaCandidates}
            proposalCandidates={proposalCandidates}
            settlementCandidates={settlementCandidates}
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

function AttachMenu({
  conversationId,
  counterpartyType,
  contactName,
  villaCandidates,
  proposalCandidates,
  settlementCandidates,
  t,
  router,
}: {
  conversationId: string;
  counterpartyType: CounterpartyType;
  contactName: string;
  villaCandidates: VillaCandidate[];
  proposalCandidates: ProposalCandidate[];
  settlementCandidates: SettlementCandidate[];
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | "VILLA" | "PROPOSAL" | "SETTLEMENT">(null);
  const [submitting, setSubmitting] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

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

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full mb-2 w-52 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-20">
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
