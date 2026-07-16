// lib/youtube/settings.ts — YouTube 연동 설정(AppSetting) 단일 접근점 (youtube-shorts-s1)
//
// lib/instagram/settings.ts 패턴 재사용. 키 7종 (AppSetting):
//   YT_CLIENT_ID        — OAuth 클라이언트 ID (평문 — 비밀성 낮음).
//   YT_CLIENT_SECRET    — OAuth 클라이언트 시크릿. AES-256-GCM 암호문(lib/secret-crypto, 키=ZALO_CREDS_KEY 재사용).
//   YT_REFRESH_TOKEN    — OAuth refresh token. AES-256-GCM 암호문. ★값은 OAuth callback(INTEG)이 저장, 설정 API는 연결 여부만 노출.
//   YT_AUTOPOST_PAUSED  — 업로드 킬스위치. 기본 "1"(정지) — 미설정·"1"·"true"면 정지(fail-safe: 자동 업로드는 명시적 해제해야 동작).
//   YT_SHORTS_PER_DAY   — 일 자동 초안 건수. 기본 0(끔). ≥1이면 draft cron이 YoutubeShort 생성.
//   YT_PRIVACY_STATUS   — 업로드 시 privacyStatus. 기본 "unlisted"(감사 전 안전값). 화이트리스트 public/unlisted/private.
//   YT_DAILY_UPLOAD_CAP — 일 업로드 상한(쿼터 가드). 기본 6.
//
// ★ 누수/보안: YT_CLIENT_SECRET·YT_REFRESH_TOKEN 평문은 이 모듈 밖으로 반환하지 않는다(설정 여부만 노출 헬퍼 제공).
//   내부 복호화 getter(getYoutubeClientSecret·getYoutubeRefreshToken)는 auth.ts(토큰 교환) 내부에서만 호출.
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";
import type { DbClient } from "@/lib/availability";

export const YT_CLIENT_ID_KEY = "YT_CLIENT_ID";
export const YT_CLIENT_SECRET_KEY = "YT_CLIENT_SECRET";
export const YT_REFRESH_TOKEN_KEY = "YT_REFRESH_TOKEN";
export const YT_AUTOPOST_PAUSED_KEY = "YT_AUTOPOST_PAUSED";
export const YT_SHORTS_PER_DAY_KEY = "YT_SHORTS_PER_DAY";
export const YT_PRIVACY_STATUS_KEY = "YT_PRIVACY_STATUS";
export const YT_DAILY_UPLOAD_CAP_KEY = "YT_DAILY_UPLOAD_CAP";

/** privacyStatus 화이트리스트 — videos.insert status.privacyStatus 허용값. */
export const YT_PRIVACY_STATUSES = ["public", "unlisted", "private"] as const;
export type YtPrivacyStatus = (typeof YT_PRIVACY_STATUSES)[number];
export const YT_PRIVACY_STATUS_DEFAULT: YtPrivacyStatus = "unlisted";

export const YT_DAILY_UPLOAD_CAP_DEFAULT = 6;

