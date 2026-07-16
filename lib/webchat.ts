// lib/webchat.ts — 홈페이지 다국어 웹 채팅 공용 헬퍼 (T-webchat-mvp)
//
// 방문자(비로그인) 세션 식별·번역·스로틀·킬스위치/일일캡의 단일 원천.
// 기획 정본: docs/plans/webchat-multilingual.md §5·§6·§9, ADR-0045.
//
// 누수 0 원칙: 방문자향 payload에는 ownerAdminId·ipHash·contact·타 세션 데이터·금액(KRW/마진)
//   절대 미포함. 이 모듈은 배선/판정만 담당하고, 화이트리스트 select는 각 라우트가 구성한다.

import { createHmac, timingSafeEqual } from "node:crypto";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security-event";
import { translateText, type TranslateTarget } from "@/lib/gemini";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";
import { todayVnDateString } from "@/lib/date-vn";
import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";

// 클라이언트(위젯·로더)와 공유하는 순수 상수는 별도 파일에 두고 재-export(단일 원천).
// 서버 전용 모듈(이 파일)을 client에서 import하지 못하게 하는 경계.
export {
  MSG_MAX_LEN,
  POLL_MIN_MS,
  POLL_MAX_MS,
  POLL_IDLE_BACKOFF_MS,
  POLL_IDLE_AFTER_MS,
  WEBCHAT_LOCALES,
} from "@/lib/webchat-constants";

type DbClient = PrismaClient | Prisma.TransactionClient;

// ───────────────────────── 상수 (env 남발 금지 — 기획 §9 P2) ─────────────────────────

/** 세션 슬라이딩 TTL(일) — 발신마다 expiresAt 연장. 만료≠삭제(무기한 보존). */
export const SESSION_TTL_DAYS = 30;
/** 세션당 스로틀 — 15msg / 60s. */
export const THROTTLE_SESSION = { max: 15, windowMs: 60_000 };
/** ipHash당 스로틀 — 40msg / 60s. */
export const THROTTLE_IP = { max: 40, windowMs: 60_000 };
/** 인박스 미리보기 절삭 길이. */
export const PREVIEW_MAX_LEN = 120;

// MSG_MAX_LEN·POLL_* 는 lib/webchat-constants.ts에서 재-export(상단 export 블록).

/** 방문자 세션 쿠키 이름. */
export const WEBCHAT_COOKIE = "webchat-session";

/** AppSetting 키 — 위젯 전체 킬스위치("1"=정지). */
export const WEBCHAT_PAUSED_KEY = "WEBCHAT_PAUSED";
/** AppSetting 키 — 일일 번역 호출 상한(미설정 시 기본값). */
export const WEBCHAT_GLOBAL_DAILY_CAP_KEY = "WEBCHAT_GLOBAL_DAILY_CAP";
/** 일일 번역 호출 상한 기본값. */
export const WEBCHAT_DEFAULT_DAILY_CAP = 500;

/** 지원 번역 언어(위젯 5언어). visitorLocale은 자유 확장이나 번역 대상은 이 집합만. */
const TRANSLATE_TARGETS: ReadonlySet<string> = new Set(["vi", "ko", "en", "zh", "ru"]);

// ───────────────────────── ipHash (HMAC-SHA256 — 기획 §9 P2) ─────────────────────────

function requireSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET 미설정 — 웹챗 서명/해시 불가");
  return s;
}

/**
 * 방문자 IP를 HMAC-SHA256(NEXTAUTH_SECRET, ip)로 해시.
 * 무염 해시는 IPv4 2³² 전수 대입으로 가역 → 반드시 HMAC. 원문 IP는 저장하지 않는다.
 * IP 미상 시 "unknown" 상수 해시(스로틀은 세션 키가 1차 방어).
 */
export function hashVisitorIp(ip: string | null | undefined): string {
  const material = ip && ip.trim().length > 0 ? ip.trim() : "unknown";
  return createHmac("sha256", requireSecret()).update(material).digest("hex");
}

// ───────────────────────── 서명 쿠키 (sessionId.hmacSig) ─────────────────────────

function signSessionId(sessionId: string): string {
  return createHmac("sha256", requireSecret()).update(sessionId).digest("base64url");
}

