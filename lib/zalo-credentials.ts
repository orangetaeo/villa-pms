// [SHARED-MODULE] from Nike src/lib/zalo-credentials.ts (v1.x)
// villa-pms 적응: prisma 명명 export(import { prisma }), User.status→isActive.
// ADR-0007: 멀티 계정 — kind(SYSTEM_BOT|ADMIN_PERSONAL)·userId(필수)로 분기.
//   loadAllActiveCredentials(부팅), loadCredentialsForAccount(개인/시스템 키별).
// 보안(ADR-0006 D6): credentials는 AES-256-GCM 암호문,
// 절대 평문/응답/로그/AuditLog 노출 금지. findUnique/findFirst 시 credentials는 명시 select로만 로드.
import { ZaloAccountKind } from "@prisma/client";
import crypto from "crypto";

import { prisma } from "./prisma";

const ALGORITHM = "aes-256-gcm";
// 고정 salt 제거 (보안 P0-2): 신규 저장은 레코드별 무작위 salt를 암호문에 포함(salt:iv:authTag:ct).
// 기존 저장본(iv:authTag:ct, 3세그먼트)은 아래 고정 salt로 복호화(점진 마이그레이션) → 재저장 시 신형 승급.
const LEGACY_SALT = "zalo-creds-salt";
const SALT_LEN = 16;

function getKeySource(): string {
  const key = process.env.ZALO_CREDS_KEY;
  if (!key) throw new Error("ZALO_CREDS_KEY environment variable is required");
  return key;
}

function deriveKey(salt: crypto.BinaryLike): Buffer {
  return crypto.scryptSync(getKeySource(), salt, 32);
}

function encrypt(text: string): string {
  const salt = crypto.randomBytes(SALT_LEN); // 레코드별 무작위 salt (사전계산·레인보우 방어)
  const iv = crypto.randomBytes(16);
  const key = deriveKey(salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${salt.toString("hex")}:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decrypt(data: string): string {
  const parts = data.split(":");
  let salt: crypto.BinaryLike;
  let ivHex: string, authTagHex: string, encrypted: string;
  if (parts.length === 4) {
    // 신형: salt:iv:authTag:encrypted
    salt = Buffer.from(parts[0], "hex");
    ivHex = parts[1];
    authTagHex = parts[2];
    encrypted = parts[3];
  } else if (parts.length === 3) {
    // 레거시: iv:authTag:encrypted — 고정 salt로 복호화(폴백)
    salt = LEGACY_SALT;
    ivHex = parts[0];
    authTagHex = parts[1];
    encrypted = parts[2];
  } else {
    throw new Error("Invalid credential format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const key = deriveKey(salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// 테스트 전용: 신형 왕복 + 레거시 폴백 검증용 (lib/zalo-credentials.test.ts).
export const __cryptoTest = { encrypt, decrypt, LEGACY_SALT };

export interface ZaloCredentials {
  imei: string;
  cookie: unknown;
  userAgent: string;
}

/**
 * Zalo 봇 자격증명을 DB에 암호화 저장 (ADR-0007 — kind·userId 필수).
 * upsert 키: (userId, kind) 복합 — 관리자 1명당 kind별 1계정. zaloUserId는 봇 own id로 갱신.
 * @returns ZaloAccount.id
 */
export async function saveCredentials(
  zaloUserId: string,
  creds: ZaloCredentials,
  userId: string,
  kind: ZaloAccountKind,
  displayName?: string
): Promise<string> {
  const encrypted = encrypt(JSON.stringify(creds));
  const account = await prisma.zaloAccount.upsert({
    where: { userId_kind: { userId, kind } },
    update: {
      zaloUserId,
      credentials: encrypted,
      isActive: true,
      lastConnected: new Date(),
      ...(displayName && { displayName }),
    },
    create: {
      zaloUserId,
      kind,
      userId,
      credentials: encrypted,
      isActive: true,
      lastConnected: new Date(),
      displayName,
    },
    select: { id: true }, // credentials 응답 미포함 (D6.2)
  });
  return account.id;
}

/**
 * Zalo 봇 자격증명 비활성화 (연결 해제 시). ADR-0007 — accountId 기준(정확한 단일 행).
 */
export async function setCredentialsInactive(accountId: string): Promise<void> {
  await prisma.zaloAccount.updateMany({
    where: { id: accountId },
    data: { isActive: false },
  });
}

/** 복호화된 계정 자격증명 (ADR-0007 — kind 포함). credentials는 평문 미노출 책임 호출부에. */
export interface LoadedAccountCredentials {
  accountId: string;
  zaloUserId: string;
  userId: string;
  kind: ZaloAccountKind;
  displayName: string | null;
  credentials: ZaloCredentials;
}

/** account 행 → 복호화 결과 (실패 시 null — 로그에 credential 절대 미포함). */
function decryptAccountRow(account: {
  id: string;
  zaloUserId: string;
  userId: string;
  kind: ZaloAccountKind;
  displayName: string | null;
  credentials: string | null;
}): LoadedAccountCredentials | null {
  if (!account.credentials) return null;
  try {
    const decrypted = decrypt(account.credentials);
    return {
      accountId: account.id,
      zaloUserId: account.zaloUserId,
      userId: account.userId,
      kind: account.kind,
      displayName: account.displayName,
      credentials: JSON.parse(decrypted),
    };
  } catch {
    // 복호화 실패 로그에도 credential 절대 미포함 (D6.2) — accountId만
    console.error("[ZaloCreds] Failed to decrypt credentials for account:", account.id);
    return null;
  }
}

const CRED_SELECT = {
  id: true,
  zaloUserId: true,
  userId: true,
  kind: true,
  displayName: true,
  credentials: true,
} as const;

/**
 * 부팅 시 모든 활성 계정 자격증명 로드 (ADR-0007 — 풀 connectAllActive용).
 * 복호화 실패 행은 제외. credentials는 여기서만 명시 select (D6.2).
 */
export async function loadAllActiveCredentials(): Promise<LoadedAccountCredentials[]> {
  const accounts = await prisma.zaloAccount.findMany({
    where: { isActive: true },
    orderBy: { lastConnected: "desc" },
    select: CRED_SELECT,
  });
  const out: LoadedAccountCredentials[] = [];
  for (const a of accounts) {
    const d = decryptAccountRow(a);
    if (d) out.push(d);
  }
  return out;
}

/**
 * 특정 관리자×kind 계정 자격증명 로드 (개인 채팅·시스템봇 분기 재연결용).
 */
export async function loadCredentialsForAccount(
  userId: string,
  kind: ZaloAccountKind
): Promise<LoadedAccountCredentials | null> {
  const account = await prisma.zaloAccount.findUnique({
    where: { userId_kind: { userId, kind } },
    select: CRED_SELECT,
  });
  if (!account) return null;
  return decryptAccountRow(account);
}

/**
 * 활성 시스템봇 소유자(테오) userId 조회 (credentials 미포함). 미러 귀속·발송 분기용.
 */
export async function getSystemBotOwnerId(): Promise<string | null> {
  const account = await prisma.zaloAccount.findFirst({
    where: { kind: ZaloAccountKind.SYSTEM_BOT, isActive: true },
    orderBy: { lastConnected: "desc" },
    select: { userId: true },
  });
  return account?.userId ?? null;
}
