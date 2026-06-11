// [SHARED-MODULE] from Nike src/lib/zalo.ts
/**
 * Zalo API wrapper — thin layer over zalo-pool.ts (multi-user) and
 * zalo-message-store.ts (in-memory cache + DB write-through).
 *
 * All functions require a userId parameter to operate on the correct
 * user's Zalo instance.
 */

import { ThreadType, Reactions, type MessageContent } from "zca-js";
import sharp from "sharp";
import {
  getZaloStatusForUser,
  getZaloApiForUser,
  getAccountIdForUser,
  getAliasesForUser,
  getMessageStoreForUser,
  ensureConnectionForUser,
  connectUser,
  startQRLoginForUser,
  disconnectUser,
  connectAllUsers,
  getOwnIdForUser,
  getQRImageForUser,
  getLastErrorForUser,
  markRecentSend,
  type ZaloStatus,
} from "./zalo-pool";
import { ZaloDbStore, toApiMessage } from "./zalo-db-store";
import type { ThreadInfo } from "./zalo-message-store";
import logger from "./logger";

// Re-export pool functions
export {
  getZaloStatusForUser as getZaloStatus,
  getOwnIdForUser as getOwnId,
  getAccountIdForUser as getAccountId,
  startQRLoginForUser as startQRLogin,
  disconnectUser as disconnect,
  connectUser as autoConnect,
  connectAllUsers,
  getQRImageForUser as getQRImage,
  getLastErrorForUser as getLastError,
  ensureConnectionForUser as ensureConnection,
  type ZaloStatus,
};

export function isZaloConnected(userId: string): boolean {
  return getZaloStatusForUser(userId) === "connected";
}

/** DB Store 인스턴스 가져오기 (Zalo 미연결 시에도 DB 접근 가능) */
async function getDbStore(userId: string): Promise<ZaloDbStore | null> {
  const store = getMessageStoreForUser(userId);
  const dbStore = store.getDbStore();
  if (dbStore) return dbStore;

  // 인메모리 accountId 우선
  let accountId = getAccountIdForUser(userId);

  // Zalo 미연결 시에도 DB에서 accountId 로드
  if (!accountId) {
    const { loadCredentialsForUser } = await import("./zalo-credentials");
    const creds = await loadCredentialsForUser(userId);
    if (creds) accountId = creds.accountId;
  }

  if (accountId) {
    store.setDbStore(accountId);
    return store.getDbStore();
  }
  return null;
}

/**
 * Get recent chat threads from DB (persistent) + in-memory cache.
 * DB 스레드를 항상 병합하여 QR 재로그인 후에도 과거 대화가 유지됨.
 */
export async function listRecentChat(userId: string): Promise<ThreadInfo[]> {
  const api = getZaloApiForUser(userId);
  const store = getMessageStoreForUser(userId);

  // DB에서 스레드 항상 로드/병합 (인메모리에 데이터가 있어도 실행)
  const dbStore = await getDbStore(userId);
  let dbAliasMap = new Map<string, string>();
  if (dbStore) {
    try {
      const dbThreads = await dbStore.getThreads();
      const aliases = await dbStore.getAliases();
      dbAliasMap = new Map(
        aliases.filter((a) => !a.alias.includes("\ufffd")).map((a) => [a.userId, a.alias])
      );
      for (const t of dbThreads) {
        const existing = store.threads.get(t.zaloThreadId);
        const dbTime = t.lastMessageTime.getTime();
        const dbAlias = dbAliasMap.get(t.zaloThreadId);
        // DB가 더 최신이거나 인메모리에 실제 메시지가 없으면 DB 데이터로 병합
        if (!existing || !existing.lastMessageTime || dbTime > existing.lastMessageTime) {
          store.upsertThread({
            threadId: t.zaloThreadId,
            displayName: existing?.displayName || t.displayName,
            avatar: existing?.avatar || t.avatar,
            lastMessage: t.lastMessage,
            lastMessageTime: dbTime,
            unreadCount: existing?.unreadCount ?? t.unreadCount,
            isGroup: t.threadType === "group",
            memberCount: t.memberCount ?? undefined,
            alias: dbAlias || existing?.alias,
          });
        } else if (existing && dbAlias && !existing.alias) {
          // 인메모리가 최신이지만 alias가 없으면 DB alias 적용
          existing.alias = dbAlias;
        }
      }
    } catch {
      // DB 로드 실패 시 무시
    }
  }

  const storeThreads = store.getThreads();

  // alias 최신 상태 반영: pool → DB → 기존 순서로 우선 적용
  if (storeThreads.length > 0) {
    const poolAliasMap = getAliasesForUser(userId);
    for (const t of storeThreads) {
      // pool alias (가장 최신) → DB alias (영구 저장) → 기존 alias 순으로 적용
      const freshAlias = poolAliasMap.get(t.threadId) ?? dbAliasMap.get(t.threadId);
      if (freshAlias && freshAlias !== t.alias) {
        t.alias = freshAlias;
      }
    }
    return storeThreads;
  }

  // Connected이고 스레드가 여전히 없으면 친구 목록에서 채움
  if (api && store.getThreads().length === 0) {
    try {
      const friends = await api.getAllFriends();
      const aliases = getAliasesForUser(userId);
      for (const friend of friends) {
        store.upsertThread({
          threadId: friend.userId,
          displayName: friend.displayName || friend.zaloName || friend.userId,
          avatar: friend.avatar || "",
          alias: aliases.get(friend.userId),
        });
      }
      return store.getThreads();
    } catch {
      // Friends fetch failed
    }
  }

  return store.getThreads();
}

