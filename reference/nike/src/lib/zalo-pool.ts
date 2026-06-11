// [SHARED-MODULE] from Nike src/lib/zalo-pool.ts
/**
 * Multi-user Zalo instance pool.
 * Each active user gets their own ZaloUserInstance with independent
 * API connection, message store, and aliases.
 *
 * Uses globalThis to survive Next.js hot reloads.
 */

import { Zalo, type API } from "zca-js";
import { ThreadType, type Message, type UserMessage, GroupMessage } from "zca-js";
import { LoginQRCallbackEventType, type LoginQRCallbackEvent } from "zca-js";
import type { Reaction, Undo } from "zca-js";
import { ZaloMessageStore } from "./zalo-message-store";
import {
  saveCredentials,
  loadCredentialsForUser,
  loadAllActiveCredentials,
  setCredentialsInactive,
  type ZaloCredentials,
} from "./zalo-credentials";
import { transcribeAudio, translateText, GeminiQuotaError } from "./gemini";
import { pushDebug } from "./zalo-debug";
import { emitZaloMessage, emitZaloReaction, emitZaloUndo, emitZaloVoiceTranslated, emitZaloVoiceQuota } from "./sse-emitter";
import logger from "./logger";

export type ZaloStatus = "disconnected" | "qr_pending" | "connected" | "error";

export interface ZaloUserInstance {
  userId: string;
  api: API | null;
  status: ZaloStatus;
  lastError: string | null;
  qrImageBase64: string | null;
  ownId: string | null;
  accountId: string | null;
  loginPromise: Promise<void> | null;
  aliases: Map<string, string>;
  postLoginLoaded: boolean;
  messageStore: ZaloMessageStore;
  /**
   * 최근 프로그램에서 전송한 메시지 — selfListen 에코 중복 방지.
   * localId → { timestamp, text?, threadId?, hasAttachment? }
   * text/threadId는 store.addMessage가 sendMessage 이후에 실행되는 race를 막기 위한
   * 추가 매칭 키 (echo가 store보다 먼저 도착해도 텍스트+threadId로 식별 가능).
   */
  recentSendIds: Map<
    string,
    { timestamp: number; text?: string; threadId?: string; hasAttachment?: boolean }
  >;
  /** QR 로그인 시 임시 저장되는 자격증명 */
  _pendingCreds?: { imei: string; cookie: unknown; userAgent: string } | null;
}

// ── globalThis pool ──────────────────────────────────────────
const globalForPool = globalThis as unknown as {
  zaloPool: Map<string, ZaloUserInstance> | undefined;
  zaloPoolInitialized: boolean | undefined;
};

function getPool(): Map<string, ZaloUserInstance> {
  if (!globalForPool.zaloPool) {
    globalForPool.zaloPool = new Map();
  }
  return globalForPool.zaloPool;
}

function createInstance(userId: string): ZaloUserInstance {
  return {
    userId,
    api: null,
    status: "disconnected",
    lastError: null,
    qrImageBase64: null,
    ownId: null,
    accountId: null,
    loginPromise: null,
    aliases: new Map(),
    postLoginLoaded: false,
    messageStore: new ZaloMessageStore(),
    recentSendIds: new Map(),
  };
}

function getOrCreateInstance(userId: string): ZaloUserInstance {
  const pool = getPool();
  let inst = pool.get(userId);
  if (!inst) {
    inst = createInstance(userId);
    pool.set(userId, inst);
  }
  return inst;
}

// ── Public API ────────────────────────────────────────────────

export function getUserInstance(userId: string): ZaloUserInstance | undefined {
  return getPool().get(userId);
}

export function getZaloStatusForUser(userId: string): ZaloStatus {
  return getPool().get(userId)?.status ?? "disconnected";
}

export function getZaloApiForUser(userId: string): API | null {
  return getPool().get(userId)?.api ?? null;
}

export function getMessageStoreForUser(userId: string): ZaloMessageStore {
  return getOrCreateInstance(userId).messageStore;
}

export function getAliasesForUser(userId: string): Map<string, string> {
  return getOrCreateInstance(userId).aliases;
}

export function getOwnIdForUser(userId: string): string | null {
  return getPool().get(userId)?.ownId ?? null;
}

export function getAccountIdForUser(userId: string): string | null {
  return getPool().get(userId)?.accountId ?? null;
}

/**
 * Zalo가 첨부(이미지/파일/비디오)로 보내는 msgType 셋.
 * zca-js가 echo로 돌려주는 msgType은 "chat.photo", "chat.file", "share.file",
 * "chat.video", "share.video" 형태. 과거 코드에 있던 "image"/"file" 리터럴
 * 비교는 실제로는 매칭되지 않아 file/image echo dedup이 작동하지 않았다.
 */
const ZALO_ATTACHMENT_MSG_TYPES = new Set([
  "chat.photo",
  "chat.file",
  "chat.video",
  "share.file",
  "share.video",
]);

function isZaloAttachmentMsgType(msgType: string | undefined): boolean {
  return !!msgType && ZALO_ATTACHMENT_MSG_TYPES.has(msgType);
}

/**
 * recentSendIds payload 매칭. store.addMessage 전에 도착한 에코를 차단한다.
 * - 텍스트 에코: 같은 threadId + 같은 text + 30초 이내
 * - 첨부 에코: 같은 threadId + hasAttachment 마킹 + 60초 이내 (캡션 무관)
 */
