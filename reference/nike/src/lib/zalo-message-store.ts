// [SHARED-MODULE] from Nike src/lib/zalo-message-store.ts
/**
 * In-memory message cache with write-through to PostgreSQL.
 *
 * - 인메모리 캐시: 빠른 폴링 응답용 (hot reload에도 유지)
 * - DB 영구 저장: 서버 재시작 후에도 데이터 유지
 * - Write-through: 메시지 추가 시 인메모리 + DB 동시 저장
 */

import { ZaloDbStore, type AttachmentInput } from "./zalo-db-store";

const MAX_MESSAGES_PER_THREAD = 500;
const MAX_THREADS = 200;
const MAX_ZALO_ID_MAP = 2000;
const MAX_REACTIONS = 5000;
const MAX_DELETED_IDS_PER_THREAD = 200;

export interface StoredMessage {
  id: string;
  globalMsgId?: string; // Zalo globalMsgId (quote 참조용)
  cliMsgId?: string; // Zalo 클라이언트 메시지 ID (리액션 전송 시 필요)
  senderUid?: string; // Zalo 발신자 UID (답글 전송 시 qmsgOwner용)
  threadId: string;
  from: "me" | "other";
  text: string;
  translatedText?: string;
  timestamp: number;
  senderName?: string;
  attachments?: AttachmentInput[];
  threadType?: string; // "user" | "group"
  quote?: {
    text: string;
    senderName: string;
    msgType: number;
    msgId?: string;
  };
}

export interface StoredReaction {
  reactorId: string;
  reactorName?: string;
  icon: string;
}

export interface ThreadInfo {
  threadId: string;
  displayName: string;
  avatar: string;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
  isGroup?: boolean;
  memberCount?: number;
  alias?: string;
}

class ZaloMessageStore {
  messages = new Map<string, StoredMessage[]>();
  threads = new Map<string, ThreadInfo>();
  reactions = new Map<string, StoredReaction[]>(); // msgId → reactions
  // Zalo 서버 할당 ID → 로컬 ID 매핑 (보낸 메시지 리액션 매칭용)
  private zaloIdMap = new Map<string, string>();
  // 로컬 ID → Zalo 서버 ID 역방향 맵 (O(1) 역조회)
  private reverseIdMap = new Map<string, string>();
  // 최근 삭제된 메시지 ID 추적 (threadId → Set<msgId>)
  private deletedIds = new Map<string, Set<string>>();
  private dbStore: ZaloDbStore | null = null;

  /** 모든 인메모리 데이터 초기화 (QR 재로그인 시 이전 세션 데이터 제거) */
  clear() {
    this.messages.clear();
    this.threads.clear();
    this.reactions.clear();
    this.zaloIdMap.clear();
    this.reverseIdMap.clear();
    this.deletedIds.clear();
    // dbStore는 유지 — 외부에서 재설정
  }

  /** DB Store 연결 (accountId 확정 후 호출) */
  setDbStore(accountId: string) {
    this.dbStore = new ZaloDbStore(accountId);
  }

  getDbStore(): ZaloDbStore | null {
    return this.dbStore;
  }