/**
 * Get messages for a thread
 */
export async function getConversation(userId: string, threadId: string) {
  const store = getMessageStoreForUser(userId);
  store.markRead(threadId);

  const dbStore = await getDbStore(userId);
  if (dbStore) {
    try {
      const { messages, hasMore } = await dbStore.getRecentMessages(threadId);
      for (const msg of messages) {
        if (msg.reactions?.length) {
          store.loadReactions(msg.zaloMsgId, msg.reactions);
        }
      }
      return { messages: messages.map(toApiMessage), hasMore };
    } catch {
      // DB 실패 시 인메모리 폴백
    }
  }

  const msgs = store.getMessages(threadId);
  return {
    messages: msgs.map((msg) => formatInMemoryMessage(msg, store)),
    hasMore: false,
  };
}

/** 인메모리 메시지를 API 응답 형식으로 변환 (toApiMessage와 동일한 형태) */
function formatInMemoryMessage(
  m: import("./zalo-message-store").StoredMessage,
  store: import("./zalo-message-store").ZaloMessageStore
) {
  const reactions = store.getReactionSummary(m.id);
  return {
    id: m.id,
    globalMsgId: m.globalMsgId,
    cliMsgId: m.cliMsgId,
    from: m.from,
    text: m.text,
    translatedText: m.translatedText,
    timestamp: m.timestamp,
    senderName: m.senderName,
    ...(m.quote && { quote: m.quote }),
    attachments: m.attachments?.map((a) => ({
      id: a.id,
      type: a.type,
      url: a.url || "",
      thumbUrl: a.type === "voice" && a.id ? `/api/voice/play/${a.id}` : a.thumbUrl,
      duration: a.duration,
      ocrTranslatedText: a.ocrTranslatedText,
      fileName: a.fileName,
    })),
    ...(reactions.length > 0 && { reactions }),
  };
}

/**
 * Get older messages
 */
export async function getOlderMessages(
  userId: string,
  threadId: string,
  before: number,
  limit = 50
) {
  const store = getMessageStoreForUser(userId);
  const dbStore = await getDbStore(userId);
  if (!dbStore) return { messages: [], hasMore: false };

  const { messages, hasMore } = await dbStore.getMessages(threadId, { before, limit });
  for (const msg of messages) {
    if (msg.reactions?.length) {
      store.loadReactions(msg.zaloMsgId, msg.reactions);
    }
  }
  return { messages: messages.map(toApiMessage), hasMore };
}

/**
 * Get new messages since a given timestamp.
 */
export async function getNewMessages(userId: string, threadId: string, since: number) {
  const store = getMessageStoreForUser(userId);
  const dbStore = await getDbStore(userId);
  if (dbStore) {
    try {
      const dbMsgs = await dbStore.getNewMessages(threadId, since);
      if (dbMsgs.length > 0) {
        for (const msg of dbMsgs) {
          if (msg.reactions?.length) {
            store.loadReactions(msg.zaloMsgId, msg.reactions);
          }
        }
        return dbMsgs.map(toApiMessage);
      }
    } catch (dbError) {
      console.error(`[Zalo] DB query failed for getNewMessages (thread: ${threadId}):`, dbError);
      // DB 실패 시 인메모리 폴백
    }
  }

  return store.getNewMessagesSince(threadId, since).map((msg) => formatInMemoryMessage(msg, store));
}