/** 쿠키에 넣을 서명 값 생성: `${sessionId}.${hmacSig}` */
export function makeSessionCookieValue(sessionId: string): string {
  return `${sessionId}.${signSessionId(sessionId)}`;
}

/**
 * 쿠키 값 검증 → 유효하면 sessionId 반환, 위조·형식오류면 null.
 * 상수시간 비교(timingSafeEqual)로 서명 위조 타이밍 누설 방지.
 */
export function verifySessionCookieValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const sessionId = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!sessionId || !sig) return null;
  const expected = signSessionId(sessionId);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? sessionId : null;
}

/** 요청 Cookie 헤더에서 webchat-session 값을 파싱해 검증된 sessionId 반환(없으면 null). */
export function readSessionIdFromRequest(req: Request): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== WEBCHAT_COOKIE) continue;
    const val = decodeURIComponent(part.slice(eq + 1).trim());
    return verifySessionCookieValue(val);
  }
  return null;
}

/** NextResponse.cookies.set에 전달할 옵션(httpOnly+Secure+Lax, 30일). */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}

/** 슬라이딩 만료 시각 계산(now + TTL). */
export function computeExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ───────────────────────── Turnstile (봇 세션 생성 차단) ─────────────────────────

/**
 * Cloudflare Turnstile 토큰 검증(세션 생성 시 1회).
 * TURNSTILE_SECRET_KEY 미설정이면 true 반환(스킵 폴백 — 개발·미도입 환경 무력화 방지).
 * 설정 시 siteverify POST, success=true만 통과. 네트워크 오류는 false(봇 통과 금지).
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string | null | undefined
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // 미설정 = 스킵 폴백
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

// ───────────────────────── 세션 귀속 운영자 ─────────────────────────

/**
 * 익명 세션을 수신할 운영자(ownerAdminId) 해석.
 * 우선순위 = lib/operator-notify 시스템봇 소유자와 동일(getSystemBotOwnerId=테오),
 * 폴백 = role∈{OWNER,ADMIN} & isActive 중 최선임(createdAt asc) 1명.
 * 아무도 없으면 null(라우트에서 503 처리).
 */
