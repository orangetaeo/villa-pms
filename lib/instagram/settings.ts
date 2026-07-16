// lib/instagram/settings.ts — Instagram 연동 설정(AppSetting) 단일 접근점
//
// 키 4종 (AppSetting):
//   IG_ACCESS_TOKEN    — 장기 액세스 토큰. AES-256-GCM 암호문(lib/secret-crypto, 키=ZALO_CREDS_KEY 재사용).
//   IG_USER_ID         — Instagram 비즈니스 계정 id (평문).
//   IG_AUTOPOST_PAUSED — 발행 킬스위치. "1"/"true"면 발행 cron이 스킵(operator-notify 킬스위치 패턴 재사용).
//   IG_GRAPH_BASE      — Graph API base URL 오버라이드(평문, 미설정 시 기본값). 버전 상승 대비.
//
// ★ 누수/보안: IG_ACCESS_TOKEN 평문은 이 모듈 밖으로 절대 반환하지 않는다(설정 여부·말미 4자만 노출 헬퍼 제공).
//   AppSetting 접근은 prisma 직접(범용 유틸 없음) — operator-notify.getAdminNotifyGroupId 패턴과 동일.
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";
import type { DbClient } from "@/lib/availability";

export const IG_ACCESS_TOKEN_KEY = "IG_ACCESS_TOKEN";
export const IG_USER_ID_KEY = "IG_USER_ID";
export const IG_AUTOPOST_PAUSED_KEY = "IG_AUTOPOST_PAUSED";
export const IG_GRAPH_BASE_KEY = "IG_GRAPH_BASE";
/** 장기 토큰 만료 시각(ISO, now+expires_in). 갱신·수동 저장 시 upsert. */
export const IG_TOKEN_EXPIRES_AT_KEY = "IG_TOKEN_EXPIRES_AT";
/** 마지막 갱신·수동 저장 시각(ISO). 주 1회 갱신 게이트 기준. */
export const IG_TOKEN_REFRESHED_AT_KEY = "IG_TOKEN_REFRESHED_AT";

/** 수동 저장 시 만료 가정치(장기 토큰 발급 직후 60일). */
export const IG_LONG_LIVED_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/** Instagram API with Instagram Login 기본 base. IG_GRAPH_BASE로 오버라이드 가능. */
export const IG_GRAPH_BASE_DEFAULT = "https://graph.instagram.com/v23.0";

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
  await db.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/** 복호화된 액세스 토큰(평문) — 미설정·복호화 실패 시 null. ★ 발행 클라이언트 내부에서만 호출. */
export async function getIgAccessToken(db: DbClient = prisma): Promise<string | null> {
  const enc = await readSetting(db, IG_ACCESS_TOKEN_KEY);
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    // 복호화 실패 로그에 토큰 절대 미포함 — 키만.
    console.error("[instagram/settings] IG_ACCESS_TOKEN 복호화 실패");
    return null;
  }
}

/** 액세스 토큰 저장(암호화). 빈 문자열이면 무시(기존값 보존). */
export async function setIgAccessToken(token: string, db: DbClient = prisma): Promise<void> {
  const trimmed = token.trim();
  if (trimmed.length === 0) return;
  await writeSetting(db, IG_ACCESS_TOKEN_KEY, encryptSecret(trimmed));
}

/** 토큰 설정 여부 + 말미 4자(평문 미노출) — 설정 화면 표시용. */
export async function getIgAccessTokenMeta(
  db: DbClient = prisma
): Promise<{ set: boolean; last4: string | null }> {
  const plain = await getIgAccessToken(db);
  if (!plain) return { set: false, last4: null };
  return { set: true, last4: plain.slice(-4) };
}

export async function getIgUserId(db: DbClient = prisma): Promise<string | null> {
  return readSetting(db, IG_USER_ID_KEY);
}

export async function setIgUserId(userId: string, db: DbClient = prisma): Promise<void> {
  await writeSetting(db, IG_USER_ID_KEY, userId.trim());
}

/** 자동 발행 일시정지 여부 — fail-open. "1"/"true"(trim·소문자)만 true. */
export async function isAutopostPaused(db: DbClient = prisma): Promise<boolean> {
  const v = (await readSetting(db, IG_AUTOPOST_PAUSED_KEY))?.toLowerCase();
  return v === "1" || v === "true";
}

export async function setAutopostPaused(paused: boolean, db: DbClient = prisma): Promise<void> {
  await writeSetting(db, IG_AUTOPOST_PAUSED_KEY, paused ? "1" : "0");
}

/** Graph API base URL — IG_GRAPH_BASE 오버라이드 또는 기본값. 끝 슬래시 제거. */
export async function getIgGraphBase(db: DbClient = prisma): Promise<string> {
  const v = await readSetting(db, IG_GRAPH_BASE_KEY);
  return (v ?? IG_GRAPH_BASE_DEFAULT).replace(/\/$/, "");
}

/**
 * Graph API 호스트 루트(버전 경로 제거) — refresh_access_token 엔드포인트는 버전 경로 없이
 * 호스트 루트에 위치(예: https://graph.instagram.com). base 끝의 /vNN(.N)? 세그먼트를 제거한다.
 */
export async function getIgGraphHostRoot(db: DbClient = prisma): Promise<string> {
  const base = await getIgGraphBase(db);
  return base.replace(/\/v\d+(\.\d+)?$/i, "");
}

/** 토큰 만료 시각(ISO) — 미설정 시 null. 설정 화면 D-일 표시·갱신 긴급도 판단용. */
export async function getIgTokenExpiresAt(db: DbClient = prisma): Promise<string | null> {
  return readSetting(db, IG_TOKEN_EXPIRES_AT_KEY);
}

/** 마지막 갱신·수동 저장 시각(ISO) — 미설정 시 null. 주 1회 갱신 게이트 기준. */
export async function getIgTokenRefreshedAt(db: DbClient = prisma): Promise<string | null> {
  return readSetting(db, IG_TOKEN_REFRESHED_AT_KEY);
}

/** 갱신·수동 저장 시 만료/갱신 타임스탬프 동시 기록(둘 다 ISO). */
export async function setIgTokenTimestamps(
  expiresAtIso: string,
  refreshedAtIso: string,
  db: DbClient = prisma
): Promise<void> {
  await writeSetting(db, IG_TOKEN_EXPIRES_AT_KEY, expiresAtIso);
  await writeSetting(db, IG_TOKEN_REFRESHED_AT_KEY, refreshedAtIso);
}

/** 수동 토큰 저장 시 타임스탬프 리셋(지금·now+60일 가정). 갱신 cron이 이후 실측치로 보정. */
export async function resetIgTokenTimestampsForManualSave(db: DbClient = prisma): Promise<void> {
  const now = new Date();
  const expires = new Date(now.getTime() + IG_LONG_LIVED_TOKEN_TTL_MS);
  await setIgTokenTimestamps(expires.toISOString(), now.toISOString(), db);
}