/**
 * 음성 메시지의 번역 상태를 조회
 */
export async function getVoiceTranslations(userId: string, messageIds: string[]) {
  const dbStore = await getDbStore(userId);
  if (!dbStore || messageIds.length === 0) return [];

  const results = await dbStore.getVoiceTranslations(messageIds);
  return results.map((r) => ({
    id: r.zaloMsgId,
    translatedText: r.translatedText || undefined,
    ocrTranslatedText: r.attachments[0]?.ocrTranslatedText || undefined,
  }));
}

/**
 * Send a text message to a user.
 */
export async function sendZaloMessage(
  userId: string,
  threadId: string,
  text: string,
  messageId?: string,
  originalText?: string,
  isGroup = false,
  quote?: { msgId: string; text: string; senderName?: string },
  mentions?: { pos: number; uid: string; len: number }[]
): Promise<void> {
  const api = getZaloApiForUser(userId);
  if (!api) throw new Error("Zalo not connected");

  const localId = messageId || `sent-${Date.now()}`;
  const store = getMessageStoreForUser(userId);
  // selfListen 에코 중복 방지: 전송 전에 로컬 ID 마킹.
  // text(번역 대상언어 본문)와 threadId를 함께 등록하여, store.addMessage 전에
  // WebSocket 에코가 먼저 도착하는 race를 차단한다.
  markRecentSend(userId, localId, { text, threadId });

  // quote가 있으면 MessageContent 객체로 전송, 없으면 plain string
  let messageToSend: string | MessageContent = text;
  if (quote) {
    // 원본 메시지 정보 조회 (uidFrom, cliMsgId, ts 등)
    const resolvedMsgId = store.toZaloId(quote.msgId);
    const allMsgs = store.getMessages(threadId);
    const originalMsg = allMsgs.find((m) => m.id === quote.msgId || m.id === resolvedMsgId);

    // 인메모리 캐시 미스 시 DB fallback (서버 재시작 후에도 동작 보장)
    let dbFallback: {
      direction: string;
      cliMsgId: string | null;
      senderUid: string | null;
      timestamp: Date;
    } | null = null;
    if (!originalMsg) {
      const dbStore = await getDbStore(userId);
      if (dbStore) {
        // quote.msgId 또는 resolvedMsgId로 DB 조회
        dbFallback =
          (await dbStore.getMessageForQuote(quote.msgId)) ||
          (await dbStore.getMessageForQuote(resolvedMsgId));
        if (dbFallback) {
          logger.debug(
            {
              cliMsgId: dbFallback.cliMsgId,
              senderUid: dbFallback.senderUid,
              ts: dbFallback.timestamp.getTime(),
            },
            "[Zalo] Quote: DB fallback found"
          );
        }
      }
    }

    // uidFrom: 원본 메시지의 실제 발신자 Zalo UID
    // 그룹: senderUid (개별 발신자), 1:1: threadId (상대방), 내 메시지: 내 Zalo UID
    const myOwnId = getOwnIdForUser(userId) || "";
    const fromDirection = originalMsg?.from || (dbFallback?.direction === "sent" ? "me" : "other");
    const uidFrom =
      originalMsg?.senderUid ||
      dbFallback?.senderUid ||
      (fromDirection === "other" ? threadId : myOwnId);
    const cliMsgId =
      store.getCliMsgId(quote.msgId) ||
      store.getCliMsgId(resolvedMsgId) ||
      dbFallback?.cliMsgId ||
      resolvedMsgId;
    const ts = originalMsg
      ? String(originalMsg.timestamp)
      : dbFallback
        ? String(dbFallback.timestamp.getTime())
        : "0";

    logger.debug(
      {
        quoteMsgId: quote.msgId,
        resolvedMsgId,
        uidFrom,
        myOwnId,
        cliMsgId,
        ts,
        originalMsgFound: !!originalMsg,
        dbFallbackFound: !!dbFallback,
        originalFrom: originalMsg?.from || dbFallback?.direction,
        originalSenderUid: originalMsg?.senderUid || dbFallback?.senderUid,
        isGroup,
      },
      "[Zalo] Sending quote"
    );

    messageToSend = {
      msg: text,
      quote: {
        content: quote.text || "",
        msgType: "chat.text",
        propertyExt: undefined,
        uidFrom,
        msgId: resolvedMsgId,
        cliMsgId,
        ts,
        ttl: 0,
      },
    };
  }
  // mentions가 있으면 MessageContent 객체로 변환
  if (mentions?.length) {
    if (typeof messageToSend === "string") {
      messageToSend = { msg: messageToSend, mentions };
    } else {
      messageToSend.mentions = mentions;
    }
  }

  // selfListen 에코 중복 방지: api.sendMessage 호출 전 로컬 메시지를 미리 저장
  // (await 진행 중 Zalo가 에코를 돌려보내면 zalo-pool의 텍스트 dedup이 existing의 me-메시지를 찾아 차단)
  // sendZaloImage와 동일 패턴 — 비대칭 해소
  store.addMessage({
    id: localId,
    threadId,
    from: "me",
    text: originalText || text,
    translatedText: originalText ? text : undefined,
    timestamp: Date.now(),
    ...(quote && {
      quote: {
        msgId: quote.msgId,
        text: quote.text || "",
        senderName: quote.senderName || "",
        msgType: 1, // chat.text
      },
    }),
  });

  let result;
  try {
    result = await api.sendMessage(
      messageToSend,
      threadId,
      isGroup ? ThreadType.Group : ThreadType.User
    );
  } catch (err) {
    console.error("[Zalo] sendMessage failed:", err);
    // quote 전송 실패 시 plain text로 재시도
    if (quote) {
      console.warn("[Zalo] Retrying without quote...");
      result = await api.sendMessage(text, threadId, isGroup ? ThreadType.Group : ThreadType.User);
    } else {
      throw err;
    }
  }

  // Zalo 서버 할당 ID 매핑 (리액션 매칭용)
  const zaloMsgId = result?.message?.msgId?.toString();
  if (zaloMsgId) {
    store.mapZaloId(zaloMsgId, localId);
  }
}

