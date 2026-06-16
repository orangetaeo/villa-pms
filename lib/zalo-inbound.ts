// [SHARED-MODULE] from Nike src/lib/zalo-pool.ts (v1.x) — 단순 이식 (ADR-0006 S3)
/**
 * Zalo 봇 수신 리스너 핸들러 (S3).
 *
 * 책임 분리(테스트 가능성):
 *  - 순수 파싱 함수(extractText / isPhoneLike / extractPhone / isEchoMessage / buildInboundKey):
 *    부수효과 없음 → vitest 단위 테스트 대상. DB·zca-js 의존 없음.
 *  - saveInboundMessage: 위 순수 함수 결과를 받아 ZaloConversation/ZaloMessage upsert·저장 + 전화번호 매칭.
 *  - handleInboundMessage: zca-js UserMessage → 순수 파싱 → saveInboundMessage (리스너에서 호출).
 *
 * villa-pms는 봇 1:N 텍스트 위주 — 그룹·음성STT·리액션·undo는 제외(Nike 대비 대폭 단순화).
 * 봇 본인 발신(isSelf 에코)은 저장 스킵 — S4 발송이 이미 OUTBOUND를 미러 기록하므로 중복 방지.
 *
 * 보안: credential·세션 객체를 본 파일에서 다루지 않는다(리스너가 넘기는 메시지 데이터만).
 *       마진·판매가·원가는 수신 본문엔 애초에 없으나, 저장 텍스트는 사용자 입력 그대로 — 가공 없음.
 */
import {
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
  Role,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/**
 * zca-js UserMessage.data.content → 표시 텍스트 추출 (단순화).
 * villa-pms 수신은 텍스트 위주 — content가 문자열이면 그대로,
 * 객체면 흔한 캡션 필드(title/description/msg)만 본다. 첨부 URL은 S5 범위라 무시.
 */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const o = content as Record<string, unknown>;
    const cand = o.title ?? o.description ?? o.msg;
    if (typeof cand === "string") return cand;
  }
  return "";
}

/**
 * 베트남/한국 전화번호로 보이는 문자열인지 (전화번호 매칭 T3.7 후보 판정).
 * 공백·하이픈·점·괄호·국가코드(+84/0084)를 제거한 뒤 8~15자리 숫자면 true.
 */
export function isPhoneLike(text: string): boolean {
  return extractPhone(text) !== null;
}

/**
 * 본문에서 전화번호 후보를 정규화해 추출. 없으면 null.
 * 반환: 숫자만(선두 0 보존). 국가코드 +84/0084는 0으로 환원(베트남 로컬 표기 일치용).
 */
export function extractPhone(text: string): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  // 전화번호 외 잡문이 섞이면 매칭 대상 아님 — 본문 전체가 번호여야 함(과매칭 방지)
  if (!/^[+()\d\s.\-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 0) return null;
  // +84 / 0084 / 84 (베트남) → 0 로컬 표기로 환원
  if (digits.startsWith("0084")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("84") && digits.length >= 11) digits = "0" + digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * 봇 본인 발신 에코인지 판정 — 저장 스킵 대상.
 * 1) zca-js isSelf 플래그 우선, 2) 보강: 발신자 id(uidFrom/userId)가 봇 ownId와 일치.
 */
export function isEchoMessage(
  opts: { isSelf?: boolean; senderId?: string | null },
  botOwnId: string | null
): boolean {
  if (opts.isSelf === true) return true;
  if (botOwnId && opts.senderId && String(opts.senderId) === String(botOwnId)) return true;
  return false;
}

/**
 * 멱등 키 — zca-js msgId(서버 메시지 id)를 ZaloMessage.zaloMsgId로 사용.
 * 없으면 null(멱등 불가 — 저장은 하되 중복 가드 없음).
 */
