// lib/secret-crypto.ts — 범용 대칭 암호화 유틸 (AES-256-GCM)
//
// 배경: Zalo 자격증명 암호화(lib/zalo-credentials.ts)에 있던 encrypt/decrypt를 범용화해
//   다른 비밀값(예: Instagram IG_ACCESS_TOKEN)도 같은 방식·같은 키로 저장한다.
//   ★ 새 암호화 구현 금지 — 이 모듈이 프로젝트 유일한 대칭 비밀 암복호 지점.
//
// 형식: `salt:iv:authTag:ct` (모두 hex). salt는 레코드별 무작위(사전계산·레인보우 방어).
//   레거시 3세그먼트(`iv:authTag:ct`)는 legacySalt 옵션이 주어질 때만 복호화 지원(Zalo 점진 마이그레이션용).
// 키: 기본 ZALO_CREDS_KEY 재사용(별도 키 신설 금지 — 운영 키 관리 단일화). keyEnv로 오버라이드 가능.
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const SALT_LEN = 16;
const DEFAULT_KEY_ENV = "ZALO_CREDS_KEY";

function getKeySource(keyEnv: string): string {
  const key = process.env[keyEnv];
  if (!key) throw new Error(`${keyEnv} environment variable is required`);
  return key;
}

function deriveKey(keyEnv: string, salt: crypto.BinaryLike): Buffer {
  return crypto.scryptSync(getKeySource(keyEnv), salt, 32);
}

export interface SecretCryptoOptions {
  /** 키를 담은 환경변수명 (기본 ZALO_CREDS_KEY). */
  keyEnv?: string;
}

/**
 * 평문 → `salt:iv:authTag:ct`(hex) 암호문. 레코드별 무작위 salt.
 */
export function encryptSecret(text: string, opts: SecretCryptoOptions = {}): string {
  const keyEnv = opts.keyEnv ?? DEFAULT_KEY_ENV;
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(16);
  const key = deriveKey(keyEnv, salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${salt.toString("hex")}:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export interface DecryptSecretOptions extends SecretCryptoOptions {
  /**
   * 레거시 3세그먼트 암호문(`iv:authTag:ct`) 복호화용 고정 salt.
   * 미지정 시 3세그먼트는 형식 오류로 throw(신형만 허용).
   */
  legacySalt?: crypto.BinaryLike;
}

/**
 * `salt:iv:authTag:ct`(신형) 또는 `iv:authTag:ct`(레거시, legacySalt 필요) → 평문.
 * @throws 형식 오류·인증 실패 시 throw (호출부가 null 처리).
 */
export function decryptSecret(data: string, opts: DecryptSecretOptions = {}): string {
  const keyEnv = opts.keyEnv ?? DEFAULT_KEY_ENV;
  const parts = data.split(":");
  let salt: crypto.BinaryLike;
  let ivHex: string, authTagHex: string, encrypted: string;
  if (parts.length === 4) {
    salt = Buffer.from(parts[0], "hex");
    ivHex = parts[1];
    authTagHex = parts[2];
    encrypted = parts[3];
  } else if (parts.length === 3) {
    if (opts.legacySalt === undefined) throw new Error("Invalid secret format");
    salt = opts.legacySalt;
    ivHex = parts[0];
    authTagHex = parts[1];
    encrypted = parts[2];
  } else {
    throw new Error("Invalid secret format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const key = deriveKey(keyEnv, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