/**
 * Send an image to a user.
 */
export async function sendZaloImage(
  userId: string,
  threadId: string,
  imageBuffer: Buffer,
  fileName: string,
  caption?: string,
  isGroup = false
): Promise<string> {
  const api = getZaloApiForUser(userId);
  if (!api) throw new Error("Zalo not connected");

  // EXIF 방향 메타데이터 기반 자동 회전 (세로 사진이 가로로 보이는 문제 방지)
  const isImage = /\.(jpg|jpeg|png|webp|tiff?)$/i.test(fileName);
  const rotatedBuffer = isImage ? await sharp(imageBuffer).rotate().toBuffer() : imageBuffer;

  const isImageFile = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fileName);
  const msgId = `sent-img-${Date.now()}`;
  const store = getMessageStoreForUser(userId);
  // selfListen 에코 중복 방지: 전송 전에 로컬 ID 마킹 + 메시지 저장.
  // hasAttachment=true로 마킹하여 첨부 에코(60초 윈도우) 매칭을 보장.
  // 캡션이 있으면 text도 등록하여 캡션 텍스트 에코까지 차단.
  markRecentSend(userId, msgId, { text: caption || undefined, threadId, hasAttachment: true });
  store.addMessage({
    id: msgId,
    threadId,
    from: "me",
    text: caption || "",
    timestamp: Date.now(),
    attachments: [
      {
        type: isImageFile ? "image" : "file",
        url: "",
        fileName: fileName,
        fileData: imageBuffer,
      },
    ],
  });

  const result = await api.sendMessage(
    {
      msg: caption || "",
      attachments: [
        {
          data: rotatedBuffer,
          filename: fileName as `${string}.${string}`,
          metadata: { totalSize: rotatedBuffer.length },
        },
      ],
    },
    threadId,
    isGroup ? ThreadType.Group : ThreadType.User
  );

  // Zalo 서버 할당 ID 매핑 (리액션 매칭용)
  const zaloMsgId =
    result?.message?.msgId?.toString() || result?.attachment?.[0]?.msgId?.toString();
  if (zaloMsgId) {
    store.mapZaloId(zaloMsgId, msgId);
  }
  return msgId;
}

/**
 * Send a reaction to a message.
 */
export async function sendZaloReaction(
  userId: string,
  threadId: string,
  msgId: string,
  icon: string,
  isGroup = false
): Promise<void> {
  const api = getZaloApiForUser(userId);
  if (!api) throw new Error("Zalo not connected");

  const store = getMessageStoreForUser(userId);
  // 로컬 temp ID → Zalo 서버 ID 변환 (보낸 메시지에 리액션 보낼 때)
  const zaloMsgId = store.toZaloId(msgId);
  // cliMsgId 조회 (Zalo 모바일 호환에 필수)
  const cliMsgId = store.getCliMsgId(msgId) || zaloMsgId;

  const reactionIcon = icon as Reactions;
  await api.addReaction(reactionIcon, {
    data: { msgId: zaloMsgId, cliMsgId },
    threadId,
    type: isGroup ? ThreadType.Group : ThreadType.User,
  });

  // 로컬 스토어 업데이트 (폴링 시 반영 + DB 저장) — 로컬 ID 사용
  const ownId = getOwnIdForUser(userId) || "me";
  store.updateReaction({
    msgId,
    reactorId: ownId,
    icon,
  });
}

