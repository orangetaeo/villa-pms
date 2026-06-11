// [SHARED-MODULE] from Nike src/lib/zalo-credentials.ts
import crypto from "crypto";

import prisma from "./prisma";

const ALGORITHM = "aes-256-gcm";
function getKeySource(): string {
  const key = process.env.ZALO_CREDS_KEY;
  if (!key) throw new Error("ZALO_CREDS_KEY environment variable is required");
  return key;
}

function getDerivedKey() {
  return crypto.scryptSync(getKeySource(), "zalo-creds-salt", 32);
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = getDerivedKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decrypt(data: string): string {
  const [ivHex, authTagHex, encrypted] = data.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const key = getDerivedKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export interface ZaloCredentials {
  imei: string;
  cookie: unknown;
  userAgent: string;
}

/**
 * Zalo 자격증명을 DB에 암호화 저장 (유저에 연결)
 */
export async function saveCredentials(
  zaloUserId: string,
  creds: ZaloCredentials,
  userId?: string,
  displayName?: string
): Promise<string> {
  const encrypted = encrypt(JSON.stringify(creds));
  const account = await prisma.zaloAccount.upsert({
    where: { zaloUserId },
    update: {
      credentials: encrypted,
      isActive: true,
      lastConnected: new Date(),
      ...(userId && { userId }),
      ...(displayName && { displayName }),
    },
    create: {
      zaloUserId,
      credentials: encrypted,
      isActive: true,
      lastConnected: new Date(),
      userId: userId || null,
      displayName,
    },
  });
  return account.id;
}

/**
 * Zalo 자격증명 비활성화 (연결 해제 시)
 */
export async function setCredentialsInactive(zaloUserId: string): Promise<void> {
  await prisma.zaloAccount.updateMany({
    where: { zaloUserId },
    data: { isActive: false },
  });
}

/**
 * 특정 유저의 Zalo 자격증명 로드
 */
export async function loadCredentialsForUser(userId: string): Promise<{
  accountId: string;
  zaloUserId: string;
  credentials: ZaloCredentials;
} | null> {
  const account = await prisma.zaloAccount.findUnique({
    where: { userId },
  });
  if (!account?.credentials) return null;

  try {
    const decrypted = decrypt(account.credentials);
    return {
      accountId: account.id,
      zaloUserId: account.zaloUserId,
      credentials: JSON.parse(decrypted),
    };
  } catch {
    console.error("[ZaloCreds] Failed to decrypt credentials for user:", userId);
    return null;
  }
}

/**
 * DB에서 활성 Zalo 계정의 자격증명 로드 (레거시 호환 — userId 없는 경우)
 */
export async function loadCredentials(): Promise<{
  accountId: string;
  zaloUserId: string;
  credentials: ZaloCredentials;
} | null> {
  const account = await prisma.zaloAccount.findFirst({
    where: { isActive: true },
    orderBy: { lastConnected: "desc" },
  });
  if (!account?.credentials) return null;

  try {
    const decrypted = decrypt(account.credentials);
    return {
      accountId: account.id,
      zaloUserId: account.zaloUserId,
      credentials: JSON.parse(decrypted),
    };
  } catch {
    console.error("[ZaloCreds] Failed to decrypt credentials");
    return null;
  }
}

/**
 * 활성 계정 ID 가져오기
 */
export async function getActiveAccountId(): Promise<string | null> {
  const account = await prisma.zaloAccount.findFirst({
    where: { isActive: true },
    orderBy: { lastConnected: "desc" },
    select: { id: true },
  });
  return account?.id ?? null;
}

/**
 * 모든 활성 유저의 Zalo 자격증명 로드 (서버 시작 시 전체 연결용)
 */
export async function loadAllActiveCredentials(): Promise<
  Array<{
    userId: string;
    accountId: string;
    zaloUserId: string;
    credentials: ZaloCredentials;
  }>
> {
  const accounts = await prisma.zaloAccount.findMany({
    where: {
      isActive: true,
      credentials: { not: null },
      user: { status: "ACTIVE" },
    },
    include: { user: { select: { id: true } } },
  });

  const results: Array<{
    userId: string;
    accountId: string;
    zaloUserId: string;
    credentials: ZaloCredentials;
  }> = [];

  for (const account of accounts) {
    if (!account.credentials || !account.user) continue;
    try {
      const decrypted = decrypt(account.credentials);
      results.push({
        userId: account.user.id,
        accountId: account.id,
        zaloUserId: account.zaloUserId,
        credentials: JSON.parse(decrypted),
      });
    } catch {
      console.error("[ZaloCreds] Failed to decrypt for account:", account.id);
    }
  }

  return results;
}