  addMessage(msg: StoredMessage) {
    const list = this.messages.get(msg.threadId) || [];
    // 중복 방지: 같은 ID이거나, zaloIdMap에 이미 매핑된 에코 메시지면 스킵
    if (list.some((m) => m.id === msg.id)) return;
    const mappedLocalId = this.zaloIdMap.get(msg.id);
    if (mappedLocalId && list.some((m) => m.id === mappedLocalId)) return;

    // 1. 인메모리 캐시 업데이트 (중복 체크 통과 후에만 카운트 증가)
    const existing = this.threads.get(msg.threadId);
    this.threads.set(msg.threadId, {
      threadId: msg.threadId,
      displayName: existing?.displayName || msg.senderName || msg.threadId,
      avatar: existing?.avatar || "",
      lastMessage:
        msg.text ||
        (msg.attachments?.some((a) => a.type === "voice")
          ? "🎤 음성 메시지"
          : msg.attachments?.some((a) => a.type === "file")
            ? `📎 ${msg.attachments.find((a) => a.type === "file")?.fileName || "파일"}`
            : msg.attachments?.length
              ? "[이미지]"
              : "[메시지]"),
      lastMessageTime: msg.timestamp,
      unreadCount: msg.from === "other" ? (existing?.unreadCount ?? 0) + 1 : 0,
      isGroup: msg.threadType === "group" ? true : existing?.isGroup,
      memberCount: existing?.memberCount,
      alias: existing?.alias,
    });

    list.push(msg);

    if (list.length > MAX_MESSAGES_PER_THREAD) {
      const removed = list.splice(0, list.length - MAX_MESSAGES_PER_THREAD);
      for (const m of removed) this.reactions.delete(m.id);
    }
    this.messages.set(msg.threadId, list);

    // Cap total threads
    if (this.threads.size > MAX_THREADS) {
      const sorted = Array.from(this.threads.entries()).sort(
        (a, b) => a[1].lastMessageTime - b[1].lastMessageTime
      );
      const toRemove = sorted.slice(0, this.threads.size - MAX_THREADS);
      for (const [id] of toRemove as [string, ThreadInfo][]) {
        // 스레드의 메시지 리액션 + 삭제ID도 정리
        const msgs = this.messages.get(id);
        if (msgs) {
          for (const m of msgs) this.reactions.delete(m.id);
        }
        this.threads.delete(id);
        this.messages.delete(id);
        this.deletedIds.delete(id);
      }
    }

    // 2. DB 비동기 저장 (fire-and-forget)
    if (this.dbStore) {
      this.dbStore.persistMessage(msg).catch((err) => {
        console.error("[ZaloStore] DB persist failed:", err);
      });
    }
  }

  getMessages(threadId: string): StoredMessage[] {
    return this.messages.get(threadId) || [];
  }

  getThreads(): ThreadInfo[] {
    return Array.from(this.threads.values()).sort((a, b) => b.lastMessageTime - a.lastMessageTime);
  }

  getNewMessagesSince(threadId: string, since: number): StoredMessage[] {
    const list = this.messages.get(threadId) || [];
    return list.filter((m) => m.timestamp > since);
  }

