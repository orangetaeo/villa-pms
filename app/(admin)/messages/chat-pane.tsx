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
  useLayoutEffect,
  useMemo,
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
  ShareLoadingModal,
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
  | "UNKNOWN"
  | "IGNORED"; // 개인/기타(업무 상대 아님) — 종착 분류, 배너 미노출
export type TranslateMode = "OFF" | "VI" | "EN";
export type ShareKind = "VILLA" | "PROPOSAL" | "SETTLEMENT";

// 분류 6종 i18n 라벨 키 (adminMessages.counterparty.*)
const COUNTERPARTY_LABEL_KEY: Record<CounterpartyType, string> = {
  SUPPLIER: "counterparty.supplier",
  CUSTOMER: "counterparty.customer",
  TRAVEL_AGENCY: "counterparty.travelAgency",
  LAND_AGENCY: "counterparty.landAgency",
  UNKNOWN: "counterparty.unknown",
  IGNORED: "counterparty.ignored",
};

export interface ChatHeader {
  name: string;
  initials: string;
  avatarUrl: string | null;
  connected: boolean;
  villaName: string | null;
  zaloOriginalName: string | null;
  counterpartyType: CounterpartyType;
  // 그룹(단톡방) 여부 — true면 수신 버블에 발신자별 이름·아바타 표시(S4 D4).
  isGroup: boolean;
  translateMode: TranslateMode;
  nickname: string;
}

// 그룹 @멘션 후보 — page.tsx parseGroupMembers 결과(이름·아바타·zaloId만, 누수 무관: 공개 프로필).
//  uid는 zca-js 멘션 메타의 uid(@All은 page에서 안 넘기고 입력창이 "-1"로 합성).
export interface GroupMember {
  zaloId: string;
  name: string | null;
  avatarUrl: string | null;
}