/** 별칭 변경 (DB + 메모리 우선, Zalo API는 best-effort) */
export async function changeAlias(
  userId: string,
  targetUserId: string,
  alias: string
): Promise<void> {
  const store = getMessageStoreForUser(userId);
  getAliasesForUser(userId).set(targetUserId, alias);
  const thread = store.threads.get(targetUserId);
  if (thread) thread.alias = alias;

  const dbStore = await getDbStore(userId);
  if (dbStore) await dbStore.upsertAlias(targetUserId, alias);

  const api = getZaloApiForUser(userId);
  if (api) {
    try {
      await api.changeFriendAlias(alias, targetUserId);
    } catch (err) {
      console.warn("[Zalo] changeFriendAlias API failed:", err);
    }
  }
}

/** 별칭 제거 */
export async function removeAlias(userId: string, targetUserId: string): Promise<void> {
  const store = getMessageStoreForUser(userId);
  getAliasesForUser(userId).delete(targetUserId);
  const thread = store.threads.get(targetUserId);
  if (thread) thread.alias = undefined;

  const dbStore = await getDbStore(userId);
  if (dbStore) await dbStore.deleteAlias(targetUserId);

  const api = getZaloApiForUser(userId);
  if (api) {
    try {
      await api.removeFriendAlias(targetUserId);
    } catch (err) {
      console.warn("[Zalo] removeFriendAlias API failed:", err);
    }
  }
}

/**
 * Get user info by ID.
 */
export async function getZaloProfile(userId: string, targetUserId: string) {
  const api = getZaloApiForUser(userId);
  if (!api) throw new Error("Zalo not connected");
  return api.getUserInfo(targetUserId);
}

/**
 * Get group members for @mention
 */
export async function getGroupMembers(userId: string, groupId: string) {
  const api = getZaloApiForUser(userId);
  if (!api) throw new Error("Zalo not connected");
  const info = await api.getGroupInfo(groupId);
  const group = info.gridInfoMap[groupId] || Object.values(info.gridInfoMap)[0];
  if (!group) return [];

  // currentMems가 있으면 사용
  if (group.currentMems?.length) {
    return group.currentMems.map((m) => ({
      uid: m.id,
      displayName: m.dName || m.zaloName,
      avatar: m.avatar,
    }));
  }

  // currentMems가 비어있으면 memberIds로 프로필 조회
  if (group.memberIds?.length) {
    try {
      const profiles = await api.getGroupMembersInfo(group.memberIds);
      return Object.values(profiles.profiles || {}).map((p) => ({
        uid: p.id,
        displayName: p.displayName || p.zaloName,
        avatar: p.avatar,
      }));
    } catch {
      // 프로필 조회 실패 시 ID만 반환
      return group.memberIds.map((id) => ({
        uid: id,
        displayName: id,
        avatar: "",
      }));
    }
  }

  // memberIds가 비어있으면 memVerList 사용 (Zalo API 특성)
  const rawGroup = group as typeof group & { memVerList?: string[] };
  // memVerList는 "uid:version" 또는 순수 uid 형식일 수 있음
  const memVerIds = (rawGroup.memVerList || []).map((v) => v.split(":")[0]).filter(Boolean);
  if (memVerIds.length) {
    try {
      const profiles = await api.getGroupMembersInfo(memVerIds);
      return Object.values(profiles.profiles || {}).map((p) => ({
        uid: p.id,
        displayName: p.displayName || p.zaloName,
        avatar: p.avatar,
      }));
    } catch {
      return memVerIds.map((id) => ({
        uid: id,
        displayName: id,
        avatar: "",
      }));
    }
  }

  return [];
}

/**
 * 메시지 첨부파일 데이터 조회 (전달 기능용)
 */
export async function getMessageAttachmentData(
  userId: string,
  zaloMsgId: string,
  attachmentIndex = 0
) {
  const dbStore = await getDbStore(userId);
  if (!dbStore) throw new Error("DB store not available");
  return dbStore.getMessageAttachment(zaloMsgId, attachmentIndex);
}
