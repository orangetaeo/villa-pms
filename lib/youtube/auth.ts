// lib/youtube/auth.ts — YouTube OAuth 2.0 토큰 관리 (youtube-shorts-s1, INTEG)
//
// 역할: refresh token → access token 교환·캐시(자동 갱신) + OAuth 인증 코드 흐름 헬퍼.
//   - refresh token / client secret 은 lib/youtube/settings.ts 에서 복호화해서 가져온다(그 모듈이 단일 접근점).
//   - access token 캐시(YT_ACCESS_TOKEN_CACHE)와 CSRF state(YT_OAUTH_STATE)는 이 모듈이 소유·관리.
//
// ★ 보안/누수 규율:
//   - access token·refresh token 평문은 어떤 응답·로그에도 노출하지 않는다(캐시는 AES-256-GCM 암호화 저장).
//   - 토큰 교환 실패는 throw 하지 않고 { ok:false, reason } 로 반환(인스타 publish 패턴 — upload.ts가 FAILED 처리).
//   - refresh_token 값 자체를 반환하는 건 exchangeYoutubeCode()뿐이며, 그 호출부(OAuth callback)는
//     받은 즉시 암호화 저장하고 응답 본문·리다이렉트에 절대 싣지 않는다.
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";
import {
  getYoutubeClientId,
  getYoutubeClientSecret,
  getYoutubeRefreshToken,
} from "@/lib/youtube/settings";

// ── Google OAuth 엔드포인트 ──
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * 요청 스코프(계약 §2): 업로드(민감) + 읽기(연결 검증·Analytics 준비).
 * youtube.upload 는 sensitive scope — 프로덕션 게시 시 "미확인 앱" 경고가 뜨나 자기 채널 운영엔 문제 없음.
 */
export const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

// ── AppSetting 키(이 모듈 소유) ──
/** 액세스 토큰 캐시. AES-256-GCM 암호문(JSON {token, expiresAt}). */
export const YT_ACCESS_TOKEN_CACHE_KEY = "YT_ACCESS_TOKEN_CACHE";
/** OAuth CSRF state(평문 JSON {state, exp}). 일회성 — callback에서 소진(삭제). */
export const YT_OAUTH_STATE_KEY = "YT_OAUTH_STATE";

/** 액세스 토큰 만료 5분 전이면 미리 갱신(클록 스큐·요청 지연 여유). */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
/** OAuth state 유효 시간: 10분. */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const HTTP_TIMEOUT_MS = 20_000;

// ===================== 앱 base URL · redirect URI =====================

/** 앱 공개 base URL — NEXTAUTH_URL 우선(로컬·프로덕션 겸용). 끝 슬래시 제거. */
export function getAppBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ??
    process.env.PUBLIC_BASE_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/** OAuth redirect URI — GCP OAuth 클라이언트에 등록해야 하는 값과 반드시 일치. */
export function getYoutubeRedirectUri(): string {
  return `${getAppBaseUrl()}/api/youtube/oauth/callback`;
}

// ===================== 동의 URL 생성 =====================

export interface YoutubeConsentUrlInput {
  clientId: string;
  state: string;
  /** 미지정 시 getYoutubeRedirectUri() 사용. */
  redirectUri?: string;
}

/**
 * Google OAuth 동의 화면 URL.
 * access_type=offline + prompt=consent 로 매번 refresh_token 을 확실히 받는다.
 */
export function buildYoutubeConsentUrl(input: YoutubeConsentUrlInput): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri ?? getYoutubeRedirectUri(),
    response_type: "code",
    scope: YOUTUBE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

// ===================== OAuth state (CSRF, 일회성) =====================

interface StoredState {
  state: string;
  exp: number; // epoch ms
}

/**
 * 새 CSRF state 생성 + 저장(10분 유효). 반환값을 동의 URL의 state 로 사용.
 * 기존 미소진 state 는 덮어써진다(마지막 시작 요청만 유효).
 */
export async function createYoutubeOauthState(db: DbClient = prisma): Promise<string> {
  const state = crypto.randomBytes(32).toString("hex");
  const payload: StoredState = { state, exp: Date.now() + OAUTH_STATE_TTL_MS };
  await db.appSetting.upsert({
    where: { key: YT_OAUTH_STATE_KEY },
    update: { value: JSON.stringify(payload) },
    create: { key: YT_OAUTH_STATE_KEY, value: JSON.stringify(payload) },
  });
  return state;
}

/**
 * callback 의 state 검증 + 소진(항상 삭제 — 일회성). 재사용·불일치·만료 시 false.
 * ★ 성공/실패와 무관하게 저장된 state 는 삭제한다(재생 공격 차단).
 */
export async function consumeYoutubeOauthState(
  received: string | null,
  db: DbClient = prisma
): Promise<boolean> {
  const row = await db.appSetting.findUnique({
    where: { key: YT_OAUTH_STATE_KEY },
    select: { value: true },
  });
  // 무조건 소진(일회성) — 검증 결과와 무관하게 제거.
  await db.appSetting.deleteMany({ where: { key: YT_OAUTH_STATE_KEY } });

  if (!received || !row?.value) return false;
  let parsed: StoredState;
  try {
    parsed = JSON.parse(row.value) as StoredState;
  } catch {
    return false;
  }
  if (!parsed?.state || typeof parsed.exp !== "number") return false;
  if (Date.now() > parsed.exp) return false; // 만료
  // 길이 다르면 timingSafeEqual 이 throw → 먼저 길이 비교.
  if (parsed.state.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(parsed.state), Buffer.from(received));
}