export function buildInboundKey(data: { msgId?: unknown }): string | null {
  const raw = data?.msgId;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

// ===================== 파싱된 수신 (핸들러 ↔ 저장 경계) =====================

export interface ParsedInbound {
  /** 이 메시지를 받은 관리자 userId — ZaloConversation 귀속 복합키 (ADR-0007 D3) */
  ownerAdminId: string;
  /** 시스템봇 인스턴스 수신 여부 — true일 때만 전화번호 매칭(전역 온보딩, D4) */
  isSystemBot: boolean;
  /** 발신 상대(공급자)의 Zalo id */
  senderZaloUserId: string;
  text: string;
  /** zca-js 서버 msgId — ZaloMessage.zaloMsgId(멱등). 없으면 null */
  zaloMsgId: string | null;
  /** 발신자 표시명(있으면 ZaloConversation.displayName 보강용) */
  displayName: string | null;
  /** zca-js가 메시지에 실어 보낸 발신자 전화번호(있으면). 없으면 null */
  senderPhone: string | null;
}

// ===================== DB 저장 + 전화번호 매칭 =====================

/**
 * 수신 메시지 1건 저장 (ADR-0007 — 관리자별 귀속).
 *  1) (ownerAdminId, zaloUserId) 복합키로 ZaloConversation upsert (관리자별 격리)
 *  2) zaloMsgId 멱등 — 이미 존재하면 저장 스킵(중복 0)
 *  3) ZaloMessage(INBOUND·USER·text) 생성
 *  4) conversation.lastMessageAt·lastInboundAt=now, unreadCount+1
 *  5) 전화번호 매칭: **시스템봇 수신(isSystemBot)만** (전역 온보딩, D4).
 *     개인 계정 수신은 User.zaloUserId를 건드리지 않는다(전역 오염 방지).
 *
 * 예외 안전: 호출부(handleInboundEvent)에서 try/catch — 여기선 throw 가능.
 */
export async function saveInboundMessage(parsed: ParsedInbound): Promise<{
  saved: boolean;
  duplicated: boolean;
  matchedUserId: string | null;
}> {
  const { ownerAdminId, isSystemBot, senderZaloUserId, text, zaloMsgId, displayName, senderPhone } =
    parsed;
  const now = new Date();

  // 1) 대화 upsert (관리자×상대 복합키 — 없으면 생성)
  const conversation = await prisma.zaloConversation.upsert({
    where: { ownerAdminId_zaloUserId: { ownerAdminId, zaloUserId: senderZaloUserId } },
    update: {},
    create: {
      ownerAdminId,
      zaloUserId: senderZaloUserId,
      displayName: displayName ?? undefined,
    },
    select: { id: true, userId: true, displayName: true },
  });

  // 2) 멱등 — 동일 zaloMsgId 이미 있으면 스킵
  if (zaloMsgId) {
    const existing = await prisma.zaloMessage.findUnique({
      where: { zaloMsgId },
      select: { id: true },
    });
    if (existing) {
      return { saved: false, duplicated: true, matchedUserId: conversation.userId };
    }
  }

  // 3) 메시지 생성
  await prisma.zaloMessage.create({
    data: {
      conversationId: conversation.id,
      direction: ZaloMessageDirection.INBOUND,
      source: ZaloMessageSource.USER,
      msgType: "text",
      text: text || null,
      zaloMsgId,
      status: ZaloMessageStatus.SENT,
    },
  });

  // 4) 대화 메타 갱신 (+ displayName 보강)
  await prisma.zaloConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      lastInboundAt: now,
      unreadCount: { increment: 1 },
      ...(displayName && !conversation.displayName ? { displayName } : {}),
    },
  });

  // 5) 전화번호 매칭 (T3.7) — 시스템봇 수신만(전역 온보딩, D4) + 아직 User 미연결인 대화만.
  //    개인 계정 수신은 User.zaloUserId(전역) 오염 방지 위해 매칭 스킵.
  let matchedUserId = conversation.userId;
  if (isSystemBot && !conversation.userId) {
    const phone = senderPhone ?? extractPhone(text);
    if (phone) {
      matchedUserId = await tryMatchSupplierByPhone(
        conversation.id,
        senderZaloUserId,
        phone
      );
    }
  }

  return { saved: true, duplicated: false, matchedUserId };
}

/**
 * 전화번호로 SUPPLIER User 조회 → 매칭 시 User.zaloUserId + ZaloConversation.userId 연결.
 * 자동 매칭 실패(미발견·이미 다른 zaloUserId 점유·충돌)는 무시 — ADMIN 수동 매칭(T1.8) fallback.
 * @returns 매칭된 userId 또는 null
 */
async function tryMatchSupplierByPhone(
  conversationId: string,
  senderZaloUserId: string,
  phone: string
): Promise<string | null> {
  // 동일 번호의 SUPPLIER 후보 (정확 일치). phone @unique이므로 0~1건.
  const candidate = await prisma.user.findFirst({
    where: { role: Role.SUPPLIER, phone, isActive: true },
    select: { id: true, zaloUserId: true },
  });
  if (!candidate) return null;
  // 이미 다른 Zalo 계정에 연결된 사용자면 자동 덮어쓰기 금지(충돌 → 수동 처리)
  if (candidate.zaloUserId && candidate.zaloUserId !== senderZaloUserId) return null;

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: candidate.id },
        data: { zaloUserId: senderZaloUserId },
      }),
      prisma.zaloConversation.update({
        where: { id: conversationId },
        data: { userId: candidate.id },
      }),
    ]);
    return candidate.id;
  } catch {
    // zaloUserId/userId @unique 경합 등 — 자동 매칭 실패는 조용히 무시(수동 fallback)
    return null;
  }
}