export async function resolveWebChatOwnerAdminId(db: DbClient = prisma): Promise<string | null> {
  const botOwner = await getSystemBotOwnerId();
  if (botOwner) return botOwner;
  const senior = await db.user.findFirst({
    where: { role: { in: ["OWNER", "ADMIN"] }, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return senior?.id ?? null;
}

// ───────────────────────── 킬스위치 / 일일 번역 캡 ─────────────────────────

/** 위젯 전체 정지 여부(AppSetting WEBCHAT_PAUSED="1"). fail-open(조회 실패=정지 아님). */
export async function isWebChatPaused(db: DbClient = prisma): Promise<boolean> {
  try {
    const row = await db.appSetting.findUnique({
      where: { key: WEBCHAT_PAUSED_KEY },
      select: { value: true },
    });
    const v = row?.value?.trim().toLowerCase();
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

/** 일일 번역 캡 조회(미설정·파싱실패 시 기본값). */
async function getDailyCap(db: DbClient): Promise<number> {
  try {
    const row = await db.appSetting.findUnique({
      where: { key: WEBCHAT_GLOBAL_DAILY_CAP_KEY },
      select: { value: true },
    });
    const n = Number(row?.value?.trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : WEBCHAT_DEFAULT_DAILY_CAP;
  } catch {
    return WEBCHAT_DEFAULT_DAILY_CAP;
  }
}

/** VN 타임존 날짜 기준 일일 카운터 키. */
function dailyCounterKey(now?: Date): string {
  return `WEBCHAT_TRANSLATE_COUNT_${todayVnDateString(now).replace(/-/g, "")}`;
}

/**
 * 일일 번역 카운터를 DB에서 원자 증가(재배포에도 유지 — 인메모리 금지, 기획 §9).
 * AppSetting.value(text)에 정수를 저장하고 ON CONFLICT로 원자 +1. 증가 후 값을 반환.
 */
async function incrementDailyTranslateCount(db: DbClient, now?: Date): Promise<number> {
  const key = dailyCounterKey(now);
  const rows = await db.$queryRaw<Array<{ value: string }>>`
    INSERT INTO "AppSetting" ("key", "value", "updatedAt")
    VALUES (${key}, '1', now())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = (COALESCE(NULLIF("AppSetting"."value", '')::int, 0) + 1)::text,
          "updatedAt" = now()
    RETURNING "value"
  `;
  return Number(rows[0]?.value ?? "0");
}

// ───────────────────────── 번역 (eager + 캡) ─────────────────────────

export type TranslateSkip = "same-lang" | "no-letters" | "unsupported" | "cap";

export interface MaybeTranslateResult {
  /** 성공 시 번역문, 스킵·실패 시 null. */
  translatedText: string | null;
  /** 번역 대상 언어(성공 시). */
  translatedTo: string | null;
  /** 번역 호출이 실패(예외)했는지 — OUTBOUND는 실패해도 원문 발송. */
  failed: boolean;
  /** 스킵 사유(스킵 시). */
  skipped?: TranslateSkip;
}

/**
 * 조건부 번역. lib/gemini translateText 재사용 + 4계층 절약(기획 §6).
 * 스킵(호출 안 함): ① source==target(방문자 locale=ko 등) ② letter 없음(숫자·이모지·공백)
 *   ③ target 미지원 언어 ④ 일일 캡 초과. 캡 카운트는 실제 호출 직전 원자 증가.
 * 실패(예외): translatedText=null, failed=true — 저장은 계속(발송 누락 금지).
 */
export async function maybeTranslate(
  text: string,
  target: string,
  sourceLocale?: string,
  db: DbClient = prisma
): Promise<MaybeTranslateResult> {
  const none = (skipped: TranslateSkip): MaybeTranslateResult => ({
    translatedText: null,
    translatedTo: null,
    failed: false,
    skipped,
  });

  // ① source==target — 방문자 locale이 ko거나 동일 언어면 번역 불필요
  if (sourceLocale && sourceLocale === target) return none("same-lang");
  // ③ 미지원 대상 언어(hi 등 미래 언어) — 번역 불가
  if (!TRANSLATE_TARGETS.has(target)) return none("unsupported");
  // ② letter 없음 — 숫자·이모지·공백뿐이면 원문 그대로
  if (!/\p{L}/u.test(text)) return none("no-letters");

  // ④ 일일 캡 — 원자 증가 후 초과면 스킵(이번 호출은 하지 않음)
  const cap = await getDailyCap(db);
  const count = await incrementDailyTranslateCount(db);
  if (count > cap) return none("cap");

  try {
    const out = await translateText(text, target as TranslateTarget);
    return { translatedText: out, translatedTo: target, failed: false };
  } catch {
    return { translatedText: null, translatedTo: null, failed: true };
  }
}

// ───────────────────────── 스로틀 (세션 + ipHash) ─────────────────────────

export interface ThrottleResult {
  allowed: boolean;
  /** 차단 사유 — 로그·응답 meta용. */
  by?: "session" | "ip";
}

/**
 * 세션 15/분 · ipHash 40/분 스로틀(lib/rate-limit 재사용). 초과 시 SecurityEvent RATE_LIMIT 기록.
 * 세션이 없는(첫 생성) 경로는 ipHash만 검사하도록 sessionId=null 허용.
 */
export async function checkWebChatThrottle(
  sessionId: string | null,
  ipHash: string,
  req: Request
): Promise<ThrottleResult> {
  const sessOk = sessionId
    ? checkRateLimit(`webchat:sess:${sessionId}`, THROTTLE_SESSION).allowed
    : true;
  const ipOk = checkRateLimit(`webchat:ip:${ipHash}`, THROTTLE_IP).allowed;
  if (!sessOk || !ipOk) {
    const by = !sessOk ? "session" : "ip";
    await recordSecurityEvent({
      type: "RATE_LIMIT",
      ip: clientIp(req.headers),
      path: "/api/webchat/messages",
      meta: { scope: "webchat", by },
    });
    return { allowed: false, by };
  }
  return { allowed: true };
}

/** 인박스 미리보기 절삭(≤120자). */
export function previewText(text: string): string {
  const t = text.trim();
  return t.length > PREVIEW_MAX_LEN ? t.slice(0, PREVIEW_MAX_LEN) : t;
}