// zca-js 멘션 메타(서버 POST body의 mentions[]) — pos=본문 문자 오프셋, len="@이름" 토큰 길이,
//  uid=멤버 zaloId(@All="-1"). 본문(text)은 "@이름" 토큰을 포함한 채 전송된다.
export interface MentionData {
  pos: number;
  uid: string;
  len: number;
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
  // 그룹 수신 버블 발신자명(senderUid→groupMembers 해석, 미해석 시 senderUid 원문 폴백 R14).
  // 1:1·OUTBOUND·SYSTEM은 null(발신자명 불필요 — 기존 표시 그대로).
  senderName: string | null;
  // 인용 점프(Nike) — zaloMsgId는 이 버블의 점프 앵커, quotedMsgId는 인용 대상 원본의 zaloMsgId.
  // 둘이 일치하면 인용 클릭 시 원본으로 스크롤+하이라이트(없으면 인용 블록은 비클릭 스냅샷만).
  zaloMsgId: string | null;
  quotedMsgId: string | null;
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

/** 이름 → 이니셜 2자(@멘션 드롭다운 아바타 폴백). page.tsx initials와 동일 규칙. */
function memberInitials(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return n.slice(0, 2).toUpperCase();
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

// 라이트박스 열기 핸들러 — PhotoCard(중첩 버블)에서 ChatPane 최상위로 전달용(컨텍스트).
// (props 드릴링 회피 + 라이트박스 오버레이는 z-index/스크롤잠금 위해 ChatPane에서 렌더)
const LightboxContext = createContext<((urls: string[], startIndex: number) => void) | null>(null);

// 인용 클릭 → 원본 메시지로 스크롤+하이라이트(Nike). props 드릴링 회피용 컨텍스트.
// 인자는 인용 대상 원본의 zaloMsgId. 현재 로드 범위에 없으면 무동작(폴백).
const QuoteJumpContext = createContext<((targetMsgId: string) => void) | null>(null);

// 멘션 강조용 이름 목록(그룹 멤버명 + @전체 라벨 변형) — 버블 본문에서 "@이름"을 Zalo처럼 강조.
// 그룹 대화에서만 채워지고, 1:1은 빈 배열(강조 없음).
const MentionNamesContext = createContext<string[]>([]);

// perf #2: 채팅 내 변경(발신·리액션·공유·별명·번역·분류) 후 화면 갱신 신호.
//  - 레거시(MessagesClient 없이 단독 ChatPane): null → 각 사이트가 router.refresh()로 RSC 재조회.
//  - MessagesClient 하위: onMutated 주입 → 서버 왕복 없이 스레드+인박스 즉시 재fetch(클라이언트 전환).
// useMutationRefresh()는 onMutated가 있으면 그걸, 없으면 router.refresh()를 호출하는 함수를 반환.
const MutationContext = createContext<(() => void) | null>(null);
export function useMutationRefresh(router: ReturnType<typeof useRouter>): () => void {
  const onMutated = useContext(MutationContext);
  return useCallback(() => {
    if (onMutated) onMutated();
    else router.refresh();
  }, [onMutated, router]);
}

/** 정규식 특수문자 이스케이프. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 본문에서 "@이름"(그룹 멤버명/@전체)을 찾아 Zalo처럼 강조 렌더.
 * names 컨텍스트가 비었거나 "@"가 없으면 원문 그대로. 긴 이름 우선 매칭(부분 겹침 방지).
 * highlightClass로 버블 배경(어두운 slate / 파란 outbound)에 맞는 색을 받는다.
 */
function MentionText({
  text,
  highlightClass = "text-sky-400 font-medium",
}: {
  text: string;
  highlightClass?: string;
}) {
  const names = useContext(MentionNamesContext);
  if (!text || names.length === 0 || !text.includes("@")) return <>{text}</>;
  const escaped = names
    .filter(Boolean)
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length);
  if (escaped.length === 0) return <>{text}</>;
  const re = new RegExp(`@(?:${escaped.join("|")})`, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={key++} className={highlightClass}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
    if (re.lastIndex === m.index) re.lastIndex++; // 0길이 매칭 방지
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function ChatPane({
  conversationId,
  header,
  messages: initialMessages,
  hasOlder: initialHasOlder,
  oldestCursor: initialOldestCursor,
  windowOpen,
  hasUnread,
  groupMembers,
  loading = false,
  onBack,
  onMarkedRead,
  onMutated,
}: {
  conversationId: string | null;
  header: ChatHeader | null;
  // 초기 최근 80개(asc). 상단 스크롤 시 GET으로 이전 메시지를 받아 앞에 prepend(로컬 state로 누적).
  messages: ChatMessage[];
  // 더 과거 메시지 존재 여부 + 이전 더보기 커서(가장 오래된 로드 메시지 createdAt ISO).
  hasOlder: boolean;
  oldestCursor: string | null;
  windowOpen: boolean;
  hasUnread: boolean;
  // 그룹 @멘션 후보(그룹 아닐 땐 빈 배열) — Composer 입력창 드롭다운에 사용.
  groupMembers: GroupMember[];
  // perf #2: 클라이언트 전환 중 스레드 로딩(선택됐으나 thread 아직 미도착) — 빈 상태 대신 스피너.
  loading?: boolean;
  // perf #2: 모바일 뒤로가기/스와이프 → 인박스 복귀(있으면 router.push("/messages") 대신 호출).
  onBack?: () => void;
  // perf #2: MARK_READ PATCH 성공 시 로컬 인박스 unread=0 갱신(있으면 router.refresh() 대신 호출).
  onMarkedRead?: () => void;
  // perf #2: 발신·리액션·공유·별명·번역·분류 변경 후 즉시 갱신(있으면 router.refresh() 대신 스레드 재fetch).
  onMutated?: () => void;
}) {
  const t = useTranslations("adminMessages");
  const router = useRouter();

  // ── 이전 메시지 점진 로드 (성능 — 초기 80개만, 상단 스크롤 시 prepend) ──
  // prop(initialMessages)=최근 80개(asc, 폴링 refresh로 갱신). olderMessages=상단 GET으로 받은
  // 더 과거 메시지(asc) 누적. 최종 messages = [...older, ...initial] (id 중복 제거).
  // 이 구조라 폴링 refresh가 와도(새 메시지 유입) prepend된 과거가 보존되고 최신도 정합.
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  // 이전 더보기 커서 — 가장 오래된 "로드된" 메시지의 createdAt ISO. 초기엔 prop, prepend마다 갱신.
  const oldestCursorRef = useRef<string | null>(initialOldestCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // 대화 전환 시 prepend 누적·커서·hasOlder 리셋(다른 대화 과거가 남지 않도록).
  useEffect(() => {
    setOlderMessages([]);
    setHasOlder(initialHasOlder);
    oldestCursorRef.current = initialOldestCursor;
    // conversationId 변경 시에만 리셋. initialHasOlder/Cursor는 같은 대화 내 폴링으로도 바뀔 수 있으나
    // 그 경우(맨아래 최신 80개 갱신)엔 older 보존이 맞으므로 의존성에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // 최종 표시 메시지 = prepend된 과거(older) + prop 최근 80개. id 중복 제거(경계 안전).
  const messages = useMemo(() => {
    if (olderMessages.length === 0) return initialMessages;
    const seen = new Set(initialMessages.map((m) => m.id));
    const olderUnique = olderMessages.filter((m) => !seen.has(m.id));
    return [...olderUnique, ...initialMessages];
  }, [olderMessages, initialMessages]);

  // ── 답글 대상 (R3-2) — 메시지에서 "답글" 클릭 시 Composer 위에 인용 미리보기 ──
  // 대화 전환 시 자동 해제(아래 effect). 미리보기엔 보낸이·본문 스냅샷만 보관.
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);

  // ── 액션 버튼 가시성 (PC=호버 / 모바일=탭 토글) ──
  // 평소 숨김. PC는 group-hover로 표시(CSS). 터치 기기는 호버가 없으므로 버블을 탭하면
  // 해당 메시지 id를 활성화해 그 메시지의 액션만 표시(토글). null이면 모두 숨김.
  const [activeActionMessageId, setActiveActionMessageId] = useState<string | null>(null);
  // 버블 클릭 토글 — PC·모바일 공통. 버블을 클릭/탭하면 그 메시지 액션(답글·리액션)을
  // 표시하고, 같은 버블 재클릭 시 해제. PC는 호버(group-hover)로도 노출되며, 클릭하면 고정.
  const toggleActionMessage = useCallback((id: string) => {
    setActiveActionMessageId((cur) => (cur === id ? null : id));
  }, []);

  // ── 모바일 스와이프(오른쪽으로 밀기) → 리스트(인박스)로 (뒤로가기 버튼과 동일) ──
  // 세로 스크롤·입력창과 충돌 방지: 입력창에서 시작한 터치·세로 우세 제스처는 무시.
  // 데스크톱(lg+, 2-pane 상시)에선 비활성.
  const swipeStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onSwipeStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest("textarea, input, [contenteditable='true']")) {
      swipeStartRef.current = null; // 입력 중 커서 이동 제스처 보호
      return;
    }
    const tch = e.touches[0];
    swipeStartRef.current = { x: tch.clientX, y: tch.clientY, t: Date.now() };
  }, []);
  const onSwipeEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = swipeStartRef.current;
      swipeStartRef.current = null;
      if (!start) return;
      if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) return;
      const tch = e.changedTouches[0];
      if (!tch) return;
      const dx = tch.clientX - start.x;
      const dy = tch.clientY - start.y;
      const dt = Date.now() - start.t;
      // 오른쪽 ≥70px + 수평 우세(|dx|>|dy|*1.8) + 빠른 제스처(<600ms)
      if (dx >= 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && dt < 600) {
        // perf #2: onBack(클라이언트 전환)이 있으면 그걸로, 없으면 레거시 서버 네비게이션.
        if (onBack) onBack();
        else router.push("/messages");
      }
    },
    [router, onBack],
  );

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
  // 위로 많이 올라가면(하단에서 멀어지면) "맨 아래로" 버튼 표시 — 최신 메시지로 빠르게 복귀.
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const NEAR_BOTTOM_PX = 80;
  // "맨 아래로" 버튼 표시 임계 — 하단에서 이 이상 멀어지면 표시(근처 깜빡임 방지).
  const SCROLL_BTN_PX = 300;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setShowNewMsg(false);
    setShowScrollBottom(false);
  }, []);

  // 인용 클릭 → 원본 메시지로 스크롤+하이라이트(Nike 방식). targetMsgId = 원본 zaloMsgId.
  // 원본이 현재 로드 범위에 있으면 가운데로 스크롤 후 2초 링 하이라이트. 없으면(과거) 무동작.
  // 복귀(맨 아래)는 사용자가 직접 스크롤하거나 답글 전송 시 기존 justSent 로직이 담당.
  const scrollToMessage = useCallback((targetMsgId: string) => {
    const root = threadRef.current;
    if (!root || !targetMsgId) return;
    const el = root.querySelector<HTMLElement>(
      `[data-msg-id="${CSS.escape(targetMsgId)}"]`
    );
    if (!el) return; // 현재 범위 밖(과거 메시지) — 폴백: 무동작
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // 잠깐 하이라이트(Nike: ring 2초). 다크 톤 — blue 링.
    el.classList.add("ring-2", "ring-blue-500/60", "rounded-xl");
    window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-blue-500/60", "rounded-xl");
    }, 2000);
  }, []);

  // ── 이전 메시지 prepend 시 스크롤 위치 보존 ──
  // prepend 직전 scrollHeight를 기억 → DOM 갱신 후(useLayoutEffect) 늘어난 높이만큼 scrollTop 보정.
  // 사용자가 보던 메시지가 같은 화면 위치에 머물러 점프가 없게 한다(무한 위로 로딩의 표준 패턴).
  const pendingPrependRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el && pendingPrependRef.current !== null) {
      const delta = el.scrollHeight - pendingPrependRef.current;
      el.scrollTop += delta;
      pendingPrependRef.current = null;
    }
  }, [olderMessages]);

  // 이전 메시지 로드 — GET /api/zalo/messages?before=커서. 받은 older를 앞에 prepend(스크롤 보존).
  const loadingOlderRef = useRef(false);
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !conversationId || !hasOlder) return;
    const cursor = oldestCursorRef.current;
    if (!cursor) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const params = new URLSearchParams({ conversationId, before: cursor });
      const res = await fetch(`/api/zalo/messages?${params.toString()}`);
      if (!res.ok) return; // 실패는 조용히 — 다음 스크롤에 재시도
      const data = (await res.json()) as {
        messages: ChatMessage[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      if (data.messages.length > 0) {
        // prepend 직전 scrollHeight 기억(useLayoutEffect가 보정).
        const el = threadRef.current;
        pendingPrependRef.current = el ? el.scrollHeight : null;
        setOlderMessages((prev) => [...data.messages, ...prev]);
        oldestCursorRef.current = data.nextCursor ?? cursor;
      }
      setHasOlder(data.hasMore);
    } catch {
      /* noop — 다음 상단 스크롤에 재시도 */
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, hasOlder]);

  // 스크롤 위치 추적 — 하단 근처면 atBottom, 아니면(과거 열람 중) 자동 스크롤 보류.
  // 상단 근처(<80px) + hasOlder + 미로딩이면 이전 메시지 점진 로드(prepend).
  const onThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance <= NEAR_BOTTOM_PX;
    atBottomRef.current = near;
    if (near) setShowNewMsg(false);
    setShowScrollBottom(distance > SCROLL_BTN_PX);
    // 상단 근처에 닿으면 이전 메시지 로드(중복 호출은 loadOlder 내부 가드).
    if (el.scrollTop < NEAR_BOTTOM_PX && hasOlder && !loadingOlderRef.current) {
      void loadOlder();
    }
  }, [hasOlder, loadOlder]);

  // Composer 전송 시 호출 — 다음 메시지 반영 때 무조건 하단으로.
  const markJustSent = useCallback(() => {
    justSentRef.current = true;
  }, []);

  // 메시지 목록 변화 감지 → 자동 스크롤 판단 (폴링 refresh·전송·대화 전환 모두 정합)
  // useLayoutEffect: 대화 전환/전송 시 paint 전에 최하단으로 점프 → 위에서 아래로 스크롤되는 게
  // 보이지 않고 처음부터 최신 메시지가 보인다(useEffect면 top 1프레임 노출 후 점프).
  useLayoutEffect(() => {
    const last = messages[messages.length - 1];
    const lastId = last?.id ?? null;
    const count = messages.length;
    const convChanged = prevConvRef.current !== conversationId;
    // 신규 메시지 판단은 "마지막(최신) 메시지 id 변화"로만 — 이전 메시지 prepend는 count만 늘고
    // lastId는 그대로라 grew=false(스크롤 보존은 useLayoutEffect 담당, 자동 스크롤·새메시지 버튼 미발동).
    // 직전이 빈 목록(lastId=null)이었다가 채워진 경우(초기 로드)도 새 메시지로 간주.
    // 초기 채움 — 빈 목록(lastId=null)이 처음 채워짐. 클라 전환은 빈 마운트(로딩)→메시지 도착 2단계라
    // convChanged가 빈 단계에서 소진되고, 채워질 땐 이 케이스로 온다. 반드시 즉시(auto) 점프해야
    // smooth 애니메이션(위→아래 스크롤)이 안 보인다.
    const initialFill = prevLastIdRef.current === null && count > 0;
    // 새 메시지(최신 id 변화) — prepend(과거 로드)는 lastId 불변이라 미발동.
    const grew = lastId !== null && lastId !== prevLastIdRef.current;

    if (convChanged || initialFill) {
      // 대화를 새로 열면(또는 로딩 후 첫 채움) 항상 최하단으로 즉시 점프(읽기 시작점).
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
        if (res.ok) {
          // perf #2: 클라이언트 전환 시 로컬 인박스 unread=0(폴링이 서버 정합 보장). 없으면 레거시 refresh.
          if (onMarkedRead) onMarkedRead();
          else router.refresh();
        }
      })
      .catch(() => {})
      .finally(() => {
        markingRef.current = false;
      });
  }, [conversationId, hasUnread, router, onMarkedRead]);

  // 대화 전환 시 답글 대상·활성 액션 해제 — 다른 대화에 엉뚱한 인용/액션이 남지 않도록.
  useEffect(() => {
    setReplyTarget(null);
    setActiveActionMessageId(null);
  }, [conversationId]);

  if (!conversationId || !header) {
    // perf #2: 대화는 선택됐으나 스레드 로딩 중(클라이언트 전환) — 빈 안내 대신 스피너.
    //   모바일에선 선택 즉시 인박스가 숨고 이 pane이 전체폭이 되므로, 로딩 중엔 flex(표시)로 둔다.
    if (conversationId && loading) {
      return (
        <section className="flex flex-1 flex-col items-center justify-center bg-[#0F172A] min-w-0 text-center px-6">
          <span className="material-symbols-outlined text-slate-600 text-4xl mb-2 animate-spin">
            progress_activity
          </span>
        </section>
      );
    }
    // 모바일(<lg): 대화 미선택 시 인박스가 전체폭 → 빈 안내 pane 숨김. 데스크톱(lg:)만 표시.
    return (
      <section className="hidden lg:flex flex-1 flex-col items-center justify-center bg-[#0F172A] min-w-0 text-center px-6">
        <span className="material-symbols-outlined text-slate-700 text-5xl mb-3">forum</span>
        <p className="text-sm text-slate-500">{t("selectConversation")}</p>
      </section>
    );
  }

  // 멘션 강조 이름 — 그룹이면 멤버명 + @전체 라벨 변형. 버블 본문 "@이름"을 Zalo처럼 강조(MentionText).
  const mentionNames = header?.isGroup
    ? [
        ...groupMembers.map((m) => m.name).filter((n): n is string => !!n),
        "전체",
        "Tất cả",
        "tất cả",
        "All",
        "all",
        "모두",
      ]
    : [];

  return (
    <LightboxContext.Provider value={openLightbox}>
      <QuoteJumpContext.Provider value={scrollToMessage}>
      <MentionNamesContext.Provider value={mentionNames}>
      <MutationContext.Provider value={onMutated ?? null}>
      <section
        className="flex-1 flex flex-col bg-[#0F172A] min-w-0 overflow-x-clip"
        onTouchStart={onSwipeStart}
        onTouchEnd={onSwipeEnd}
      >
        <ChatHeaderBar conversationId={conversationId} header={header} t={t} router={router} onBack={onBack} />

        {/* 미분류 대화 분류 배너 (b15 블록④) — 분류 전엔 사진만 공유 가능, 여기서 바로 분류 */}
        {header.counterpartyType === "UNKNOWN" && (
          <div className="shrink-0 px-6 pt-4">
            <ClassifyBanner conversationId={conversationId} t={t} router={router} />
          </div>
        )}

        {/* 스레드 — relative: "새 메시지 ↓" 플로팅 버튼 기준.
            래퍼엔 overflow를 두지 않는다(overflow-x-hidden을 주면 overflow-y가 auto로 계산돼
            스크롤 컨테이너가 되며 iOS에서 내부 스크롤러와 충돌·터치 스크롤 가로채기 발생).
            가로 팬 차단은 실제 스크롤러(아래)의 overflow-x-hidden만으로 처리. */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={threadRef}
            onScroll={onThreadScroll}
            // 모바일 터치 스크롤 막힘 방지: 경계 튕김·스크롤 체이닝 차단(overscroll-contain) +
            // 세로 팬 즉시 확정(touch-pan-y — 부모 좌우 스와이프와의 제스처 분별 지연 제거).
            // 좌우 스와이프(뒤로가기)는 JS(onTouchEnd)라 touch-action 무관하게 그대로 동작.
            className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y custom-scrollbar px-3 lg:px-6 py-6 space-y-5"
          >
            {/* 이전 메시지 로딩 표시 — 상단 스크롤로 점진 로드 중일 때만(스크롤 보존됨). */}
            {loadingOlder && (
              <div className="flex items-center justify-center gap-2 pb-1 text-[11px] text-slate-500">
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                {t("loadingOlder")}
              </div>
            )}
            {messages.length === 0 ? (
              <p className="text-center text-xs text-slate-500 pt-8">{t("noMessages")}</p>
            ) : (
              messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  conversationId={conversationId}
                  contactName={header.name}
                  isGroup={header.isGroup}
                  onReply={setReplyTarget}
                  actionsActive={activeActionMessageId === m.id}
                  onBubbleTap={toggleActionMessage}
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

          {/* 위로 많이 올라갔을 때 표시 → 클릭하면 최신(맨 아래)으로. "새 메시지" 핀이 있으면 그쪽이 우선. */}
          {showScrollBottom && !showNewMsg && (
            <button
              type="button"
              onClick={() => scrollToBottom("smooth")}
              aria-label={t("scrollToBottom")}
              title={t("scrollToBottom")}
              className="absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-700/90 hover:bg-slate-600 text-white shadow-lg shadow-black/40 ring-1 ring-white/10 backdrop-blur transition-colors active:scale-95"
            >
              <span className="material-symbols-outlined text-[22px]">arrow_downward</span>
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
          isGroup={header.isGroup}
          groupMembers={groupMembers}
          replyTarget={replyTarget}
          onClearReply={() => setReplyTarget(null)}
          onSent={markJustSent}
          t={t}
          router={router}
        />
      </section>
      </MutationContext.Provider>
      </MentionNamesContext.Provider>
      </QuoteJumpContext.Provider>

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
  onBack,
}: {
  conversationId: string;
  header: ChatHeader;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
  // perf #2: 모바일 뒤로가기 — 있으면 클라이언트 전환(인박스 복귀), 없으면 레거시 서버 네비게이션.
  onBack?: () => void;
}) {
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const refresh = useMutationRefresh(router); // perf #2: 클라이언트 전환 시 스레드 재fetch, 레거시면 router.refresh

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
        refresh();
      }
    } catch {
      /* noop — 실패 시 모달 유지 */
    } finally {
      setNicknameSaving(false);
    }
  }

  return (
    <header className="relative z-30 shrink-0 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-3 py-2.5 lg:px-6 lg:py-3 flex items-center justify-between gap-2 lg:gap-4">
      {/* 좌측: (모바일) 뒤로가기 + 아바타 + 별명(편집) + 배지 + 연결/원본 */}
      <div className="flex items-center gap-2 lg:gap-3 min-w-0">
        {/* 모바일 전용 뒤로가기 — 목록(인박스)으로. 데스크톱(lg:)은 2-pane 유지라 숨김. */}
        <button
          type="button"
          onClick={() => (onBack ? onBack() : router.push("/messages"))}
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
            {/* 데스크톱: 분류 드롭다운을 이름 옆에. 모바일은 폭 부족 → 아래 줄로 이동(아래 인스턴스) */}
            <div className="hidden lg:block">
              <CounterpartyDropdown
                conversationId={conversationId}
                type={header.counterpartyType}
                t={t}
                router={router}
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {/* 모바일: 분류 드롭다운을 둘째 줄로(이름 줄 혼잡·오버플로 방지) */}
            <div className="lg:hidden">
              <CounterpartyDropdown
                conversationId={conversationId}
                type={header.counterpartyType}
                t={t}
                router={router}
              />
            </div>
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
  const refresh = useMutationRefresh(router); // perf #2

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
        refresh();
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
  isGroup,
  onReply,
  actionsActive,
  onBubbleTap,
  t,
  router,
}: {
  message: ChatMessage;
  conversationId: string;
  contactName: string;
  isGroup: boolean;
  onReply: (target: ReplyTarget) => void;
  actionsActive: boolean;
  onBubbleTap: (id: string) => void;
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
          isGroup={isGroup}
          onReply={onReply}
          actionsActive={actionsActive}
          onBubbleTap={onBubbleTap}
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
          actionsActive={actionsActive}
          onBubbleTap={onBubbleTap}
          t={t}
          router={router}
        />
      )}
      {message.kind === "system" && <SystemBubble message={message} t={t} />}
    </>
  );
}

