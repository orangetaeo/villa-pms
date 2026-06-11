// [SHARED-MODULE] from Nike src/lib/zalo-db-store.ts
import prisma from "./prisma";
import { compressImageToThumb } from "./image-compress";
import logger from "./logger";

function detectMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    csv: "text/csv",
    txt: "text/plain",
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    mp4: "video/mp4",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

export interface AttachmentInput {
  id?: string; // DB PK — persistAttachment 후 반영
  type: string;
  url: string;
  thumbUrl?: string;
  duration?: number;
  ocrTranslatedText?: string;
  fileName?: string;
  fileData?: Buffer; // 직접 제공된 파일 데이터 (프로그램에서 전송 시)
}

/**
 * Zalo 메시지/스레드 DB 영구 저장 레이어
 */
export class ZaloDbStore {
  constructor(private accountId: string) {}

  /** 메시지를 DB에 저장 (스레드 자동 upsert) */
  async persistMessage(msg: {
    id: string;
    globalMsgId?: string;
    cliMsgId?: string;
    senderUid?: string;
    threadId: string;
    from: "me" | "other";
    text: string;
    translatedText?: string;
    timestamp: number;
    senderName?: string;
    threadType?: string;
    attachments?: AttachmentInput[];
    quote?: {
      text: string;
      senderName: string;
      msgType: number;
      msgId?: string;
    };
  }): Promise<void> {
    // 1. Upsert thread
    const thread = await prisma.zaloThread.upsert({
      where: {
        zaloThreadId_accountId: {
          zaloThreadId: msg.threadId,
          accountId: this.accountId,
        },
      },
      update: {
        lastMessage:
          msg.text ||
          (msg.attachments?.some((a) => a.type === "voice")
            ? "🎤 음성 메시지"
            : msg.attachments?.some((a) => a.type === "file")
              ? `📎 ${msg.attachments.find((a) => a.type === "file")?.fileName || "파일"}`
              : msg.attachments?.length
                ? "[이미지]"
                : "[메시지]"),
        lastMessageTime: new Date(msg.timestamp),
        ...(msg.from === "other" ? { unreadCount: { increment: 1 } } : { unreadCount: 0 }),
        // 그룹 채팅이면 개별 발신자 이름으로 덮어쓰지 않음
        ...(msg.senderName &&
          msg.from === "other" &&
          msg.threadType !== "group" && { displayName: msg.senderName }),
      },
      create: {
        zaloThreadId: msg.threadId,
        accountId: this.accountId,
        displayName: msg.senderName || msg.threadId,
        lastMessage:
          msg.text ||
          (msg.attachments?.some((a) => a.type === "voice")
            ? "🎤 음성 메시지"
            : msg.attachments?.some((a) => a.type === "file")
              ? `📎 ${msg.attachments.find((a) => a.type === "file")?.fileName || "파일"}`
              : msg.attachments?.length
                ? "[이미지]"
                : "[메시지]"),
        lastMessageTime: new Date(msg.timestamp),
        unreadCount: msg.from === "other" ? 1 : 0,
        threadType: msg.threadType || "user",
      },
    });

    // 2. Upsert message
    const existing = await prisma.zaloMessage.findUnique({
      where: {
        zaloMsgId_accountId: {
          zaloMsgId: msg.id,
          accountId: this.accountId,
        },
      },
      select: { id: true },
    });

    if (existing) return; // 중복 방지

    const dbMsg = await prisma.zaloMessage.create({
      data: {
        zaloMsgId: msg.id,
        threadId: thread.id,
        accountId: this.accountId,
        direction: msg.from === "me" ? "sent" : "received",
        text: msg.text || null,
        translatedText: msg.translatedText || null,
        msgType: msg.attachments?.some((a) => a.type === "voice")
          ? "voice"
          : msg.attachments?.some((a) => a.type === "file")
            ? "file"
            : msg.attachments?.some((a) => a.type === "sticker")
              ? "sticker"
              : msg.attachments?.length
                ? "image"
                : "text",
        timestamp: new Date(msg.timestamp),
        senderName: msg.senderName || null,
        globalMsgId: msg.globalMsgId || null,
        cliMsgId: msg.cliMsgId || null,
        senderUid: msg.senderUid || null,
        quoteText: msg.quote?.text || null,
        quoteSender: msg.quote?.senderName || null,
        quoteMsgType: msg.quote?.msgType ?? null,
        quoteMsgId: msg.quote?.msgId || null,
      },
    });

    // 3. 첨부파일 처리 (이미지 압축 포함) — DB ID를 인메모리에 반영
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        const dbAttId = await this.persistAttachment(dbMsg.id, att);
        att.id = dbAttId;
      }
    }
  }

  /** 첨부파일 저장 (이미지는 다운로드 후 썸네일 압축, 음성은 다운로드 캐시) — DB PK 반환 */
  private async persistAttachment(messageId: string, att: AttachmentInput): Promise<string> {
    let thumbData: Buffer | null = null;
    let thumbWidth: number | null = null;
    let thumbHeight: number | null = null;
    let mimeType: string | null = null;
    let duration: number | null = null;

    if (att.type === "image") {
      if (att.fileData) {
        // 직접 제공된 이미지 데이터 (프로그램에서 전송 시)
        try {
          const result = await compressImageToThumb(att.fileData);
          thumbData = result.data;
          thumbWidth = result.width;
          thumbHeight = result.height;
          mimeType = result.mimeType;
        } catch {
          // 압축 실패 시 원본 저장
          thumbData = att.fileData;
          mimeType = detectMimeType(att.fileName || "image.jpg");
        }
      } else {
        const imageUrl = att.thumbUrl || att.url;
        if (imageUrl) {
          try {
            const result = await compressImageToThumb(imageUrl);
            thumbData = result.data;
            thumbWidth = result.width;
            thumbHeight = result.height;
            mimeType = result.mimeType;
          } catch (err) {
            console.error("[ZaloDb] Image compression failed, trying raw download:", err);
            // 압축 실패 시 원본 이미지를 그대로 다운로드하여 저장 (CDN URL 만료 대비)
            try {
              const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
              if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                if (buf.length <= 5 * 1024 * 1024) {
                  thumbData = buf;
                  mimeType = res.headers.get("content-type") || "image/jpeg";
                  logger.debug(`[ZaloDb] Raw image saved (${Math.round(buf.length / 1024)}KB)`);
                }
              }
            } catch (rawErr) {
              console.error("[ZaloDb] Raw image download also failed:", rawErr);
            }
          }
        }
      }
    } else if (att.type === "sticker") {
      // 스티커: 다운로드하여 DB 캐시 (Zalo CDN URL 만료 대비)
      if (att.url) {
        try {
          const res = await fetch(att.url, { signal: AbortSignal.timeout(10_000) });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length <= 500 * 1024) {
              thumbData = buf;
              mimeType = res.headers.get("content-type") || "image/png";
              thumbWidth = 128;
              thumbHeight = 128;
            }
          }
        } catch (err) {
          console.error("[ZaloDb] Sticker download failed:", err);
        }
      }
    } else if (att.type === "voice") {
      mimeType = "audio/mp4";
      duration = att.duration || null;
      // 음성 파일 다운로드하여 DB 캐시 (Zalo URL 만료 대비)
      if (att.url) {
        try {
          const res = await fetch(att.url, { signal: AbortSignal.timeout(15_000) });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            // 1MB 이하만 DB에 저장
            if (buf.length <= 1024 * 1024) {
              thumbData = buf;
            }
          }
        } catch (err) {
          console.error("[ZaloDb] Voice download failed:", err);
        }
      }
    } else if (att.type === "file") {
      if (att.fileData) {
        // 직접 제공된 파일 데이터 (프로그램에서 전송 시)
        thumbData = att.fileData;
        mimeType = detectMimeType(att.fileName || "");
        logger.debug(
          `[ZaloDb] File stored directly: ${att.fileName || "file"} (${Math.round(att.fileData.length / 1024)}KB)`
        );
      } else if (att.url) {
        // 파일 다운로드하여 DB 캐시 (Zalo CDN URL 만료 대비)
        try {
          const res = await fetch(att.url, { signal: AbortSignal.timeout(30_000) });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            // 20MB 이하만 DB에 저장
            if (buf.length <= 20 * 1024 * 1024) {
              thumbData = buf;
              // 파일명 기반 mimeType 우선 (Zalo CDN은 종종 application/octet-stream 반환)
              const detectedMime = att.fileName ? detectMimeType(att.fileName) : null;
              mimeType =
                detectedMime && detectedMime !== "application/octet-stream"
                  ? detectedMime
                  : res.headers.get("content-type") || "application/octet-stream";
            }
          }
        } catch (err) {
          console.error("[ZaloDb] File download failed:", err);
        }
      }
    }

    const created = await prisma.zaloAttachment.create({
      data: {
        messageId,
        type: att.type,
        originalUrl: att.url || null,
        thumbData: thumbData ? new Uint8Array(thumbData) : null,
        thumbWidth,
        thumbHeight,
        fileName: att.fileName?.normalize("NFC") || null,
        fileSize: thumbData?.length || null,
        mimeType,
        duration,
        ocrTranslatedText: att.ocrTranslatedText || null,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** 번역 텍스트 업데이트 */
  async updateTranslation(zaloMsgId: string, translatedText: string): Promise<void> {
    await prisma.zaloMessage.updateMany({
      where: { zaloMsgId, accountId: this.accountId },
      data: { translatedText },
    });
  }

  /** 메시지 삭제 (Zalo recall/thu hồi) — 첨부파일 포함, 트랜잭션 사용 */
  async deleteMessage(zaloMsgId: string): Promise<void> {
    const msg = await prisma.zaloMessage.findFirst({
      where: { zaloMsgId, accountId: this.accountId },
      select: { id: true },
    });
    if (!msg) return;
    await prisma.$transaction([
      prisma.zaloAttachment.deleteMany({ where: { messageId: msg.id } }),
      prisma.zaloReaction.deleteMany({ where: { messageId: msg.id } }),
      prisma.zaloMessage.delete({ where: { id: msg.id } }),
    ]);
  }

  /** 답글 전송용 원본 메시지 조회 (인메모리 캐시 미스 시 DB fallback) */
  async getMessageForQuote(zaloMsgId: string): Promise<{
    zaloMsgId: string;
    direction: string;
    text: string | null;
    timestamp: Date;
    cliMsgId: string | null;
    senderUid: string | null;
  } | null> {
    return prisma.zaloMessage.findFirst({
      where: { zaloMsgId, accountId: this.accountId },
      select: {
        zaloMsgId: true,
        direction: true,
        text: true,
        timestamp: true,
        cliMsgId: true,
        senderUid: true,
      },
    });
  }

  /** 음성 첨부파일의 STT 결과 업데이트 */
  async updateVoiceAttachmentStt(zaloMsgId: string, sttText: string): Promise<void> {
    const msg = await prisma.zaloMessage.findFirst({
      where: { zaloMsgId, accountId: this.accountId },
      select: { id: true },
    });
    if (!msg) return;
    await prisma.zaloAttachment.updateMany({
      where: { messageId: msg.id, type: "voice" },
      data: { ocrTranslatedText: sttText },
    });
  }

  /** 파일 첨부 URL 업데이트 + 파일 다운로드 캐싱 */
  async updateFileAttachmentUrl(zaloMsgId: string, url: string, _fileName?: string): Promise<void> {
    const msg = await prisma.zaloMessage.findFirst({
      where: { zaloMsgId, accountId: this.accountId },
      select: { id: true },
    });
    if (!msg) return;

    const data: Record<string, unknown> = { originalUrl: url };
    if (_fileName) data.fileName = _fileName;

    // URL이 있으면 파일 다운로드 시도
    if (url) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length <= 20 * 1024 * 1024) {
            data.thumbData = buf;
            data.mimeType = res.headers.get("content-type") || "application/octet-stream";
            logger.debug(
              `[ZaloDb] File cached via retry: ${_fileName || "file"} (${Math.round(buf.length / 1024)}KB)`
            );
          }
        }
      } catch (err) {
        console.error("[ZaloDb] File download retry failed:", err);
      }
    }

    await prisma.zaloAttachment.updateMany({
      where: { messageId: msg.id, type: "file" },
      data,
    });
  }

  /** 리액션 저장/업데이트 */
  async persistReaction(info: {
    msgId: string;
    reactorId: string;
    reactorName?: string;
    icon: string;
  }): Promise<void> {
    const msg = await prisma.zaloMessage.findFirst({
      where: { zaloMsgId: info.msgId, accountId: this.accountId },
      select: { id: true },
    });
    if (!msg) return;

    if (!info.icon) {
      // 리액션 삭제
      await prisma.zaloReaction.deleteMany({
        where: { messageId: msg.id, reactorId: info.reactorId },
      });
    } else {
      // 리액션 upsert
      await prisma.zaloReaction.upsert({
        where: {
          messageId_reactorId: { messageId: msg.id, reactorId: info.reactorId },
        },
        update: {
          icon: info.icon,
          reactorName: info.reactorName || undefined,
          timestamp: new Date(),
        },
        create: {
          messageId: msg.id,
          accountId: this.accountId,
          reactorId: info.reactorId,
          reactorName: info.reactorName || null,
          icon: info.icon,
          timestamp: new Date(),
        },
      });
    }
  }

  /**
   * quoteMsgId(globalMsgId) → zaloMsgId 변환
   * DB에서 로드한 메시지의 quote.msgId가 globalMsgId인데,
   * DOM에서는 data-msg-id(=zaloMsgId)로 검색하므로 변환 필요
   */
  private async resolveQuoteMsgIds(
    messages: { quoteMsgId?: string | null; zaloMsgId: string; globalMsgId?: string | null }[]
  ) {
    const quoteMsgIds = messages.filter((m) => m.quoteMsgId).map((m) => m.quoteMsgId!);
    if (quoteMsgIds.length === 0) return;

    // 1차: 같은 배치 내 globalMsgId → zaloMsgId 매핑
    const globalToZalo = new Map<string, string>();
    for (const m of messages) {
      if (m.globalMsgId) globalToZalo.set(m.globalMsgId, m.zaloMsgId);
    }

    // 2차: 배치에 없으면 DB 조회
    const unresolved = quoteMsgIds.filter((id) => !globalToZalo.has(id));
    if (unresolved.length > 0) {
      const found = await prisma.zaloMessage.findMany({
        where: { globalMsgId: { in: unresolved }, accountId: this.accountId },
        select: { globalMsgId: true, zaloMsgId: true },
      });
      for (const f of found) {
        if (f.globalMsgId) globalToZalo.set(f.globalMsgId, f.zaloMsgId);
      }
    }

    // 변환 적용
    for (const m of messages) {
      if (m.quoteMsgId && globalToZalo.has(m.quoteMsgId)) {
        m.quoteMsgId = globalToZalo.get(m.quoteMsgId)!;
      }
    }
  }

  /** 스레드의 메시지 목록 (커서 기반 페이지네이션) */
  async getMessages(zaloThreadId: string, options: { before?: number; limit?: number } = {}) {
    const { before, limit = 50 } = options;
    const thread = await prisma.zaloThread.findUnique({
      where: {
        zaloThreadId_accountId: {
          zaloThreadId,
          accountId: this.accountId,
        },
      },
      select: { id: true },
    });
    if (!thread) return { messages: [], hasMore: false };

    const messages = await prisma.zaloMessage.findMany({
      where: {
        threadId: thread.id,
        ...(before && { timestamp: { lt: new Date(before) } }),
      },
      include: {
        attachments: {
          select: {
            id: true,
            type: true,
            originalUrl: true,
            thumbWidth: true,
            thumbHeight: true,
            mimeType: true,
            duration: true,
            ocrTranslatedText: true,
            fileName: true,
            fileSize: true,
          },
        },
        reactions: {
          select: { icon: true, reactorId: true, reactorName: true },
        },
      },
      orderBy: { timestamp: "desc" },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();
    await this.resolveQuoteMsgIds(messages);

    return {
      messages: messages.reverse(), // 오래된 것 먼저
      hasMore,
    };
  }

  /** 최근 메시지 로드 (최대 100건, 대화 열 때 기본) */
  async getRecentMessages(zaloThreadId: string, limit = 50) {
    const thread = await prisma.zaloThread.findUnique({
      where: {
        zaloThreadId_accountId: {
          zaloThreadId,
          accountId: this.accountId,
        },
      },
      select: { id: true },
    });
    if (!thread) return { messages: [], hasMore: false };

    // 최신 N+1건을 역순으로 가져와서 hasMore 판단
    const messages = await prisma.zaloMessage.findMany({
      where: { threadId: thread.id },
      include: {
        attachments: {
          select: {
            id: true,
            type: true,
            originalUrl: true,
            thumbWidth: true,
            thumbHeight: true,
            mimeType: true,
            duration: true,
            ocrTranslatedText: true,
            fileName: true,
            fileSize: true,
          },
        },
        reactions: {
          select: { icon: true, reactorId: true, reactorName: true },
        },
      },
      orderBy: { timestamp: "desc" },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();
    await this.resolveQuoteMsgIds(messages);

    return { messages: messages.reverse(), hasMore };
  }

  /** 특정 시점 이후 새 메시지 (폴링용) */
  async getNewMessages(zaloThreadId: string, since: number) {
    const thread = await prisma.zaloThread.findUnique({
      where: {
        zaloThreadId_accountId: {
          zaloThreadId,
          accountId: this.accountId,
        },
      },
      select: { id: true },
    });
    if (!thread) return [];

    return prisma.zaloMessage.findMany({
      where: {
        threadId: thread.id,
        timestamp: { gt: new Date(since) },
      },
      include: {
        attachments: {
          select: {
            id: true,
            type: true,
            originalUrl: true,
            thumbWidth: true,
            thumbHeight: true,
            mimeType: true,
            duration: true,
            ocrTranslatedText: true,
            fileName: true,
            fileSize: true,
          },
        },
        reactions: {
          select: { icon: true, reactorId: true, reactorName: true },
        },
      },
      orderBy: { timestamp: "asc" },
    });
  }

  /** 특정 메시지 ID 목록의 음성 번역 상태 조회 */
  async getVoiceTranslations(zaloMsgIds: string[]) {
    if (zaloMsgIds.length === 0) return [];
    return prisma.zaloMessage.findMany({
      where: {
        zaloMsgId: { in: zaloMsgIds },
        accountId: this.accountId,
      },
      select: {
        zaloMsgId: true,
        translatedText: true,
        attachments: {
          where: { type: "voice" },
          select: { ocrTranslatedText: true },
        },
      },
    });
  }

  /** 스레드 목록 (최신 메시지순) */
  async getThreads() {
    return prisma.zaloThread.findMany({
      where: { accountId: this.accountId },
      orderBy: { lastMessageTime: "desc" },
    });
  }

  /** 스레드 읽음 처리 */
  async markRead(zaloThreadId: string): Promise<void> {
    await prisma.zaloThread.updateMany({
      where: {
        zaloThreadId,
        accountId: this.accountId,
      },
      data: { unreadCount: 0 },
    });
  }

  /** 스레드 정보 업데이트 */
  async upsertThread(info: {
    zaloThreadId: string;
    displayName: string;
    avatar?: string;
    threadType?: string;
    memberCount?: number;
  }): Promise<void> {
    await prisma.zaloThread.upsert({
      where: {
        zaloThreadId_accountId: {
          zaloThreadId: info.zaloThreadId,
          accountId: this.accountId,
        },
      },
      update: {
        displayName: info.displayName,
        ...(info.avatar && { avatar: info.avatar }),
        ...(info.threadType && { threadType: info.threadType }),
        ...(info.memberCount !== undefined && { memberCount: info.memberCount }),
      },
      create: {
        zaloThreadId: info.zaloThreadId,
        accountId: this.accountId,
        displayName: info.displayName,
        avatar: info.avatar || "",
        threadType: info.threadType || "user",
        memberCount: info.memberCount,
      },
    });
  }

  /** 첨부파일 썸네일 바이너리 조회 */
  async getAttachmentThumb(
    attachmentId: string
  ): Promise<{ data: Buffer; mimeType: string } | null> {
    const att = await prisma.zaloAttachment.findUnique({
      where: { id: attachmentId },
      select: { thumbData: true, mimeType: true },
    });
    if (!att?.thumbData) return null;
    return { data: Buffer.from(att.thumbData), mimeType: att.mimeType || "image/jpeg" };
  }

  /** 메시지 ID로 첨부파일 데이터 조회 (전달 기능용) */
  async getMessageAttachment(
    zaloMsgId: string,
    attachmentIndex = 0
  ): Promise<{ data: Buffer; type: string; fileName: string | null } | null> {
    const dbMsg = await prisma.zaloMessage.findFirst({
      where: { zaloMsgId, accountId: this.accountId },
      include: { attachments: true },
    });
    const att = dbMsg?.attachments?.[attachmentIndex];
    if (!att?.thumbData) return null;
    return {
      data: Buffer.from(att.thumbData),
      type: att.type,
      fileName: att.fileName,
    };
  }

  /** 별칭 목록 조회 */
  async getAliases(): Promise<{ userId: string; alias: string }[]> {
    const aliases = await prisma.zaloAlias.findMany({
      where: { accountId: this.accountId },
    });
    return aliases.map((a) => ({ userId: a.userId, alias: a.alias }));
  }

  /** 별칭 upsert */
  async upsertAlias(userId: string, alias: string): Promise<void> {
    await prisma.zaloAlias.upsert({
      where: {
        userId_accountId: { userId, accountId: this.accountId },
      },
      update: { alias },
      create: { accountId: this.accountId, userId, alias },
    });
  }

  /** 별칭 삭제 */
  async deleteAlias(userId: string): Promise<void> {
    await prisma.zaloAlias.deleteMany({
      where: { userId, accountId: this.accountId },
    });
  }

  /** 별칭 일괄 동기화 */
  async syncAliases(items: { userId: string; alias: string }[]): Promise<void> {
    for (const item of items) {
      await this.upsertAlias(item.userId, item.alias);
    }
  }
}

/** DB 메시지를 API 응답 형식으로 변환 */
export function toApiMessage(dbMsg: {
  zaloMsgId: string;
  globalMsgId?: string | null;
  cliMsgId?: string | null;
  direction: string;
  text: string | null;
  translatedText: string | null;
  timestamp: Date;
  senderName: string | null;
  quoteText?: string | null;
  quoteSender?: string | null;
  quoteMsgType?: number | null;
  quoteMsgId?: string | null;
  attachments: {
    id: string;
    type: string;
    originalUrl: string | null;
    thumbWidth: number | null;
    thumbHeight: number | null;
    mimeType: string | null;
    duration: number | null;
    ocrTranslatedText: string | null;
    fileName?: string | null;
    fileSize?: number | null;
  }[];
  reactions?: {
    icon: string;
    reactorId: string;
    reactorName: string | null;
  }[];
}) {
  // 리액션 집계 (리액터 이름 포함)
  let reactions: { icon: string; count: number; reactors?: string[] }[] | undefined;
  if (dbMsg.reactions?.length) {
    const grouped = new Map<string, { count: number; names: string[] }>();
    for (const r of dbMsg.reactions) {
      const entry = grouped.get(r.icon) || { count: 0, names: [] };
      entry.count++;
      if (r.reactorName) entry.names.push(r.reactorName);
      grouped.set(r.icon, entry);
    }
    reactions = Array.from(grouped.entries()).map(([icon, { count, names }]) => ({
      icon,
      count,
      ...(names.length > 0 && { reactors: names }),
    }));
  }

  return {
    id: dbMsg.zaloMsgId,
    globalMsgId: dbMsg.globalMsgId || undefined,
    cliMsgId: dbMsg.cliMsgId || undefined,
    from: dbMsg.direction === "sent" ? "me" : ("other" as "me" | "other"),
    text: dbMsg.text || "",
    translatedText: dbMsg.translatedText || undefined,
    timestamp: dbMsg.timestamp.getTime(),
    senderName: dbMsg.senderName || undefined,
    ...(dbMsg.quoteText && {
      quote: {
        text: dbMsg.quoteText,
        senderName: dbMsg.quoteSender || undefined,
        msgType: dbMsg.quoteMsgType ?? undefined,
        msgId: dbMsg.quoteMsgId || undefined,
      },
    }),
    attachments: dbMsg.attachments.map((a) => ({
      id: a.id,
      type: a.type,
      url:
        a.type === "file"
          ? `/api/zalo/attachment/${a.id}?download=1`
          : a.type === "image"
            ? `/api/zalo/attachment/${a.id}?full=1`
            : a.originalUrl || "",
      thumbUrl: a.type === "voice" ? `/api/voice/play/${a.id}` : `/api/zalo/attachment/${a.id}`,
      thumbWidth: a.thumbWidth,
      thumbHeight: a.thumbHeight,
      duration: a.duration,
      ocrTranslatedText: a.ocrTranslatedText || undefined,
      fileName: a.fileName || undefined,
    })),
    reactions,
  };
}