function isRecentSendMatch(
  inst: ZaloUserInstance,
  opts: { text?: string; threadId: string; isAttachment: boolean }
): boolean {
  if (!inst.recentSendIds || inst.recentSendIds.size === 0) return false;
  const now = Date.now();
  let matched = false;
  inst.recentSendIds.forEach((entry) => {
    if (matched) return;
    if (entry.threadId && entry.threadId !== opts.threadId) return;
    // 첨부 에코: 동일 thread에 최근 60초 내 첨부 전송 기록이 있으면 매칭
    if (opts.isAttachment && entry.hasAttachment && now - entry.timestamp < 60000) {
      matched = true;
      return;
    }
    // 텍스트 에코: 텍스트 일치 + 30초 이내
    if (opts.text && entry.text && entry.text === opts.text && now - entry.timestamp < 30000) {
      matched = true;
    }
  });
  return matched;
}

/**
 * 프로그램에서 전송한 메시지의 로컬 ID를 기록 (selfListen 에코 중복 방지).
 * payload로 text/threadId/hasAttachment를 함께 전달하면 echo 핸들러가
 * store.addMessage 전에 도착한 에코도 텍스트 매칭으로 차단할 수 있다.
 */
export function markRecentSend(
  userId: string,
  localMsgId: string,
  payload?: { text?: string; threadId?: string; hasAttachment?: boolean }
) {
  const inst = getPool().get(userId);
  if (inst) {
    inst.recentSendIds.set(localMsgId, {
      timestamp: Date.now(),
      text: payload?.text,
      threadId: payload?.threadId,
      hasAttachment: payload?.hasAttachment,
    });
    // 오래된 기록 정리 — 첨부 에코 매칭창(60초)보다 길게 유지해야 30~60초에
    // 도착하는 첨부 에코의 1차 차단(isRecentSendMatch)이 무효화되지 않음. 60초+여유 10초.
    const now = Date.now();
    inst.recentSendIds.forEach((entry, id) => {
      if (now - entry.timestamp > 70000) inst.recentSendIds.delete(id);
    });
  }
}

export function getQRImageForUser(userId: string): string | null {
  return getPool().get(userId)?.qrImageBase64 ?? null;
}

export function getLastErrorForUser(userId: string): string | null {
  return getPool().get(userId)?.lastError ?? null;
}

/**
 * Auto-connect a specific user with saved credentials.
 */
export async function connectUser(userId: string): Promise<boolean> {
  const inst = getOrCreateInstance(userId);

  if (inst.status === "connected") return true;
  if (inst.loginPromise) {
    await inst.loginPromise;
    return getOrCreateInstance(userId).status === "connected";
  }

  // loginPromise를 첫 await 이전에 동기 등록한다.
  // (이전 코드는 loadCredentialsForUser await 이후에 등록 → 그 yield 사이에
  //  동시 connectUser 호출이 둘 다 가드를 통과해 같은 유저로 이중 로그인하는 race가 있었음)
  const loginFlow = (async () => {
    const saved = await loadCredentialsForUser(userId);
    if (!saved) return;
    await doCredentialLogin(inst, saved.credentials);
    // onLoginSuccess mutates inst.status to "connected"
    if (inst.status === ("connected" as ZaloStatus)) {
      inst.accountId = saved.accountId;
      inst.messageStore.setDbStore(saved.accountId);
    }
  })();
  inst.loginPromise = loginFlow;

  try {
    await loginFlow;
    return inst.status === ("connected" as ZaloStatus);
  } catch (err) {
    inst.status = "disconnected";
    inst.lastError = err instanceof Error ? err.message : "Credential login failed";
    return false;
  } finally {
    inst.loginPromise = null;
  }
}

/**
 * Start QR login for a specific user.
 */
export async function startQRLoginForUser(userId: string): Promise<string> {
  const inst = getOrCreateInstance(userId);

  // If already doing QR login, return existing QR
  if (inst.status === "qr_pending" && inst.qrImageBase64) {
    return inst.qrImageBase64;
  }

  inst.status = "qr_pending";
  inst.qrImageBase64 = null;
  inst.lastError = null;

  return new Promise<string>((resolveQR, rejectQR) => {
    const zalo = new Zalo({
      selfListen: true,
      logging: false,
    } as Partial<import("zca-js").Options>);

    const loginPromise = zalo.loginQR({ qrPath: "./qr.png" }, (event: LoginQRCallbackEvent) => {
      switch (event.type) {
        case LoginQRCallbackEventType.QRCodeGenerated: {
          inst.qrImageBase64 = event.data.image;
          resolveQR(event.data.image);
          break;
        }
        case LoginQRCallbackEventType.QRCodeExpired: {
          inst.lastError = "QR code expired";
          event.actions.retry();
          break;
        }
        case LoginQRCallbackEventType.QRCodeScanned: {
          break;
        }
        case LoginQRCallbackEventType.QRCodeDeclined: {
          inst.status = "error";
          inst.lastError = "QR login declined";
          rejectQR(new Error("QR login declined"));
          break;
        }
        case LoginQRCallbackEventType.GotLoginInfo: {
          const creds = {
            imei: event.data.imei,
            cookie: event.data.cookie,
            userAgent: event.data.userAgent,
          };
          inst._pendingCreds = creds;
          break;
        }
      }
    });

    loginPromise
      .then((api) => {
        if (!api) {
          inst.status = "error";
          inst.lastError = "Login returned null";
          return;
        }
        onLoginSuccess(inst, api);
      })
      .catch((err) => {
        inst.status = "error";
        inst.lastError = err instanceof Error ? err.message : "QR login failed";
        rejectQR(err);
      });

    setTimeout(() => {
      if (!inst.qrImageBase64) {
        rejectQR(new Error("QR generation timed out"));
      }
    }, 30000);
  });
}