async function readSetting(db: DbClient, key: string): Promise<string | null> {
  try {
    const row = await db.appSetting.findUnique({ where: { key }, select: { value: true } });
    const v = row?.value?.trim();
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

async function writeSetting(db: DbClient, key: string, value: string): Promise<void> {
  await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

// ── 클라이언트 ID (평문) ──
export async function getYoutubeClientId(db: DbClient = prisma): Promise<string | null> {
  return readSetting(db, YT_CLIENT_ID_KEY);
}
export async function setYoutubeClientId(clientId: string, db: DbClient = prisma): Promise<void> {
  await writeSetting(db, YT_CLIENT_ID_KEY, clientId.trim());
}

// ── 클라이언트 시크릿 (암호화, write-only) ──
/** 복호화된 클라이언트 시크릿 — 미설정·복호화 실패 시 null. ★auth.ts 내부에서만 호출. */
export async function getYoutubeClientSecret(db: DbClient = prisma): Promise<string | null> {
  const enc = await readSetting(db, YT_CLIENT_SECRET_KEY);
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    console.error("[youtube/settings] YT_CLIENT_SECRET 복호화 실패");
    return null;
  }
}
/** 클라이언트 시크릿 저장(암호화). 빈 문자열이면 무시(기존값 보존). */
export async function setYoutubeClientSecret(secret: string, db: DbClient = prisma): Promise<void> {
  const trimmed = secret.trim();
  if (trimmed.length === 0) return;
  await writeSetting(db, YT_CLIENT_SECRET_KEY, encryptSecret(trimmed));
}
/** 시크릿 설정 여부만(평문 미노출) — 설정 화면용. */
export async function isYoutubeClientSecretSet(db: DbClient = prisma): Promise<boolean> {
  return (await readSetting(db, YT_CLIENT_SECRET_KEY)) !== null;
}

// ── refresh token (암호화) — 값은 OAuth callback이 저장, 설정 API는 연결 여부만 노출 ──
/** 복호화된 refresh token — 미설정·복호화 실패 시 null. ★auth.ts 내부에서만 호출. */
export async function getYoutubeRefreshToken(db: DbClient = prisma): Promise<string | null> {
  const enc = await readSetting(db, YT_REFRESH_TOKEN_KEY);
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    console.error("[youtube/settings] YT_REFRESH_TOKEN 복호화 실패");
    return null;
  }
}
/** refresh token 저장(암호화). ★OAuth callback(INTEG) 전용. 빈 문자열이면 무시. */
export async function setYoutubeRefreshToken(token: string, db: DbClient = prisma): Promise<void> {
  const trimmed = token.trim();
  if (trimmed.length === 0) return;
  await writeSetting(db, YT_REFRESH_TOKEN_KEY, encryptSecret(trimmed));
}
/** refresh token(=OAuth 연결) 설정 여부 — 설정 화면 연결 상태 표시용. */
export async function isYoutubeRefreshTokenSet(db: DbClient = prisma): Promise<boolean> {
  return (await readSetting(db, YT_REFRESH_TOKEN_KEY)) !== null;
}

// ── 업로드 킬스위치 (기본 정지) ──
/**
 * 자동 업로드 일시정지 여부 — ★fail-safe: 미설정이면 정지(true).
 * "0"/"false"(trim·소문자)로 명시 해제해야만 업로드가 동작한다.
 */
export async function isYoutubeAutopostPaused(db: DbClient = prisma): Promise<boolean> {
  const v = (await readSetting(db, YT_AUTOPOST_PAUSED_KEY))?.toLowerCase();
  if (v == null) return true; // 미설정 = 정지(안전값)
  return !(v === "0" || v === "false");
}
export async function setYoutubeAutopostPaused(paused: boolean, db: DbClient = prisma): Promise<void> {
  await writeSetting(db, YT_AUTOPOST_PAUSED_KEY, paused ? "1" : "0");
}

// ── 일 자동 초안 건수 (기본 0=끔) ──
/** 일 자동 초안 건수(0~10). 미설정·비정상·≤0이면 0(끔 — 기존 동작 무변경). */
export async function getYoutubeShortsPerDay(db: DbClient = prisma): Promise<number> {
  const n = parseInt((await readSetting(db, YT_SHORTS_PER_DAY_KEY)) ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(10, n);
}
export async function setYoutubeShortsPerDay(n: number, db: DbClient = prisma): Promise<void> {
  const clamped = Number.isFinite(n) ? Math.max(0, Math.min(10, Math.floor(n))) : 0;
  await writeSetting(db, YT_SHORTS_PER_DAY_KEY, String(clamped));
}

// ── privacyStatus (기본 unlisted, 화이트리스트) ──
export async function getYoutubePrivacyStatus(db: DbClient = prisma): Promise<YtPrivacyStatus> {
  const v = (await readSetting(db, YT_PRIVACY_STATUS_KEY))?.toLowerCase();
  return (YT_PRIVACY_STATUSES as readonly string[]).includes(v ?? "")
    ? (v as YtPrivacyStatus)
    : YT_PRIVACY_STATUS_DEFAULT;
}
/** privacyStatus 저장 — 화이트리스트 외 값은 throw(호출부 400). */
export async function setYoutubePrivacyStatus(status: string, db: DbClient = prisma): Promise<void> {
  const v = status.trim().toLowerCase();
  if (!(YT_PRIVACY_STATUSES as readonly string[]).includes(v)) {
    throw new Error(`INVALID_PRIVACY_STATUS: ${status}`);
  }
  await writeSetting(db, YT_PRIVACY_STATUS_KEY, v);
}

// ── 일 업로드 상한 (쿼터 가드, 기본 6) ──
export async function getYoutubeDailyUploadCap(db: DbClient = prisma): Promise<number> {
  const n = parseInt((await readSetting(db, YT_DAILY_UPLOAD_CAP_KEY)) ?? "", 10);
  if (!Number.isFinite(n) || n < 0) return YT_DAILY_UPLOAD_CAP_DEFAULT;
  return n;
}
export async function setYoutubeDailyUploadCap(n: number, db: DbClient = prisma): Promise<void> {
  const clamped = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : YT_DAILY_UPLOAD_CAP_DEFAULT;
  await writeSetting(db, YT_DAILY_UPLOAD_CAP_KEY, String(clamped));
}