  markRead(threadId: string) {
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.unreadCount = 0;
    }
    // DB도 업데이트
    if (this.dbStore) {
      this.dbStore.markRead(threadId).catch(() => {});
    }
  }

  /** 번역 텍스트 업데이트 */
  updateTranslation(messageId: string, translatedText: string) {
    // 인메모리 업데이트
    this.messages.forEach((list) => {
      const msg = list.find((m) => m.id === messageId);
      if (msg) {
        msg.translatedText = translatedText;
      }
    });
    // DB 업데이트
    if (this.dbStore) {
      this.dbStore.updateTranslation(messageId, translatedText).catch(() => {});
    }
  }

  /** 음성 STT+번역 결과 업데이트 (비동기 처리 완료 후) */
  updateVoiceResult(messageId: string, sttText: string, translatedText: string) {
    // 인메모리: 메시지 + 첨부파일 업데이트
    this.messages.forEach((list) => {
      const msg = list.find((m) => m.id === messageId);
      if (msg) {
        msg.translatedText = translatedText;
        if (msg.attachments) {
          const voiceAtt = msg.attachments.find((a) => a.type === "voice");
          if (voiceAtt) voiceAtt.ocrTranslatedText = sttText;
        }
      }
    });
    // DB: 메시지 번역 + 첨부파일 ocrTranslatedText 업데이트
    if (this.dbStore) {
      this.dbStore.updateTranslation(messageId, translatedText).catch(() => {});
      this.dbStore.updateVoiceAttachmentStt(messageId, sttText).catch(() => {});
    }
  }

  /** 파일 첨부 URL 업데이트 (비동기 재시도 후) */
  updateFileAttachmentUrl(messageId: string, url: string, fileName?: string) {
    this.messages.forEach((list) => {
      const msg = list.find((m) => m.id === messageId);
      if (msg?.attachments) {
        const fileAtt = msg.attachments.find((a) => a.type === "file");
        if (fileAtt) fileAtt.url = url;
      }
    });
    if (this.dbStore) {
      this.dbStore.updateFileAttachmentUrl(messageId, url, fileName).catch(() => {});
    }
  }

  /** Zalo 서버 할당 msgId ↔ 로컬 ID 매핑 등록 (보낸 메시지용) */
  mapZaloId(zaloMsgId: string, localId: string) {
    this.zaloIdMap.set(String(zaloMsgId), String(localId));
    this.reverseIdMap.set(String(localId), String(zaloMsgId));
    // 크기 제한: 오래된 항목 제거
    if (this.zaloIdMap.size > MAX_ZALO_ID_MAP) {
      const iter = this.zaloIdMap.keys();
      for (let i = 0; i < this.zaloIdMap.size - MAX_ZALO_ID_MAP; i++) {
        const key = iter.next().value;
        if (key) {
          const localVal = this.zaloIdMap.get(key);
          if (localVal) this.reverseIdMap.delete(localVal);
          this.zaloIdMap.delete(key);
        }
      }
    }
  }

  /** Zalo ID → 로컬 ID 해석 (매핑 없으면 원본 반환) */
  resolveId(msgId: string): string {
    return this.zaloIdMap.get(msgId) || msgId;
  }

  /** 로컬 ID → Zalo ID 역해석 (보낸 메시지에 리액션 보낼 때 사용) */
  toZaloId(localId: string): string {
    return this.reverseIdMap.get(localId) || localId;
  }

  /** 메시지의 cliMsgId 조회 (리액션 전송 시 필요) */
  getCliMsgId(msgId: string): string | undefined {
    let cliId: string | undefined;
    this.messages.forEach((list) => {
      if (cliId) return;
      const msg = list.find((m) => m.id === msgId);
      if (msg?.cliMsgId) cliId = msg.cliMsgId;
    });
    return cliId;
  }

  /** DB에서 로드한 리액션을 인메모리에 세팅 (DB write-back 없음) */
  loadReactions(
    msgId: string,
    reactions: { reactorId: string; reactorName?: string | null; icon: string }[]
  ) {
    if (!reactions.length) return;
    this.reactions.set(
      String(msgId),
      reactions.map((r) => ({
        reactorId: r.reactorId,
        reactorName: r.reactorName || undefined,
        icon: r.icon,
      }))
    );
  }

  /** 리액션 업데이트 (추가/변경/삭제) */
  updateReaction(info: { msgId: string; reactorId: string; reactorName?: string; icon: string }) {
    // Zalo WebSocket에서 JSON.parse 후 number 타입이 올 수 있으므로 string 보장
    const msgIdStr = String(info.msgId);
    // Zalo 서버 ID → 로컬 ID 해석 (보낸 메시지 리액션 매칭)
    const resolvedId = this.zaloIdMap.get(msgIdStr) || msgIdStr;
    const list = this.reactions.get(resolvedId) || [];
    const idx = list.findIndex((r) => r.reactorId === info.reactorId);

    if (!info.icon) {
      // 리액션 삭제
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx >= 0) {
      // 리액션 변경
      list[idx].icon = info.icon;
      if (info.reactorName) list[idx].reactorName = info.reactorName;
    } else {
      // 새 리액션
      list.push({ reactorId: info.reactorId, reactorName: info.reactorName, icon: info.icon });
    }

    if (list.length === 0) {
      this.reactions.delete(resolvedId);
    } else {
      this.reactions.set(resolvedId, list);
    }

    // reactions Map 전체 크기 캡 (오래된 항목부터 제거)
    if (this.reactions.size > MAX_REACTIONS) {
      const iter = this.reactions.keys();
      const deleteCount = this.reactions.size - MAX_REACTIONS;
      for (let i = 0; i < deleteCount; i++) {
        const key = iter.next().value;
        if (key) this.reactions.delete(key);
      }
    }

    // DB 비동기 저장 (해석된 ID로 시도, 실패 시 원본 ID 재시도)
    if (this.dbStore) {
      this.dbStore.persistReaction({ ...info, msgId: resolvedId }).catch(() => {
        if (resolvedId !== info.msgId) {
          this.dbStore!.persistReaction(info).catch(() => {});
        }
      });
    }
  }

  /** 메시지의 리액션을 집계 형태로 반환 */
  getReactionSummary(msgId: string): { icon: string; count: number; reactors?: string[] }[] {
    const list = this.reactions.get(String(msgId));
    if (!list?.length) return [];

    const grouped = new Map<string, { count: number; names: string[] }>();
    for (const r of list) {
      const entry = grouped.get(r.icon) || { count: 0, names: [] };
      entry.count++;
      if (r.reactorName) entry.names.push(r.reactorName);
      grouped.set(r.icon, entry);
    }
    return Array.from(grouped.entries()).map(([icon, { count, names }]) => ({
      icon,
      count,
      ...(names.length > 0 && { reactors: names }),
    }));
  }

  /** 메시지 삭제 (Zalo thu hồi/recall 처리) */
  removeMessage(threadId: string, msgId: string) {
    // 인메모리에서 삭제
    const list = this.messages.get(threadId);
    if (list) {
      const idx = list.findIndex((m) => m.id === msgId);
      if (idx >= 0) list.splice(idx, 1);
    }
    // 리액션도 삭제
    this.reactions.delete(msgId);
    // 삭제 ID 추적 (클라이언트 폴링용)
    if (!this.deletedIds.has(threadId)) {
      this.deletedIds.set(threadId, new Set());
    }
    const delSet = this.deletedIds.get(threadId)!;
    delSet.add(msgId);
    // per-thread 캡: 오래된 삭제ID 제거 (FIFO)
    if (delSet.size > MAX_DELETED_IDS_PER_THREAD) {
      const iter = delSet.values();
      const removeCount = delSet.size - MAX_DELETED_IDS_PER_THREAD;
      for (let i = 0; i < removeCount; i++) {
        const val = iter.next().value;
        if (val) delSet.delete(val);
      }
    }
    // DB에서도 삭제
    if (this.dbStore) {
      this.dbStore.deleteMessage(msgId).catch(() => {});
    }
  }

  /** 삭제된 메시지 ID 목록 조회 (클라이언트 폴링 후 비움) */
  getAndClearDeletedIds(threadId: string): string[] {
    const set = this.deletedIds.get(threadId);
    if (!set || set.size === 0) return [];
    const ids = Array.from(set);
    set.clear();
    return ids;
  }

  /** Upsert thread info (e.g. from friends list) without overwriting messages */
  upsertThread(info: Partial<ThreadInfo> & { threadId: string }) {
    const existing = this.threads.get(info.threadId);
    this.threads.set(info.threadId, {
      threadId: info.threadId,
      displayName: info.displayName || existing?.displayName || info.threadId,
      avatar: info.avatar || existing?.avatar || "",
      lastMessage: existing?.lastMessage || info.lastMessage || "",
      lastMessageTime: existing?.lastMessageTime || info.lastMessageTime || 0,
      unreadCount: info.unreadCount ?? existing?.unreadCount ?? 0,
      isGroup: info.isGroup ?? existing?.isGroup,
      memberCount: info.memberCount ?? existing?.memberCount,
      alias: info.alias ?? existing?.alias,
    });
    // DB에도 스레드 정보 저장
    if (this.dbStore) {
      this.dbStore
        .upsertThread({
          zaloThreadId: info.threadId,
          displayName: info.displayName || existing?.displayName || info.threadId,
          avatar: info.avatar || existing?.avatar,
          threadType: info.isGroup ? "group" : undefined,
          memberCount: info.memberCount,
        })
        .catch(() => {});
    }
  }
}

// Export the class for per-user instances (used by zalo-pool.ts)
export { ZaloMessageStore };

// Legacy global singleton (for backward compat during migration)
const globalForStore = globalThis as unknown as {
  zaloMessageStore: ZaloMessageStore | undefined;
};

export const messageStore = globalForStore.zaloMessageStore ?? new ZaloMessageStore();

if (process.env.NODE_ENV !== "production") {
  globalForStore.zaloMessageStore = messageStore;
}