/**
 * Disconnect a specific user.
 */
export function disconnectUser(userId: string): void {
  const pool = getPool();
  const inst = pool.get(userId);
  if (!inst) return;

  if (inst.api) {
    try {
      inst.api.listener.stop();
    } catch {
      /* ignore */
    }
    try {
      inst.api.listener.removeAllListeners();
    } catch {
      /* ignore */
    }
  }

  // Zalo 자격증명 비활성화
  const zaloUserId = inst.ownId;
  if (zaloUserId) {
    setCredentialsInactive(zaloUserId).catch((e) =>
      console.error("[ZaloPool] 자격증명 비활성화 실패:", e)
    );
  }

  inst.api = null;
  inst.status = "disconnected";
  inst.ownId = null;
  inst.accountId = null;
  inst.qrImageBase64 = null;
  inst.postLoginLoaded = false;
  inst.recentSendIds.clear();
  inst.messageStore.clear();

  // 풀에서 인스턴스 제거 — 재연결 시 getOrCreateInstance()가 새로 생성
  pool.delete(userId);
}

/**
 * Connect all active users on server startup.
 * Uses Promise-based mutex to prevent race conditions from concurrent calls.
 */
let connectPromise: Promise<void> | null = null;

export async function connectAllUsers(): Promise<void> {
  if (connectPromise) return connectPromise;
  if (globalForPool.zaloPoolInitialized) return;

  connectPromise = (async () => {
    if (globalForPool.zaloPoolInitialized) return; // Double-check
    globalForPool.zaloPoolInitialized = true;

    logger.info("[ZaloPool] Connecting all active users...");
    const allCreds = await loadAllActiveCredentials();

    if (allCreds.length === 0) {
      logger.info("[ZaloPool] No active credentials found");
      return;
    }

    // Connect sequentially to avoid overwhelming the Zalo API
    for (const cred of allCreds) {
      try {
        logger.info(`[ZaloPool] Connecting user ${cred.userId}...`);
        const inst = getOrCreateInstance(cred.userId);
        inst.accountId = cred.accountId;
        inst.messageStore.setDbStore(cred.accountId);

        await doCredentialLogin(inst, cred.credentials);
        logger.info(`[ZaloPool] User ${cred.userId} connected successfully`);
      } catch (err) {
        console.error(`[ZaloPool] Failed to connect user ${cred.userId}:`, err);
      }
    }

    logger.info(`[ZaloPool] ${getPool().size} instances initialized`);
  })().finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

/**
 * Ensure connection for a specific user (auto-connect on first API access).
 */
export async function ensureConnectionForUser(userId: string): Promise<void> {
  const inst = getPool().get(userId);
  if (inst?.status === "connected") return;
  await connectUser(userId);
}

// ── Internal helpers ──────────────────────────────────────────

async function doCredentialLogin(inst: ZaloUserInstance, credentials: ZaloCredentials) {
  const zalo = new Zalo({
    selfListen: true,
    logging: false,
  } as Partial<import("zca-js").Options>);

  const api = await zalo.login(credentials as import("zca-js").Credentials);
  onLoginSuccess(inst, api);
}

async function onLoginSuccess(inst: ZaloUserInstance, api: API) {
  inst.api = api;
  inst.status = "connected";
  inst.lastError = null;

  // Get own user ID
  try {
    inst.ownId = api.getOwnId();
  } catch {
    inst.ownId = null;
  }

  // DB에 자격증명 저장 (QR 로그인 시) — await하여 리스너 시작 전 DB 스토어 설정 보장
  if (inst._pendingCreds && inst.ownId) {
    const pendingCreds = inst._pendingCreds;
    inst._pendingCreds = null;

    // QR 재로그인: 이전 세션의 인메모리 데이터 초기화 (DB에서 다시 로드됨)
    inst.messageStore.clear();

    try {
      const accountId = await saveCredentials(inst.ownId, pendingCreds, inst.userId);
      inst.accountId = accountId;
      inst.messageStore.setDbStore(accountId);
    } catch (err) {
      console.error("[ZaloPool] Failed to save credentials:", err);
    }
  }

  // Start WebSocket listener (DB 스토어 설정 완료 후)
  startListener(inst, api);

  // Load groups, friends, and aliases after successful connection
  if (!inst.postLoginLoaded) {
    inst.postLoginLoaded = true;
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    loadGroups(inst, api)
      .then(() => delay(1000))
      .then(() => loadFriends(inst, api))
      .then(() => delay(500))
      .then(() => loadAliases(inst, api))
      .catch((err) => console.error("[ZaloPool] post-login loading error:", err));
  }
}

// ── Message content parsing ───────────────────────────────────

function parseMessageContent(
  content: unknown,
  msgType: string | undefined
): {
  text: string;
  attachments: Array<{
    type: string;
    url: string;
    thumbUrl?: string;
    duration?: number;
    phone?: string;
    qrCodeUrl?: string;
    contactName?: string;
    fileName?: string;
  }>;
} {
  let text = "";
  const attachments: {
    type: string;
    url: string;
    thumbUrl?: string;
    duration?: number;
    phone?: string;
    qrCodeUrl?: string;
    contactName?: string;
    fileName?: string;
  }[] = [];

  if (typeof content === "string") {
    // JSON 문자열이면 파싱 시도 (파일, 연락처 등)
    if (content.startsWith("{")) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.phone || parsed.qrCodeUrl || parsed.gUid) {
          logger.debug(
            "[ZaloPool] Contact string keys: %o %s",
            Object.keys(parsed),
            JSON.stringify(parsed).substring(0, 300)
          );
          text = "";
          attachments.push({
            type: "contact",
            url: parsed.qrCodeUrl || "",
            phone: parsed.phone || parsed.phoneNumber || parsed.mobile || "",
            qrCodeUrl: parsed.qrCodeUrl || "",
            contactName: parsed.name || parsed.displayName || parsed.title || parsed.zaloName || "",
          });
          return { text, attachments };
        }
        // JSON 파싱 성공 시 object로 재처리
        return parseMessageContent(parsed, msgType);
      } catch {
        /* not JSON */
      }
    }
    text = content;
  } else if (typeof content === "object" && content !== null) {
    const contentObj = content as Record<string, unknown>;

    if (msgType === "chat.photo") {
      // 파일 확장자 확인 — 모바일 Zalo가 PDF 등 문서도 chat.photo로 보내는 경우 있음
      const href =
        (contentObj.href as string) ||
        (contentObj.hdUrl as string) ||
        (contentObj.normalUrl as string) ||
        (contentObj.originUrl as string) ||
        (contentObj.url as string) ||
        "";
      const titleOrDesc =
        (contentObj.title as string) ||
        (contentObj.description as string) ||
        (contentObj.fileName as string) ||
        "";
      const nameToCheck = titleOrDesc || href;
      const isDocFile = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z|hwp|mp4|avi|mov)(\?|$)/i.test(
        nameToCheck
      );

      if (isDocFile) {
        // 문서 파일 → file 타입으로 처리
        const fileName = (titleOrDesc || href.split("/").pop()?.split("?")[0] || "").normalize(
          "NFC"
        );
        text = "";
        attachments.push({ type: "file", url: href, fileName });
      } else {
        // 실제 이미지
        text =
          (contentObj.description as string) ||
          (contentObj.title as string) ||
          (contentObj.msg as string) ||
          "";
        if (!text && contentObj.params) {
          try {
            const params =
              typeof contentObj.params === "string"
                ? JSON.parse(contentObj.params)
                : contentObj.params;
            if (params.caption) text = params.caption as string;
            else if (params.msg) text = params.msg as string;
          } catch {
            /* ignore */
          }
        }
        const thumbUrl = (contentObj.thumb as string) || "";
        if (href || thumbUrl) {
          attachments.push({ type: "image", url: href, thumbUrl: thumbUrl || undefined });
        }
      }
    } else if (msgType === "chat.sticker") {
      // zca-js StickerDetail: stickerWebpUrl (애니메이션) → stickerUrl (정적) → url fallback
      const stickerUrl =
        (contentObj.stickerWebpUrl as string) ||
        (contentObj.stickerUrl as string) ||
        (contentObj.url as string) ||
        "";
      if (stickerUrl) {
        attachments.push({ type: "sticker", url: stickerUrl });
      } else {
        // 스티커 URL 추출 실패 시 최소한 수신 흔적 남기기
        console.warn("[ZaloPool] Sticker URL not found, content keys:", Object.keys(contentObj));
        text = "[스티커]";
      }
    } else if (msgType === "chat.voice") {
      text = "🎤 음성 메시지";
      const voiceUrl =
        (contentObj.voiceUrl as string) ||
        (contentObj.m4aUrl as string) ||
        (contentObj.href as string) ||
        "";
      const dur = (contentObj.duration as number) || (contentObj.ttl as number) || 0;
      if (voiceUrl) {
        attachments.push({
          type: "voice",
          url: voiceUrl,
          duration: Math.round(dur / 1000) || undefined,
        });
      }
    } else if (
      msgType === "chat.recommend" ||
      msgType === "chat.todo" ||
      (contentObj.phone as string) ||
      (contentObj.qrCodeUrl as string) ||
      (contentObj.gUid as string)
    ) {
      // 디버그: 연락처 데이터 구조 로깅 (어떤 필드가 오는지 확인)
      logger.debug(
        "[ZaloPool] Contact content keys: %o %s",
        Object.keys(contentObj),
        JSON.stringify(contentObj).substring(0, 300)
      );
      const phone =
        (contentObj.phone as string) ||
        (contentObj.phoneNumber as string) ||
        (contentObj.mobile as string) ||
        "";
      const qrCodeUrl = (contentObj.qrCodeUrl as string) || "";
      const contactName =
        (contentObj.name as string) ||
        (contentObj.displayName as string) ||
        (contentObj.title as string) ||
        (contentObj.zaloName as string) ||
        "";
      text = "";
      attachments.push({ type: "contact", url: qrCodeUrl, phone, qrCodeUrl, contactName });
    } else if (
      msgType === "chat.file" ||
      msgType === "chat.video" ||
      msgType === "share.file" ||
      msgType === "share.video" ||
      msgType?.includes(".file") ||
      msgType?.includes(".video")
    ) {
      const fileName = (
        (contentObj.title as string) ||
        (contentObj.description as string) ||
        (contentObj.fileName as string) ||
        ""
      ).normalize("NFC");
      text = "";
      // 다양한 URL 필드 확인
      let fileUrl =
        (contentObj.href as string) ||
        (contentObj.url as string) ||
        (contentObj.fileUrl as string) ||
        "";
      // params 내부에 URL이 있을 수 있음
      if (!fileUrl && contentObj.params) {
        try {
          const params =
            typeof contentObj.params === "string"
              ? JSON.parse(contentObj.params)
              : contentObj.params;
          fileUrl =
            ((params as Record<string, unknown>).href as string) ||
            ((params as Record<string, unknown>).url as string) ||
            "";
        } catch {
          /* ignore */
        }
      }
      // URL 유무와 관계없이 파일 첨부로 등록
      attachments.push({ type: "file", url: fileUrl, fileName });
    } else if (contentObj.href && !msgType) {
      const href = contentObj.href as string;
      if (href.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
        text = (contentObj.description as string) || "";
        attachments.push({
          type: "image",
          url: href,
          thumbUrl: (contentObj.thumb as string) || undefined,
        });
      } else {
        text = (contentObj.description as string) || (contentObj.title as string) || "";
        attachments.push({ type: "file", url: href });
      }
    } else {
      text = (contentObj.description as string) || (contentObj.title as string) || "";
    }
  }

  // Fallback: 텍스트가 파일명 패턴이고 attachment가 없는 경우
  // URL이 없는 상태로 attachment를 만들면 broken link가 되므로 텍스트 그대로 유지
  if (
    attachments.length === 0 &&
    text &&
    /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv|txt|hwp|mp4|avi|mov)$/i.test(text)
  ) {
    logger.debug(
      `[ZaloPool] Filename detected in text, keeping as text (no URL available): "${text}"`
    );
    // URL 없는 file attachment는 broken link가 되므로 텍스트로 그대로 둠
    // attachments.push({ type: "file", url: "", fileName: text });
    // text = "";
  }

  return { text, attachments };
}