// ===================== 인증 코드 → refresh token 교환 =====================

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number; // seconds
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export type YoutubeCodeExchangeResult =
  | { ok: true; refreshToken: string }
  | { ok: false; reason: string };

/**
 * OAuth callback 의 authorization code → refresh token 교환.
 * ★ 반환된 refresh token 은 호출부가 즉시 암호화 저장하고 어디에도 노출하지 않는다.
 */
export async function exchangeYoutubeCode(
  code: string,
  db: DbClient = prisma
): Promise<YoutubeCodeExchangeResult> {
  const [clientId, clientSecret] = await Promise.all([
    getYoutubeClientId(db),
    getYoutubeClientSecret(db),
  ]);
  if (!clientId) return { ok: false, reason: "client_id_missing" };
  if (!clientSecret) return { ok: false, reason: "client_secret_missing" };

  let json: GoogleTokenResponse;
  try {
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getYoutubeRedirectUri(),
        grant_type: "authorization_code",
      }).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    json = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
    if (!res.ok) {
      // error_description 에 토큰이 담기지 않으므로 코드만 노출(민감정보 없음).
      return { ok: false, reason: json.error ?? `token_exchange_failed_${res.status}` };
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.name : "token_exchange_error" };
  }

  if (!json.refresh_token) {
    // prompt=consent 로 요청했는데도 없으면, 이미 이전에 부여된 계정 — 재동의 필요.
    return { ok: false, reason: "no_refresh_token" };
  }
  return { ok: true, refreshToken: json.refresh_token };
}

// ===================== access token 캐시 + 자동 갱신 =====================

interface AccessTokenCache {
  token: string;
  expiresAt: string; // ISO
}

async function readAccessTokenCache(db: DbClient): Promise<AccessTokenCache | null> {
  const row = await db.appSetting.findUnique({
    where: { key: YT_ACCESS_TOKEN_CACHE_KEY },
    select: { value: true },
  });
  const enc = row?.value?.trim();
  if (!enc) return null;
  try {
    const parsed = JSON.parse(decryptSecret(enc)) as AccessTokenCache;
    if (!parsed?.token || !parsed?.expiresAt) return null;
    return parsed;
  } catch {
    // 복호화·파싱 실패 로그에 토큰 미포함 — 키만.
    console.error("[youtube/auth] YT_ACCESS_TOKEN_CACHE 복호화 실패");
    return null;
  }
}

async function writeAccessTokenCache(db: DbClient, cache: AccessTokenCache): Promise<void> {
  const enc = encryptSecret(JSON.stringify(cache));
  await db.appSetting.upsert({
    where: { key: YT_ACCESS_TOKEN_CACHE_KEY },
    update: { value: enc },
    create: { key: YT_ACCESS_TOKEN_CACHE_KEY, value: enc },
  });
}

export type YoutubeAccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: string };

/**
 * 유효한 access token 반환 — 캐시가 살아있으면(만료 5분 전까지) 재사용, 아니면 refresh token 으로 갱신.
 * ★ 미설정(클라이언트/토큰)·갱신 실패 시 throw 하지 않고 { ok:false, reason }(한국어 사유) 반환.
 *   upload.ts 등 호출부가 FAILED 처리·경보에 사용한다.
 */
export async function getYoutubeAccessToken(db: DbClient = prisma): Promise<YoutubeAccessTokenResult> {
  // 1) 캐시 유효성 확인.
  const cached = await readAccessTokenCache(db);
  if (cached && Date.parse(cached.expiresAt) - REFRESH_SKEW_MS > Date.now()) {
    return { ok: true, accessToken: cached.token };
  }

  // 2) refresh 준비물 확인 — 각각 명확한 사유 반환.
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    getYoutubeClientId(db),
    getYoutubeClientSecret(db),
    getYoutubeRefreshToken(db),
  ]);
  if (!clientId) return { ok: false, reason: "YT_CLIENT_ID 미설정 — OAuth 클라이언트 ID를 설정하세요." };
  if (!clientSecret) return { ok: false, reason: "YT_CLIENT_SECRET 미설정 — OAuth 클라이언트 시크릿을 설정하세요." };
  if (!refreshToken) {
    return { ok: false, reason: "유튜브 미연결 — 관리자 화면에서 '유튜브 연결'을 먼저 완료하세요." };
  }

  // 3) refresh token → access token 교환.
  let json: GoogleTokenResponse;
  try {
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    json = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
    if (!res.ok) {
      // invalid_grant = refresh token 만료·취소 → 재연결 필요.
      if (json.error === "invalid_grant") {
        return { ok: false, reason: "유튜브 연결 만료·취소됨 — 관리자 화면에서 다시 연결하세요." };
      }
      return { ok: false, reason: `액세스 토큰 갱신 실패(${res.status}): ${json.error ?? "unknown"}` };
    }
  } catch (e) {
    return { ok: false, reason: `액세스 토큰 갱신 오류: ${e instanceof Error ? e.name : "error"}` };
  }

  if (!json.access_token) {
    return { ok: false, reason: "액세스 토큰 응답 누락" };
  }

  // 4) 캐시 저장(만료 시각 = now + expires_in). expires_in 없으면 보수적으로 55분.
  const ttlMs = (json.expires_in && json.expires_in > 0 ? json.expires_in : 55 * 60) * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await writeAccessTokenCache(db, { token: json.access_token, expiresAt });

  return { ok: true, accessToken: json.access_token };
}
