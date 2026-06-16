// [SHARED-MODULE] from Nike src/lib/zalo-credentials.ts (v1.x)
// villa-pms 적응: prisma 명명 export(import { prisma }), User.status→isActive,
// ZaloAccount는 단일 봇(singleton). 보안(ADR-0006 D6): credentials는 AES-256-GCM 암호문,
// 절대 평문/응답/로그/AuditLog 노출 금지. findUnique/findFirst 시 credentials는 명시 select로만 로드.
import crypto from "crypto";

import { prisma } from "./prisma";

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
 * Zalo 봇 자격증명을 DB에 암호화 저장 (upsert: zaloUserId 기준 단일 봇).
 * @returns ZaloAccount.id
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
    select: { id: true }, // credentials 응답 미포함 (D6.2)
  });
  return account.id;
}

/**
 * Zalo 봇 자격증명 비활성화 (연결 해제 시).
 */
export async function setCredentialsInactive(zaloUserId: string): Promise<void> {
  await prisma.zaloAccount.updateMany({
    where: { zaloUserId },
    data: { isActive: false },
  });
}

/**
 * DB에서 활성 봇 계정의 자격증명 로드 (단일 봇 — 0~1건).
 * credentials는 여기서만 명시적으로 select하여 복호화한다 (D6.2).
 */
export async function loadCredentials(): Promise<{
  accountId: string;
  zaloUserId: string;
  userId: string | null;
  displayName: string | null;
  credentials: ZaloCredentials;
} | null> {
  const account = await prisma.zaloAccount.findFirst({
    where: { isActive: true },
    orderBy: { lastConnected: "desc" },
    select: {
      id: true,
      zaloUserId: true,
      userId: true,
      displayName: true,
      credentials: true,
    },
  });
  if (!account?.credentials) return null;

  try {
    const decrypted = decrypt(account.credentials);
    return {
      accountId: account.id,
      zaloUserId: account.zaloUserId,
      userId: account.userId,
      displayName: account.displayName,
      credentials: JSON.parse(decrypted),
    };
  } catch {
    // 복호화 실패 로그에도 credential 절대 미포함 (D6.2) — accountId만
    console.error("[ZaloCreds] Failed to decrypt credentials for account:", account.id);
    return null;
  }
}

/**
 * 활성 봇 계정 ID 가져오기 (credentials 미포함).
 */
export async function getActiveAccountId(): Promise<string | null> {
  const account = await prisma.zaloAccount.findFirst({
    where: { isActive: true },
    orderBy: { lastConnected: "desc" },
    select: { id: true },
  });
  return account?.id ?? null;
}