// ── Quote extraction ─────────────────────────────────────────

function extractQuote(
  data: Record<string, unknown>
): { text: string; senderName: string; msgType: number; msgId?: string } | undefined {
  const quote = data.quote as
    | {
        ownerId?: string | number;
        cliMsgType?: number;
        msg?: string;
        attach?: string;
        fromD?: string;
        globalMsgId?: string | number;
      }
    | undefined;

  if (!quote) return undefined;

  logger.debug("[ZaloPool] extractQuote raw: %s", JSON.stringify(quote));

  let quoteText = quote.msg || "";
  if (!quoteText && quote.attach) quoteText = "[첨부파일]";
  const senderName = quote.fromD || "";

  if (!quoteText && !senderName) return undefined;

  return {
    text: quoteText,
    senderName,
    msgType: quote.cliMsgType ?? 0,
    msgId: quote.globalMsgId != null ? String(quote.globalMsgId) : undefined,
  };
}

// ── Voice auto-process ───────────────────────────────────────

type VoiceAutoResult =
  | { sttText: string; translatedText: string }
  | { quotaExceeded: true }
  | null;

async function processVoiceAutoTranslate(
  voiceUrl: string,
  duration?: number,
  isSelf?: boolean
): Promise<VoiceAutoResult> {
  try {
    // CDN 무응답 시 Promise가 매달리는 것을 방지 (타임아웃 15초)
    const res = await fetch(voiceUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;

    const base64 = buf.toString("base64");
    // isSelf: 한국어 음성 → 베트남어 번역 / other: 베트남어 음성 → 한국어 번역
    const sttLang = isSelf ? "ko" : "vi";
    const [fromLang, toLang] = isSelf ? ["Korean", "Vietnamese"] : ["Vietnamese", "Korean"];
    logger.info(
      `[ZaloPool] Voice STT starting (${Math.round(buf.length / 1024)}KB, ${duration || "?"}s, ${sttLang})`
    );

    const sttText = await transcribeAudio(base64, "audio/mp4", sttLang);
    if (!sttText) return null;

    const translated = await translateText(sttText, fromLang, toLang);
    return { sttText, translatedText: translated || sttText };
  } catch (err) {
    // 한도초과는 텍스트/이미지 경로와 달리 음성은 사용자에게 노출되지 않으므로,
    // 최소한 모니터링에서 일반 오류와 구분되도록 별도 기록 (UI 토스트 연동은 후속 과제)
    if (err instanceof GeminiQuotaError) {
      logger.warn("[ZaloPool] Voice auto-translate skipped — Gemini 한도 초과");
      // 호출부(userId/threadId 보유)에서 SSE 토스트를 띄우도록 신호
      return { quotaExceeded: true };
    }
    console.error("[ZaloPool] Voice auto-translate failed:", err);
    return null;
  }
}

// ── Message handlers ──────────────────────────────────────────

function handleUserMessage(inst: ZaloUserInstance, userMsg: UserMessage) {
  const content = userMsg.data.content;
  const rawData = userMsg.data as Record<string, unknown>;
  const msgType = rawData.msgType as string | undefined;

  // selfListen 에코 중복 방지: 웹에서 전송한 메시지의 에코만 스킵 (모바일 전송은 통과)
  if (userMsg.isSelf) {
    const serverMsgId = userMsg.data.msgId || "";
    // zaloIdMap에 매핑된 서버 ID → 웹에서 보낸 에코 (TTL 무관 — 매핑 존재 자체가 웹 전송 증거)
    const localId = inst.messageStore.resolveId(serverMsgId);
    if (localId !== serverMsgId) {
      return;
    }
    // 같은 서버 ID가 이미 저장된 경우도 스킵
    const existing = inst.messageStore.getMessages(userMsg.threadId);
    if (existing.some((m) => m.id === serverMsgId)) {
      return;
    }
    const echoText = typeof userMsg.data.content === "string" ? userMsg.data.content : "";
    const isAttachmentEcho =
      isZaloAttachmentMsgType(msgType) || !!rawData.thumb;
    // 1차: recentSendIds payload 매칭 (store.addMessage 전에 도착한 에코 차단 — race)
    //      sendZaloMessage가 sendMessage HTTP 응답을 기다리는 동안 WebSocket 에코가 먼저 오는 경우
    if (
      isRecentSendMatch(inst, {
        text: echoText || undefined,
        threadId: userMsg.threadId,
        isAttachment: isAttachmentEcho,
      })
    ) {
      return;
    }
    // 2차: 최근 30초 이내 동일 텍스트의 내 메시지가 store에 이미 있으면 에코로 판단
    //      (recentSendIds TTL 초과 후 늦게 도착하는 에코, 또는 store 저장 이후 에코)
    if (echoText) {
      const now = Date.now();
      const hasRecentSend = inst.recentSendIds && inst.recentSendIds.size > 0;
      const isDuplicateText =
        hasRecentSend &&
        existing.some(
          (m) =>
            m.from === "me" &&
            now - m.timestamp < 30000 &&
            (m.text === echoText || m.translatedText === echoText)
        );
      if (isDuplicateText) {
        return;
      }
    }
    // 3차: 파일/이미지 에코 — 최근 60초 내 첨부파일이 있는 내 메시지가 있으면 스킵
    //      Zalo 실제 msgType 셋(chat.photo/chat.file/share.file 등)으로 비교
    if (isAttachmentEcho) {
      const now = Date.now();
      const hasRecentFile = existing.some(
        (m) =>
          m.from === "me" &&
          now - m.timestamp < 60000 &&
          m.attachments?.some((a) => a.type === "image" || a.type === "file")
      );
      if (hasRecentFile) {
        return;
      }
    }
  }

  // 디버그: 모든 메시지를 디버그 버퍼에 저장
  pushDebug(userMsg.threadId, userMsg.data.msgId || "", {
    ...rawData,
    _isSelf: userMsg.isSelf,
    _type: "pool_user",
    _contentType: typeof content,
    _contentPreview:
      typeof content === "string"
        ? content.substring(0, 200)
        : JSON.stringify(content).substring(0, 200),
  });

  const { text, attachments } = parseMessageContent(content, msgType);
  if (!text && attachments.length === 0) return;

  const quote = extractQuote(userMsg.data as unknown as Record<string, unknown>);
  const msgId = String(userMsg.data.msgId || Date.now());
  const userRaw = userMsg.data as unknown as Record<string, unknown>;
  const globalId = userRaw.globalMsgId != null ? String(userRaw.globalMsgId) : undefined;

  const storedMsg = {
    id: msgId,
    globalMsgId: globalId,
    cliMsgId: userMsg.data.cliMsgId || undefined,
    senderUid: userMsg.data.uidFrom || userMsg.data.userId || undefined,
    threadId: userMsg.threadId,
    from: userMsg.isSelf ? ("me" as const) : ("other" as const),
    text,
    timestamp: parseInt(userMsg.data.ts, 10) || Date.now(),
    senderName: userMsg.data.dName || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    quote,
  };
  inst.messageStore.addMessage(storedMsg);

  // SSE: 새 메시지 실시간 전달 (해당 사용자에게만)
  emitZaloMessage(inst.userId, userMsg.threadId, storedMsg as unknown as Record<string, unknown>);

  const voiceAttachment = attachments.find((a) => a.type === "voice");
  if (voiceAttachment?.url) {
    processVoiceAutoTranslate(voiceAttachment.url, voiceAttachment.duration, userMsg.isSelf)
      .then((result) => {
        if (result && "quotaExceeded" in result) {
          emitZaloVoiceQuota(inst.userId, userMsg.threadId);
        } else if (result) {
          inst.messageStore.updateVoiceResult(msgId, result.sttText, result.translatedText);
          emitZaloVoiceTranslated(inst.userId, userMsg.threadId, msgId, result.sttText, result.translatedText);
        }
      })
      .catch((e) =>
        console.error("[ZaloPool] 음성 번역 실패:", e instanceof Error ? e.message : e)
      );
  }
}

function handleGroupMessage(inst: ZaloUserInstance, groupMsg: GroupMessage) {
  const content = groupMsg.data.content;
  const rawData = groupMsg.data as Record<string, unknown>;
  const msgType = rawData.msgType as string | undefined;

  // selfListen 에코 중복 방지: 웹에서 전송한 메시지의 에코만 스킵 (모바일 전송은 통과)
  if (groupMsg.isSelf) {
    const serverMsgId = groupMsg.data.msgId || "";
    // zaloIdMap에 매핑된 서버 ID → 웹에서 보낸 에코 (TTL 무관 — 매핑 존재 자체가 웹 전송 증거)
    const localId = inst.messageStore.resolveId(serverMsgId);
    if (localId !== serverMsgId) {
      return;
    }
    const existing = inst.messageStore.getMessages(groupMsg.threadId);
    if (existing.some((m) => m.id === serverMsgId)) {
      return;
    }
    const echoText = typeof groupMsg.data.content === "string" ? groupMsg.data.content : "";
    const isAttachmentEcho =
      isZaloAttachmentMsgType(msgType) || !!rawData.thumb;
    // 1차: recentSendIds payload 매칭 (store.addMessage 전에 도착한 에코 차단 — race)
    if (
      isRecentSendMatch(inst, {
        text: echoText || undefined,
        threadId: groupMsg.threadId,
        isAttachment: isAttachmentEcho,
      })
    ) {
      return;
    }
    // 2차: 최근 30초 이내 동일 텍스트의 내 메시지가 store에 이미 있으면 에코로 판단
    if (echoText) {
      const now = Date.now();
      const hasRecentSend = inst.recentSendIds && inst.recentSendIds.size > 0;
      const isDuplicateText =
        hasRecentSend &&
        existing.some(
          (m) =>
            m.from === "me" &&
            now - m.timestamp < 30000 &&
            (m.text === echoText || m.translatedText === echoText)
        );
      if (isDuplicateText) {
        return;
      }
    }
    // 3차: 파일/이미지 에코 — 최근 60초 내 첨부파일이 있는 내 메시지가 있으면 스킵
    if (isAttachmentEcho) {
      const now = Date.now();
      const hasRecentFile = existing.some(
        (m) =>
          m.from === "me" &&
          now - m.timestamp < 60000 &&
          m.attachments?.some((a) => a.type === "image" || a.type === "file")
      );
      if (hasRecentFile) {
        return;
      }
    }
  }

  // 디버그: 모든 메시지를 디버그 버퍼에 저장
  pushDebug(groupMsg.threadId, groupMsg.data.msgId || "", {
    ...rawData,
    _isSelf: groupMsg.isSelf,
    _type: "pool_group",
    _contentType: typeof content,
    _contentPreview:
      typeof content === "string"
        ? content.substring(0, 200)
        : JSON.stringify(content).substring(0, 200),
  });

  const { text, attachments } = parseMessageContent(content, msgType);
  if (!text && attachments.length === 0) return;

  const senderName = groupMsg.data.dName || groupMsg.data.uidFrom || "Unknown";
  const quote = extractQuote(groupMsg.data as unknown as Record<string, unknown>);
  const msgId = String(groupMsg.data.msgId || `grp-${Date.now()}`);
  const grpRawData = groupMsg.data as unknown as Record<string, unknown>;
  const grpGlobalId = grpRawData.globalMsgId != null ? String(grpRawData.globalMsgId) : undefined;

  const storedGroupMsg = {
    id: msgId,
    globalMsgId: grpGlobalId,
    cliMsgId: groupMsg.data.cliMsgId || undefined,
    senderUid: groupMsg.data.uidFrom || groupMsg.data.userId || undefined,
    threadId: groupMsg.threadId,
    from: groupMsg.isSelf ? ("me" as const) : ("other" as const),
    text,
    timestamp: parseInt(groupMsg.data.ts, 10) || Date.now(),
    senderName,
    attachments: attachments.length > 0 ? attachments : undefined,
    threadType: "group" as const,
    quote,
  };
  inst.messageStore.addMessage(storedGroupMsg);

  // SSE: 그룹 메시지 실시간 전달 (해당 사용자에게만)
  emitZaloMessage(inst.userId, groupMsg.threadId, storedGroupMsg as unknown as Record<string, unknown>);

  const voiceAtt = attachments.find((a) => a.type === "voice");
  if (voiceAtt?.url) {
    processVoiceAutoTranslate(voiceAtt.url, voiceAtt.duration, groupMsg.isSelf)
      .then((result) => {
        if (result && "quotaExceeded" in result) {
          emitZaloVoiceQuota(inst.userId, groupMsg.threadId);
        } else if (result) {
          inst.messageStore.updateVoiceResult(msgId, result.sttText, result.translatedText);
          emitZaloVoiceTranslated(inst.userId, groupMsg.threadId, msgId, result.sttText, result.translatedText);
        }
      })
      .catch((e) =>
        console.error("[ZaloPool] 음성 번역 실패:", e instanceof Error ? e.message : e)
      );
  }
}

function handleReaction(inst: ZaloUserInstance, reaction: Reaction) {
  try {
    const data = reaction.data as Record<string, unknown>;
    const content = data.content as
      | {
          rMsg?: { gMsgID: string; cMsgID: string; msgType: number }[];
          rIcon?: string;
          rType?: number;
        }
      | undefined;

    if (!content?.rMsg?.length || !content.rIcon) return;

    const reactorId = (data.uidFrom as string) || "";
    const reactorName = (data.dName as string) || undefined;
    const icon = content.rIcon;
    const isRemove = content.rType === 0;

    for (const rMsg of content.rMsg) {
      const reactionMsgId = String(rMsg.gMsgID);
      inst.messageStore.updateReaction({
        msgId: reactionMsgId,
        reactorId: String(reactorId),
        reactorName,
        icon: isRemove ? "" : icon,
      });
      // SSE: 리액션 업데이트 전달 (해당 사용자에게만)
      const threadId = (data.threadId as string) || "";
      const msgReactions = inst.messageStore.getReactionSummary(reactionMsgId);
      emitZaloReaction(
        inst.userId,
        threadId,
        reactionMsgId,
        msgReactions as unknown as Record<string, unknown>[]
      );
    }
  } catch (err) {
    console.error("[ZaloPool] Reaction handler error:", err);
  }
}

function handleUndo(inst: ZaloUserInstance, undo: Undo) {
  try {
    const threadId = undo.threadId;
    const data = undo.data as Record<string, unknown>;
    const content = data.content as { globalMsgId?: number; cliMsgId?: number } | undefined;
    const rawId = content?.globalMsgId?.toString() || (data.msgId as string);
    if (!threadId || !rawId) return;
    // 보낸 메시지는 store에 로컬ID로 저장되고 Undo는 Zalo 서버ID를 보내므로
    // resolveId로 정규화해야 삭제 매칭됨(수신 메시지는 매핑 없어 그대로 반환).
    const msgId = inst.messageStore.resolveId(rawId);
    inst.messageStore.removeMessage(threadId, msgId);
    // SSE: 메시지 삭제 실시간 전달 (해당 사용자에게만) — 클라도 동일 정규화 ID로 매칭
    emitZaloUndo(inst.userId, threadId, msgId);
  } catch (err) {
    console.error("[ZaloPool] Undo handler error:", err);
  }
}

// ── Listener setup ────────────────────────────────────────────

function startListener(inst: ZaloUserInstance, api: API) {
  // 기존 리스너 완전 정리 (재연결 시 중복 방지)
  try {
    api.listener.stop();
  } catch {
    /* ignore if not started */
  }
  try {
    api.listener.removeAllListeners();
  } catch {
    // removeAllListeners 미지원 시 개별 제거 시도
    for (const evt of ["message", "reaction", "undo", "error", "closed"] as const) {
      try {
        api.listener.removeAllListeners(evt as string);
      } catch {
        /* ignore */
      }
    }
  }

  api.listener.on("message", (message: Message) => {
    if (message.type === ThreadType.User) {
      handleUserMessage(inst, message as UserMessage);
    } else if (message.type === ThreadType.Group) {
      handleGroupMessage(inst, message as GroupMessage);
    }
  });

  api.listener.on("reaction", (reaction: Reaction) => {
    handleReaction(inst, reaction);
  });

  api.listener.on("undo", (undo: Undo) => {
    handleUndo(inst, undo);
  });

  api.listener.on("error", (error) => {
    console.error(`[ZaloPool] Listener error (user=${inst.userId}):`, error);
    inst.lastError = error instanceof Error ? error.message : "Listener error";
  });

  api.listener.on("closed", (code, reason) => {
    console.warn(`[ZaloPool] Listener closed (user=${inst.userId}): ${code} ${reason}`);
    if (code === 3000) {
      inst.status = "error";
      inst.lastError = "Zalo Web이 다른 곳에서 열려 연결이 끊겼습니다. 다시 연결하세요.";
    } else {
      inst.status = "disconnected";
    }
  });

  api.listener.start({ retryOnClose: true });
}

// ── Post-connection loaders ───────────────────────────────────

async function loadFriends(inst: ZaloUserInstance, api: API) {
  try {
    const friends = await api.getAllFriends();
    for (const friend of friends) {
      const existing = inst.messageStore.threads.get(friend.userId);
      const name = friend.displayName || friend.zaloName || friend.userId;
      if (existing) {
        existing.displayName = name;
        if (friend.avatar) existing.avatar = friend.avatar;
      } else {
        inst.messageStore.upsertThread({
          threadId: friend.userId,
          displayName: name,
          avatar: friend.avatar || "",
        });
      }
    }
    logger.info(`[ZaloPool] Loaded friends for user ${inst.userId}`);
  } catch (err) {
    console.error("[ZaloPool] Failed to load friends:", err);
  }
}

async function loadGroups(inst: ZaloUserInstance, api: API) {
  try {
    const groupsResponse = await api.getAllGroups();
    const groupIds = Object.keys(groupsResponse.gridVerMap);
    if (groupIds.length === 0) return;

    const infoResponse = await api.getGroupInfo(groupIds);
    for (const [groupId, info] of Object.entries(infoResponse.gridInfoMap)) {
      const groupInfo = info as import("zca-js").GroupInfoResponse["gridInfoMap"][string];
      inst.messageStore.upsertThread({
        threadId: groupId,
        displayName: groupInfo.name || groupId,
        avatar: groupInfo.avt || "",
        isGroup: true,
        memberCount: groupInfo.totalMember,
      });
    }
    logger.info(`[ZaloPool] Loaded ${groupIds.length} groups for user ${inst.userId}`);
  } catch (err) {
    console.error("[ZaloPool] Failed to load groups:", err);
  }
}

async function loadAliases(inst: ZaloUserInstance, api: API) {
  try {
    const aliasResponse = await api.getAliasList();
    if (!aliasResponse.items || aliasResponse.items.length === 0) return;

    const validItems = aliasResponse.items.filter(
      (a: { userId: string; alias: string }) => a.alias && !a.alias.includes("\ufffd")
    );

    inst.aliases.clear();
    for (const a of validItems) {
      inst.aliases.set(a.userId, a.alias);
    }

    // Sync to DB
    const dbStore = inst.messageStore.getDbStore?.();
    if (dbStore) {
      await dbStore.syncAliases(validItems);
    }

    // Update in-memory thread aliases
    for (const item of validItems) {
      const thread = inst.messageStore.threads.get(item.userId);
      if (thread) {
        thread.alias = item.alias;
      }
    }

    logger.info(`[ZaloPool] Loaded ${validItems.length} aliases for user ${inst.userId}`);
  } catch (err) {
    console.error("[ZaloPool] Failed to load aliases:", err);
  }
}