/** 답글 인용 블록 — 버블 위 작은 회색 박스(보낸이 + 본문 1~2줄). b14 slate 톤.
 *  targetMsgId(인용 대상 원본 zaloMsgId)가 있고 그 원본이 현재 로드 범위에 있으면
 *  클릭 시 원본으로 스크롤+하이라이트(Nike). 범위 밖이면 클릭해도 무동작이므로 비클릭 표시. */
function QuotedBlock({
  sender,
  text,
  align,
  targetMsgId,
  t,
}: {
  sender: string | null;
  text: string;
  align: "left" | "right";
  targetMsgId: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const jump = useContext(QuoteJumpContext);
  // 원본이 현재 화면에 렌더돼 있을 때만 클릭 가능(Nike와 동일 — 없으면 점프 불가).
  const canJump =
    !!jump &&
    !!targetMsgId &&
    typeof document !== "undefined" &&
    !!document.querySelector(`[data-msg-id="${CSS.escape(targetMsgId)}"]`);
  const base = `mb-1 max-w-full rounded-lg border-l-2 border-slate-600 bg-slate-800/60 px-2.5 py-1.5 ${
    align === "right" ? "ml-auto text-left" : "text-left"
  }`;
  const inner = (
    <>
      <p className="text-[10px] font-bold text-slate-400 truncate">{sender ?? t("reply.you")}</p>
      <p className="text-[11px] text-slate-400 line-clamp-2 break-words">{text}</p>
    </>
  );
  if (canJump) {
    return (
      <button
        type="button"
        onClick={() => targetMsgId && jump?.(targetMsgId)}
        title={t("reply.jumpToOriginal")}
        className={`${base} block w-full cursor-pointer transition-colors hover:bg-slate-700/60`}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

/** 메시지 액션(답글·리액션) — 버블 옆 작은 버튼군. 리액션은 6종 picker.
 *  가시성: 평소 숨김. PC=버블 호버 시(group-hover)·포커스 시(focus-within),
 *  모바일=버블 탭으로 active=true일 때. picker가 열려 있으면 계속 표시. 색 대비는 유지. */
function MessageActions({
  conversationId,
  messageId,
  replyTarget,
  align,
  active,
  onReply,
  t,
  router,
}: {
  conversationId: string;
  messageId: string;
  replyTarget: ReplyTarget;
  align: "left" | "right";
  active: boolean;
  onReply: (target: ReplyTarget) => void;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useMutationRefresh(router); // perf #2

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
        refresh();
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

  // 평소 숨김(opacity-0). PC는 group-hover/focus-within으로 표시(CSS).
  // 모바일은 버블 탭으로 active=true일 때, 그리고 picker가 열려 있으면 항상 표시.
  const forceShow = active || pickerOpen;
  return (
    <div
      className={`relative flex items-center gap-0.5 transition-opacity group-hover:opacity-100 focus-within:opacity-100 ${
        forceShow ? "opacity-100" : "opacity-0"
      } ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      {/* 답글 */}
      <button
        type="button"
        onClick={() => onReply(replyTarget)}
        disabled={busy}
        title={t("reply.action")}
        aria-label={t("reply.action")}
        className="w-7 h-7 rounded-full bg-slate-700 hover:bg-blue-600 text-slate-200 hover:text-white border border-slate-600 flex items-center justify-center transition-colors disabled:opacity-50"
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
        className="w-7 h-7 rounded-full bg-slate-700 hover:bg-blue-600 text-slate-200 hover:text-white border border-slate-600 flex items-center justify-center transition-colors disabled:opacity-50"
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
    case "sticker":
      return t("preview.sticker");
    case "voice":
      return t("preview.voice");
    case "call":
      return t("preview.call");
    case "contact":
      // 연락처명이 있으면 함께 — 없으면 라벨만.
      return message.text ? t("preview.contactNamed", { name: message.text }) : t("preview.contact");
    case "video":
      return t("preview.video");
    case "location":
      return message.text || t("preview.location");
    default:
      return message.text;
  }
}

function InboundBubble({
  message,
  conversationId,
  contactName,
  isGroup,
  onReply,
  actionsActive,
  onBubbleTap,
  t,
  router,
}: {
  message: ChatMessage;
  conversationId: string;
  contactName: string;
  isGroup: boolean;
  onReply: (target: ReplyTarget) => void;
  actionsActive: boolean;
  onBubbleTap: (id: string) => void;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [showTranslation, setShowTranslation] = useState(true);
  // 그룹은 발신자별 이름(senderName, 미해석 시 senderUid 폴백) — 답글 인용·하단 라벨에 사용.
  // 1:1은 기존대로 대화 상대명(contactName).
  const senderLabel = isGroup ? message.senderName ?? contactName : contactName;
  const replyTarget: ReplyTarget = {
    messageId: message.id,
    sender: senderLabel,
    text: replyPreviewText(message, t),
  };
  // 특수 타입(sticker/voice/call/contact/video/location) 카드 — 발·수신 공통 분기 재사용.
  const typeCard = renderTypeCard(message, true, t);
  return (
    <div
      data-msg-id={message.zaloMsgId ?? undefined}
      onClick={() => onBubbleTap(message.id)}
      className="group flex items-end gap-2 max-w-[80%] transition-shadow"
    >
      <InboundAvatar message={message} />
      <div className="min-w-0">
        {/* 그룹 발신자명은 버블 위가 아니라 하단 시간 옆에만 표시(사용자 요청 — 더 깔끔). */}
        {(message.quotedText || message.quotedSender) && (
          <QuotedBlock
            sender={message.quotedSender}
            text={message.quotedText ?? ""}
            align="left"
            targetMsgId={message.quotedMsgId}
            t={t}
          />
        )}
        {message.msgType === "photo" && message.attachmentUrls.length > 0 ? (
          <PhotoCard
            urls={message.attachmentUrls}
            caption={message.text}
            inbound
            translatedText={showTranslation ? message.translatedText : null}
            transcriptLabel={t("typeCard.photoTranscript")}
            messageId={message.id}
            t={t}
          />
        ) : message.msgType === "file" ? (
          <FileCard
            fileName={message.text}
            url={message.attachmentUrls[0] ?? null}
            inbound
            t={t}
          />
        ) : typeCard ? (
          typeCard
        ) : (
          <div className="bg-slate-800 rounded-xl rounded-bl-sm px-4 py-3">
            <p className="text-sm text-slate-100 whitespace-pre-wrap break-words"><MentionText text={message.text} /></p>
            {message.translatedText && showTranslation && (
              <div className="border-t border-slate-700 mt-2 pt-2 flex items-start justify-between gap-3">
                <p className="text-sm text-slate-300 flex-1 whitespace-pre-wrap break-words">
                  <MentionText text={message.translatedText} />
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
          {/* 상대 이름/닉네임 — 시간 왼쪽에 표시(사용자 요청). 헤더 외에도 대화 상대 식별.
              그룹은 발신자명(senderLabel)을, 1:1은 대화 상대명(contactName)을 시간 옆에 표시. */}
          {(isGroup ? senderLabel : contactName) && (
            <span className="text-[11px] font-medium text-slate-400 truncate max-w-[120px]">
              {isGroup ? senderLabel : contactName}
            </span>
          )}
          <span className="text-[10px] text-slate-600 tabular-nums">{message.time}</span>
          <MessageActions
            conversationId={conversationId}
            messageId={message.id}
            replyTarget={replyTarget}
            align="left"
            active={actionsActive}
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
  actionsActive,
  onBubbleTap,
  t,
  router,
}: {
  message: ChatMessage;
  conversationId: string;
  contactName: string;
  onReply: (target: ReplyTarget) => void;
  actionsActive: boolean;
  onBubbleTap: (id: string) => void;
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
  // 특수 타입 카드(sticker/voice/call/contact/video/location) — 발·수신 공통 분기 재사용.
  const typeCard = renderTypeCard(message, false, t);
  if (message.msgType === "photo" && message.attachmentUrls.length > 0) {
    card = <PhotoCard urls={message.attachmentUrls} caption={message.text} />;
  } else if (message.msgType === "file") {
    card = <FileCard fileName={message.text} url={message.attachmentUrls[0] ?? null} t={t} />;
  } else if (typeCard) {
    card = typeCard;
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
    // 기본 텍스트 버블 — VI/EN 모드 발신은 원문(한국어, 흰색) 위 / 실제 발송된 번역문(연한 파랑) 아래.
    // 상대는 번역문만 받았고, 원문은 내 기록용(route.ts 전송 번역).
    card = (
      <div className="bg-blue-600 rounded-xl rounded-br-sm px-4 py-3 inline-block text-left">
        <p className="text-sm text-white whitespace-pre-wrap break-words">
          <MentionText text={message.text} highlightClass="font-bold text-sky-200" />
        </p>
        {message.translatedText && (
          <p className="mt-1.5 border-t border-white/20 pt-1.5 text-xs text-blue-100/90 whitespace-pre-wrap break-words">
            <MentionText text={message.translatedText} highlightClass="font-bold text-white" />
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      data-msg-id={message.zaloMsgId ?? undefined}
      onClick={() => onBubbleTap(message.id)}
      className="group flex justify-end transition-shadow"
    >
      <div className={`${maxW} text-right min-w-0`}>
        {(message.quotedText || message.quotedSender) && (
          <QuotedBlock
            sender={message.quotedSender}
            text={message.quotedText ?? ""}
            align="right"
            targetMsgId={message.quotedMsgId}
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
            active={actionsActive}
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
  translatedText,
  transcriptLabel,
  messageId,
  t,
}: {
  urls: string[];
  caption: string;
  inbound?: boolean;
  /** 이미지 OCR 번역 결과(ko) — 있으면 사진 아래 자막으로 표시. 과거 자동번역분 또는 on-demand 결과. */
  translatedText?: string | null;
  /** 자막 라벨(t("typeCard.photoTranscript")) — 번역 결과 있을 때만 사용. */
  transcriptLabel?: string;
  /** 수신 메시지 id — 있으면 "번역" 버튼으로 on-demand OCR 번역 호출(사진 자동번역 폐지, 2026-06-23). */
  messageId?: string;
  t?: ReturnType<typeof useTranslations>;
}) {
  const openLightbox = useContext(LightboxContext);
  // on-demand 번역 상태: 번역문(로컬) / 로딩 / "글자 없음"·실패.
  const [localTranslated, setLocalTranslated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null); // 글자 없음/실패 안내
  const shown = localTranslated ?? translatedText ?? null;

  async function handleTranslate() {
    if (!messageId || loading) return;
    setLoading(true);
    setNote(null);
    try {
      const res = await fetch(`/api/zalo/messages/${messageId}/translate-photo`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as { translated?: string };
      if (res.ok) {
        if (data.translated && data.translated.trim().length > 0) {
          setLocalTranslated(data.translated);
        } else {
          setNote(t?.("photoTranslate.empty") ?? ""); // 인식된 글자 없음
        }
      } else {
        setNote(t?.("photoTranslate.failed") ?? "");
      }
    } catch {
      setNote(t?.("photoTranslate.failed") ?? "");
    } finally {
      setLoading(false);
    }
  }

  const wrap = inbound
    ? "bg-slate-800 rounded-xl rounded-bl-sm p-1.5 inline-block text-left overflow-hidden"
    : "bg-blue-600 rounded-xl rounded-br-sm p-1.5 inline-block text-left overflow-hidden";
  const captionColor = inbound ? "text-slate-300" : "text-blue-100";
  // "번역" 버튼: 수신 사진 + messageId 있고, 아직 번역문/안내가 없을 때만 노출.
  const canTranslate = inbound && !!messageId && !shown && !note;
  return (
    <div className={wrap}>
      {/* 이미지 + 오버레이 래퍼 — 번역 버튼을 사진 위(좌하단)에 띄운다. */}
      <div className="relative">
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
        {/* on-demand 번역 버튼 — 사진 위 좌하단 오버레이 (사진 자동번역 폐지, 사용자가 누를 때만 OCR 번역). */}
        {canTranslate && (
          <button
            type="button"
            onClick={handleTranslate}
            disabled={loading}
            className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm hover:bg-black/75 disabled:opacity-60 transition-colors active:scale-95 shadow-lg shadow-black/30"
          >
            <span className="material-symbols-outlined text-[14px]">translate</span>
            {loading ? t?.("photoTranslate.loading") ?? "..." : t?.("photoTranslate.button") ?? "번역"}
          </button>
        )}
      </div>
      {caption && <p className={`text-xs px-2 py-1.5 ${captionColor}`}>{caption}</p>}
      {/* 번역 결과(자막) — caption 아래 한 줄(voice STT 자막과 동일 패턴). */}
      {shown && (
        <p className={`text-xs px-2 pb-1.5 ${captionColor} whitespace-pre-wrap break-words`}>
          {shown}
          {transcriptLabel && (
            <span className="text-[9px] font-bold ml-1.5 align-middle opacity-70">
              {transcriptLabel}
            </span>
          )}
        </p>
      )}
      {/* 글자 없음/실패 안내 */}
      {note && <p className="text-[10px] px-2 pb-1.5 text-slate-500">{note}</p>}
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
        className={`material-symbols-outlined text-[22px] leading-none translate-y-[3px] w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconWrap}`}
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

/** 스티커 카드 — 말풍선 배경 없이 webp 이미지만(~120px). 클릭 시 라이트박스로 확대. */
function StickerCard({ urls, t }: { urls: string[]; t: ReturnType<typeof useTranslations> }) {
  const openLightbox = useContext(LightboxContext);
  // attachmentUrls가 없으면(흔적만 수신) 중립 라벨 폴백.
  if (urls.length === 0) {
    return <SimpleTypeCard icon="emoji_emotions" label={t("typeCard.sticker")} />;
  }
  return (
    <button
      type="button"
      onClick={() => openLightbox?.(urls, 0)}
      title={t("typeCard.sticker")}
      className="block cursor-zoom-in transition-transform hover:scale-105"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urls[0]} alt={t("typeCard.sticker")} className="w-[120px] h-[120px] object-contain" />
    </button>
  );
}

/** 단순 타입 카드 — 아이콘 + 라벨(+ 선택적 부제). voice/call/contact/location 공통 셸. */
function SimpleTypeCard({
  icon,
  label,
  subLabel,
  href,
  hrefLabel,
  inbound = false,
}: {
  icon: string;
  label: string;
  subLabel?: string | null;
  href?: string | null;
  hrefLabel?: string;
  inbound?: boolean;
}) {
  const wrap = inbound
    ? "bg-slate-800 rounded-xl rounded-bl-sm px-3 py-2.5 inline-flex items-center gap-3 text-left w-[240px] max-w-full"
    : "bg-blue-600 rounded-xl rounded-br-sm px-3 py-2.5 inline-flex items-center gap-3 text-left w-[240px] max-w-full";
  const iconWrap = inbound ? "bg-slate-700 text-slate-200" : "bg-blue-500 text-white";
  const labelColor = inbound ? "text-slate-100" : "text-white";
  const subColor = inbound ? "text-slate-400" : "text-blue-100/80";
  const linkColor = inbound
    ? "text-blue-400 hover:text-blue-300"
    : "text-blue-100 hover:text-white";
  return (
    <div className={wrap}>
      <span
        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 self-center ${iconWrap}`}
      >
        <span className="material-symbols-outlined text-[22px] leading-none">{icon}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium truncate ${labelColor}`}>{label}</p>
        {subLabel && <p className={`text-xs truncate ${subColor}`}>{subLabel}</p>}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold transition-colors ${linkColor}`}
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            {hrefLabel}
          </a>
        )}
      </div>
    </div>
  );
}

/** 동영상 카드 — 썸네일 없이 movie 아이콘 + "동영상" + 보기 링크(새 탭). */
function VideoCard({
  url,
  inbound = false,
  t,
}: {
  url: string | null;
  inbound?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <SimpleTypeCard
      icon="movie"
      label={t("typeCard.video")}
      href={url}
      hrefLabel={t("typeCard.openVideo")}
      inbound={inbound}
    />
  );
}

/**
 * 특수 메시지 타입(sticker/voice/call/contact/video/location) → 카드. 매핑 없으면 null.
 * inbound/outbound 공통 — 발신·수신에서 같은 분기를 재사용(중복 방지).
 */
function renderTypeCard(
  message: ChatMessage,
  inbound: boolean,
  t: ReturnType<typeof useTranslations>
): ReactNode | null {
  switch (message.msgType) {
    case "sticker":
      return <StickerCard urls={message.attachmentUrls} t={t} />;
    case "voice":
      return (
        <div className="flex flex-col gap-1">
          <SimpleTypeCard
            icon="mic"
            label={t("typeCard.voice")}
            href={message.attachmentUrls[0] ?? null}
            hrefLabel={t("typeCard.playVoice")}
            inbound={inbound}
          />
          {/* S5 A6 — STT 자막: 음성 받아쓰기(ko)가 있으면 mic 카드 아래 한 줄로 렌더 */}
          {message.translatedText && (
            <div
              className={
                inbound
                  ? "bg-slate-800 rounded-xl rounded-bl-sm px-3 py-2 w-[240px] max-w-full"
                  : "bg-blue-600 rounded-xl rounded-br-sm px-3 py-2 w-[240px] max-w-full"
              }
            >
              <p
                className={`text-sm whitespace-pre-wrap break-words ${
                  inbound ? "text-slate-200" : "text-white"
                }`}
              >
                {message.translatedText}
                <span
                  className={`text-[9px] font-bold ml-1.5 align-middle ${
                    inbound ? "text-slate-500" : "text-blue-100/70"
                  }`}
                >
                  {t("typeCard.voiceTranscript")}
                </span>
              </p>
            </div>
          )}
        </div>
      );
    case "call":
      return <SimpleTypeCard icon="call" label={t("typeCard.call")} inbound={inbound} />;
    case "contact":
      return (
        <SimpleTypeCard
          icon="person"
          label={t("typeCard.contact")}
          subLabel={message.text || null}
          inbound={inbound}
        />
      );
    case "video":
      return <VideoCard url={message.attachmentUrls[0] ?? null} inbound={inbound} t={t} />;
    case "location":
      return (
        <SimpleTypeCard
          icon="location_on"
          label={t("typeCard.location")}
          subLabel={message.text || null}
          href={message.attachmentUrls[0] ?? null}
          hrefLabel={t("typeCard.openMap")}
          inbound={inbound}
        />
      );
    default:
      return null;
  }
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

/** Blob → base64(접두 data: 제거) — 음성 STT 업로드용. FileReader 기반(브라우저). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function Composer({
  conversationId,
  windowOpen,
  translateMode,
  counterpartyType,
  contactName,
  isGroup,
  groupMembers,
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
  // 그룹 대화일 때만 @멘션 동작(1:1은 멘션 없음, 기존 그대로).
  isGroup: boolean;
  groupMembers: GroupMember[];
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
  const refresh = useMutationRefresh(router); // perf #2: 발신 후 스레드 즉시 재fetch(클라) 또는 router.refresh(레거시)
  // ── @멘션 (그룹 대화 전용, Nike chat-input 패턴 이식) ──────────────────────
  // mentionQuery: null이면 드롭다운 닫힘. ""이면 "@"만 친 상태(전체 후보). 문자열이면 이름 검색어.
  // mentionStartRef: 현재 입력 중인 "@" 의 본문 인덱스(선택 시 그 자리부터 토큰 치환).
  // mentionsRef: 확정된 멘션 메타(pos/uid/len) 목록 — 발송 시 POST body로. 본문 편집 시 위치 재계산.
  // @All은 page에서 안 넘어오므로 입력창이 uid "-1" 합성 옵션을 후보 맨 위에 추가.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionList, setMentionList] = useState<{ uid: string; name: string; avatarUrl: string | null }[]>([]);
  const [mentionIdx, setMentionIdx] = useState(0);
  const mentionStartRef = useRef<number>(-1);
  const mentionsRef = useRef<MentionData[]>([]);
  // 키보드로 선택된 멘션 항목 ref — mentionIdx 변경 시 드롭다운 스크롤을 따라가게(scrollIntoView).
  const activeMentionRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeMentionRef.current?.scrollIntoView({ block: "nearest" });
  }, [mentionIdx, mentionQuery]);
  // @All 합성 옵션(uid "-1") — 후보 맨 위. 멤버 이름과 동일 형식으로 selectMention에서 처리.
  const ALL_UID = "-1";
  // ── 음성 입력(STT) — MediaRecorder 녹음 → 서버(Gemini)에서 받아쓰기 → 입력창 채움 ──
  // iOS Safari는 Web Speech 미지원 → 녹음 후 서버 STT(전 플랫폼 동작). recSupported일 때만 버튼 노출.
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recSupported, setRecSupported] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recAutoStopRef = useRef<number | null>(null);
  // 입력창 자동 높이 — 긴 글·줄바꿈 시 textarea가 내용만큼 늘어남(모바일 좁은 칸 가독성). 최대 140px.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    // 빈 입력은 항상 native 1줄(rows=1). 인라인 height를 비워, 마운트 시 레이아웃 미정착 상태의
    // scrollHeight 오측정으로 빈 칸이 커진 채 고착되는 회귀를 차단(텍스트 입력 전 큰 칸 버그).
    if (!el.value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  };
  // [text] 변화 외에, 마운트 직후 한 프레임 뒤(레이아웃 정착 후)에도 재측정 — 초기 오측정 고착 방지.
  useEffect(() => {
    autoGrow();
    const id = requestAnimationFrame(autoGrow);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // 대화 전환 시 @멘션 상태 초기화 — 다른 대화에 엉뚱한 멘션 메타가 남지 않도록(누수·오발송 방지).
  useEffect(() => {
    mentionsRef.current = [];
    setMentionQuery(null);
    setMentionList([]);
    mentionStartRef.current = -1;
  }, [conversationId]);

  // 음성 입력 지원 감지(getUserMedia + MediaRecorder) + 언마운트 시 마이크 정리.
  useEffect(() => {
    setRecSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof window !== "undefined" &&
        typeof window.MediaRecorder !== "undefined",
    );
    return () => {
      if (recAutoStopRef.current != null) window.clearTimeout(recAutoStopRef.current);
      recStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

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

  async function translate(override?: string) {
    // override(STT 결과 등)가 문자열이면 그걸, 아니면 현재 입력값을 번역.
    const value = (typeof override === "string" ? override : text).trim();
    if (!previewEnabled || !value) {
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
        body: JSON.stringify({ text: value, conversationId }),
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
      // @멘션(그룹 전용) — 본문에 여전히 토큰이 살아있는 멘션만 전송. body는 trim된 본문이므로
      // 선행 공백이 없는 한 pos는 그대로 유효(textarea 본문엔 선행 공백을 두지 않음).
      if (isGroup && mentionsRef.current.length > 0) {
        const valid = mentionsRef.current.filter((m) => body.slice(m.pos, m.pos + m.len).startsWith("@"));
        if (valid.length > 0) payload.mentions = valid;
      }
      const res = await fetch("/api/zalo/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setText("");
        setPreview("");
        mentionsRef.current = [];
        closeMention();
        onClearReply();
        // 내가 전송 → 다음 메시지 반영 때 무조건 최하단으로(과거 보던 중이어도).
        onSent();
        refresh();
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

  // ── @멘션: 드롭다운 닫기 ──
  const closeMention = () => {
    setMentionQuery(null);
    setMentionList([]);
    mentionStartRef.current = -1;
  };

  // ── @멘션: 입력 변경 핸들러 (setText + @ 감지 + 기존 멘션 위치 검증) ──
  // 1:1 대화·비그룹은 멘션 없이 setText만(기존 동작 그대로).
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setText(next);

    // 본문 편집 시 기존 멘션이 여전히 "@…" 토큰으로 그 자리에 있는지 검증 → 깨진 멘션 제거(Nike).
    // (정확한 shift 추적은 어려우므로, 토큰이 더 이상 일치하지 않으면 그 멘션은 버린다.)
    if (mentionsRef.current.length > 0) {
      mentionsRef.current = mentionsRef.current.filter((m) => {
        const token = next.slice(m.pos, m.pos + m.len);
        return token.startsWith("@");
      });
    }

    if (!isGroup) {
      closeMention();
      return;
    }

    const cursor = e.target.selectionStart ?? next.length;
    const before = next.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    // "@"가 줄 맨 앞이거나 공백 뒤일 때만 멘션 트리거(이메일·중간 @ 오작동 방지).
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(before[atIdx - 1]))) {
      const query = before.slice(atIdx + 1);
      // 토큰 안에 공백이 들어오면 멘션 입력 종료(이미 이름 선택했거나 일반 문장).
      if (/\s/.test(query)) {
        closeMention();
        return;
      }
      mentionStartRef.current = atIdx;
      const q = query.toLowerCase();
      // @All 옵션: 빈 검색어이거나 "all"/"전체"/"tất cả"가 검색어를 포함할 때 맨 위 노출.
      const allLabel = t("mention.all"); // "@전체" / "@Tất cả"
      const allMatches =
        q === "" ||
        "all".includes(q) ||
        "전체".includes(q) ||
        allLabel.toLowerCase().includes(q) ||
        "tất cả".includes(q);
      const filtered = groupMembers
        .filter((m) => (m.name ?? "").toLowerCase().includes(q))
        .map((m) => ({ uid: m.zaloId, name: m.name ?? m.zaloId, avatarUrl: m.avatarUrl }));
      const list = allMatches
        ? [{ uid: ALL_UID, name: allLabel, avatarUrl: null }, ...filtered]
        : filtered;
      setMentionList(list.slice(0, 8));
      setMentionIdx(0);
      setMentionQuery(query);
    } else {
      closeMention();
    }
  };

  // ── @멘션: 후보 선택 → 본문에 "@이름 " 삽입 + 멘션 메타 기록 ──
  const selectMention = (member: { uid: string; name: string; avatarUrl: string | null }) => {
    const start = mentionStartRef.current;
    if (start < 0) return;
    const el = inputRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const beforeAt = text.slice(0, start);
    const after = text.slice(cursor);
    // @All은 라벨에 이미 "@"가 있으므로 그대로("@전체 "), 일반 멤버는 "@"를 붙인다("@이름 ").
    //  ★ 버그수정: 개별 멤버에 "@"를 안 붙이면 발송 시 startsWith("@") 필터에 걸려 멘션이 전부 빠졌다.
    const insert = member.uid === ALL_UID ? `${member.name} ` : `@${member.name} `;
    const newVal = beforeAt + insert + after;
    setText(newVal);

    // 삽입 지점(start) 뒤에 있던 기존 멘션들은 길이 변화만큼 pos shift.
    const replacedLen = cursor - start; // 교체된 "@검색어" 길이
    const shift = insert.length - replacedLen;
    if (shift !== 0) {
      mentionsRef.current = mentionsRef.current.map((m) =>
        m.pos > start ? { ...m, pos: m.pos + shift } : m,
      );
    }
    // 새 멘션 메타 — len은 끝 공백 제외("@이름" 토큰 길이). uid는 zaloId(@All="-1").
    mentionsRef.current.push({ pos: start, uid: member.uid, len: insert.trimEnd().length });

    closeMention();
    // 커서를 삽입한 토큰 뒤로 이동 + 포커스.
    requestAnimationFrame(() => {
      const pos = beforeAt.length + insert.length;
      el?.setSelectionRange(pos, pos);
      el?.focus();
    });
  };

  // ── 음성 입력: 녹음 시작 ──
  async function startRecording() {
    if (recording || transcribing) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      const mr = new MediaRecorder(stream);
      recChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      mr.onstop = () => void finishRecording(mr.mimeType);
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      // 안전장치 — 60초 자동 중단(과대 업로드·잊고 켜둠 방지)
      recAutoStopRef.current = window.setTimeout(() => stopRecording(), 60_000);
    } catch {
      setError(t("voiceInput.micDenied"));
      recStreamRef.current?.getTracks().forEach((tr) => tr.stop());
      recStreamRef.current = null;
    }
  }

  // ── 음성 입력: 녹음 중단(→ onstop에서 finishRecording) ──
  function stopRecording() {
    if (recAutoStopRef.current != null) {
      window.clearTimeout(recAutoStopRef.current);
      recAutoStopRef.current = null;
    }
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    setRecording(false);
    recStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    recStreamRef.current = null;
  }

  // ── 녹음 종료 → 서버 STT → 입력창에 추가 + 번역 미리보기 갱신 ──
  async function finishRecording(mimeType: string) {
    const blob = new Blob(recChunksRef.current, { type: mimeType || "audio/webm" });
    recChunksRef.current = [];
    mediaRecorderRef.current = null;
    if (blob.size === 0) return;
    setTranscribing(true);
    setError(null);
    try {
      const audioBase64 = await blobToBase64(blob);
      const res = await fetch("/api/zalo/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType: blob.type || "audio/webm" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { text: string };
        const stt = (data.text ?? "").trim();
        if (!stt) {
          setError(t("voiceInput.empty"));
          return;
        }
        // 기존 입력 뒤에 받아쓴 텍스트를 이어 붙임(실시간 DOM 값 기준 — 최신 보장).
        const before = (inputRef.current?.value ?? "").trim();
        const fullText = before ? `${before} ${stt}` : stt;
        setText(fullText);
        void translate(fullText); // 번역 미리보기 즉시 갱신(stale 방지 — override 전달)
        inputRef.current?.focus();
      } else if (res.status === 503) {
        setError(t("translateUnavailable")); // STT 키 미설정
      } else {
        setError(t("voiceInput.failed"));
      }
    } catch {
      setError(t("voiceInput.failed"));
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <footer className="shrink-0 border-t border-slate-800 bg-slate-900 px-3 py-3 lg:px-6 lg:py-4">
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
      {/* @멘션 드롭다운 (그룹 전용) — "@" 입력 시 멤버 후보. ↑↓ 이동·Enter/Tab 선택·Esc 닫기.
          @전체(uid -1) 맨 위. 다크 톤(slate). 입력 박스 위에 흐름상 표시(잘림 없음). */}
      {isGroup && mentionQuery !== null && mentionList.length > 0 && (
        <div className="mb-2 max-h-56 overflow-y-auto bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-1.5 custom-scrollbar">
          <p className="px-3 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            {t("mention.heading")}
          </p>
          {mentionList.map((m, i) => {
            const isAll = m.uid === ALL_UID;
            return (
              <button
                key={m.uid}
                type="button"
                // 키보드(↑↓)로 선택된 항목 — 드롭다운 스크롤이 따라가도록 ref 부착(아래 useEffect).
                ref={i === mentionIdx ? activeMentionRef : null}
                // onMouseDown(onClick 아님): textarea blur 전에 선택 처리 → 본문 삽입 보장(blur 번역과 충돌 방지).
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(m);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                  i === mentionIdx ? "bg-slate-700/70 text-white" : "text-slate-200 hover:bg-slate-700/50"
                }`}
              >
                {isAll ? (
                  <span className="w-7 h-7 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[18px]">group</span>
                  </span>
                ) : m.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.avatarUrl}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover shrink-0 bg-slate-700"
                  />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center font-bold text-[10px] shrink-0">
                    {memberInitials(m.name)}
                  </span>
                )}
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium">{m.name}</span>
                  {isAll && (
                    <span className="block text-[10px] text-slate-500 truncate">
                      {t("mention.allHint")}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 입력 박스 — 빈 영역(패딩·우측 여백) 탭도 입력창 포커스(Zalo식). 버튼 탭은 제외. */}
      <div
        className="bg-slate-800/60 border border-slate-700 rounded-xl focus-within:border-blue-500 transition-colors cursor-text"
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("button, a, [role='button']")) {
            inputRef.current?.focus();
          }
        }}
      >
        <div className="flex items-end gap-1.5 px-2.5 py-2.5">
          <AttachMenu
            conversationId={conversationId}
            counterpartyType={counterpartyType}
            contactName={contactName}
            onError={setError}
            t={t}
            router={router}
          />
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={handleTextChange}
            onBlur={() => translate()}
            onKeyDown={(e) => {
              // @멘션 드롭다운 열림 + IME 조합 아님 → 키보드 탐색(↑↓ 이동, Enter/Tab 선택, Esc 닫기).
              if (mentionQuery !== null && mentionList.length > 0 && !e.nativeEvent.isComposing) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIdx((i) => Math.min(i + 1, mentionList.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIdx((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  selectMention(mentionList[mentionIdx]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeMention();
                  return;
                }
              }
              // IME(한글·베트남어) 조합 중 Enter는 무시(오전송 방지).
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              // Shift+Enter는 줄바꿈. 데스크톱(마우스)만 Enter 전송, 터치(모바일)는 Enter=줄바꿈.
              if (e.shiftKey) return;
              if (window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t("inputPlaceholder")}
            className="flex-1 min-w-0 bg-transparent border-none focus:ring-0 text-base lg:text-sm text-slate-100 placeholder:text-slate-500 px-0 py-2 resize-none overflow-y-auto leading-relaxed"
          />
          {/* 음성 입력 — 마이크 탭: 녹음 시작/중단 → 서버 STT → 입력창 채움(iOS 포함). 지원 기기만 노출. */}
          {recSupported && (
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={transcribing || sending}
              title={recording ? t("voiceInput.stop") : t("voiceInput.start")}
              aria-label={recording ? t("voiceInput.stop") : t("voiceInput.start")}
              className={
                recording
                  ? "shrink-0 w-9 h-9 rounded-lg bg-red-600 text-white flex items-center justify-center animate-pulse"
                  : "shrink-0 w-9 h-9 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-700/60 flex items-center justify-center transition-colors disabled:opacity-50"
              }
            >
              <span className="material-symbols-outlined text-[20px]">
                {transcribing ? "more_horiz" : recording ? "stop" : "mic"}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || sending}
            aria-label={t("send")}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold w-9 h-9 lg:w-auto lg:h-auto lg:px-4 lg:py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors active:scale-95 shrink-0"
          >
            <span className="material-symbols-outlined text-[20px] lg:text-sm">send</span>
            <span className="hidden lg:inline">{t("send")}</span>
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
              onClick={() => translate()}
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
  onError,
  t,
  router,
}: {
  conversationId: string;
  counterpartyType: CounterpartyType;
  contactName: string;
  onError: (msg: string | null) => void;
  t: ReturnType<typeof useTranslations>;
  router: ReturnType<typeof useRouter>;
}) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | "VILLA" | "PROPOSAL" | "SETTLEMENT">(null);
  const [submitting, setSubmitting] = useState(false);
  const refresh = useMutationRefresh(router); // perf #2: 공유/업로드 후 스레드 즉시 재fetch 또는 router.refresh
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 공유 후보 지연 조회(perf) — 매 클릭이 아니라 공유 모달을 처음 열 때 1회만 GET.
  // 같은 대화에서 재오픈 시 캐시 재사용(cands!==null이면 재조회 안 함). conversationId 바뀌면 리셋.
  type Cands = {
    villa: VillaCandidate[];
    proposal: ProposalCandidate[];
    settlement: SettlementCandidate[];
  };
  const [cands, setCands] = useState<Cands | null>(null);
  const [candsLoading, setCandsLoading] = useState(false);

  useEffect(() => {
    // 대화 전환 시 이전 대화의 후보 캐시 무효화(누수·혼선 방지).
    setCands(null);
    setCandsLoading(false);
  }, [conversationId]);

  async function loadCandidates() {
    if (cands !== null || candsLoading) return; // 이미 로드됐거나 진행 중이면 스킵
    setCandsLoading(true);
    try {
      const res = await fetch(
        `/api/zalo/conversations/${conversationId}/candidates`
      );
      if (!res.ok) throw new Error(`candidates ${res.status}`);
      const data = (await res.json()) as {
        villaCandidates: VillaCandidate[];
        proposalCandidates: ProposalCandidate[];
        settlementCandidates: SettlementCandidate[];
      };
      setCands({
        villa: data.villaCandidates ?? [],
        proposal: data.proposalCandidates ?? [],
        settlement: data.settlementCandidates ?? [],
      });
    } catch (e) {
      // 치명 아님 — 빈 목록으로 모달은 열되 콘솔에만 기록.
      console.error("공유 후보 조회 실패", e);
      setCands({ villa: [], proposal: [], settlement: [] });
    } finally {
      setCandsLoading(false);
    }
  }

  // 공유 모달 열기 — 메뉴 닫고 모달 종류 지정 + 후보 지연 조회 트리거.
  function openShareModal(kind: "VILLA" | "PROPOSAL" | "SETTLEMENT") {
    setOpen(false);
    setModal(kind);
    void loadCandidates();
  }

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
      if (res.ok) refresh();
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
        refresh();
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
        refresh();
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
                onClick={() => openShareModal("VILLA")}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-700/60"
              >
                <span className="material-symbols-outlined text-[20px] text-teal-400">villa</span>
                {t("attach.villa")}
              </button>
            )}
            {canProposal && (
              <button
                type="button"
                onClick={() => openShareModal("PROPOSAL")}
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
                onClick={() => openShareModal("SETTLEMENT")}
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

      {/* 공유 선택 모달 — 후보 지연 조회(perf). 도착 전(cands===null)엔 로딩 셸 표시. */}
      {modal !== null && cands === null && (
        <ShareLoadingModal onClose={() => setModal(null)} t={t} />
      )}
      {modal === "VILLA" && canVilla && cands !== null && (
        <VillaShareModal
          candidates={cands.villa}
          counterparty={isSellSideType(counterpartyType) ? "CUSTOMER" : "SUPPLIER"}
          contactName={contactName}
          onClose={() => setModal(null)}
          onSubmit={(villaId) => void shareJson({ type: "VILLA", villaId })}
          submitting={submitting}
          t={t}
        />
      )}
      {modal === "PROPOSAL" && canProposal && cands !== null && (
        <ProposalShareModal
          candidates={cands.proposal}
          contactName={contactName}
          onClose={() => setModal(null)}
          onSubmit={(proposalId) => void shareJson({ type: "PROPOSAL", proposalId })}
          submitting={submitting}
          t={t}
        />
      )}
      {modal === "SETTLEMENT" && canSettlement && cands !== null && (
        <SettlementShareModal
          candidates={cands.settlement}
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
