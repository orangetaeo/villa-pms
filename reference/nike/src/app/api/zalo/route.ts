// [SHARED-MODULE] from Nike src/app/api/zalo/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  isZaloConnected,
  getZaloStatus,
  listRecentChat,
  getConversation,
  getOlderMessages,
  getNewMessages,
  getVoiceTranslations,
  sendZaloMessage,
  sendZaloImage,
  sendZaloReaction,
  getZaloProfile,
  ensureConnection,
  changeAlias,
  removeAlias,
  getGroupMembers,
  getMessageAttachmentData,
} from "@/lib/zalo";
import { getMessageStoreForUser } from "@/lib/zalo-pool";
import { compressImageToThumb } from "@/lib/image-compress";
import { validateUploadFile, ALLOWED_UPLOAD_TYPES } from "@/lib/file-validation";
import { writeAuditLog } from "@/lib/audit-log";

import { withRequestLog } from "@/lib/request-log";
// Zalo 메시지 전송 Rate Limiting (사용자 기반, 1분당 20회)
const zaloSendLimiter = createRateLimiter({
  maxAttempts: 20,
  windowMs: 60 * 1000,
});

// Zalo 읽기 Rate Limiting (사용자 기반, 1분당 60회) — P2-2
const zaloReadLimiter = createRateLimiter({
  maxAttempts: 60,
  windowMs: 60 * 1000,
});

/** sendProduct 이미지 최대 크기 (10MB) — P2-3 */
const MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024;

/** sendProduct에서 허용되는 이미지 CDN 도메인 */
const ALLOWED_IMAGE_DOMAINS = [
  "kfrx-s3.kiotviet.vn",
  "publicfnb.kiotcdn.com",
  "images.kiotcdn.com",
  "kiotviet.vn",
  "kiotcdn.com",
];

/** Zalo 연결 관련 에러인지 판별 */
function isZaloConnectionError(msg: string): boolean {
  return /not connected|not logged|no credential|session|expired|ECONNREFUSED/i.test(msg);
}

/** 연결 에러 시 401, 그 외 500 응답 생성 */
function zaloErrorResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : "";
  const isConn = isZaloConnectionError(msg);
  return NextResponse.json(
    {
      success: false,
      error:
        process.env.NODE_ENV === "development"
          ? msg || "Unknown error"
          : isConn
            ? "Zalo 연결이 필요합니다. QR 로그인을 해주세요."
            : "서버 오류",
    },
    { status: isConn ? 401 : 500 }
  );
}

function isAllowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return ALLOWED_IMAGE_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getUserId(request: NextRequest): Promise<string | null> {
  const session = await getSession(request);
  if (!session || session.status !== "ACTIVE") return null;
  return session.userId;
}

async function _GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    // GET Rate Limit (status 제외, 읽기용 60회/분) — P2-2
    if (action && action !== "status") {
      const readRateCheck = zaloReadLimiter.check(userId);
      if (!readRateCheck.allowed) {
        return NextResponse.json(
          { success: false, error: "요청이 너무 빠릅니다. 잠시 후 다시 시도하세요." },
          { status: 429, headers: { "Retry-After": String(Math.ceil(readRateCheck.resetMs / 1000)) } }
        );
      }
    }

    // 자동 재연결 시도
    await ensureConnection(userId);

    if (action === "status") {
      const status = getZaloStatus(userId);
      const connected = isZaloConnected(userId);

      // 연결된 Zalo 계정 이름 조회 (소유권 확인용)
      let zaloDisplayName: string | null = null;
      if (connected) {
        const account = await prisma.zaloAccount.findUnique({
          where: { userId },
          select: { displayName: true, zaloUserId: true, userId: true },
        });
        if (account) {
          // 소유권 검증: DB의 userId와 세션 userId 일치 확인
          if (account.userId !== userId) {
            console.error(
              `[Zalo] 소유권 불일치! session=${userId}, account.userId=${account.userId}`
            );
            return NextResponse.json({
              success: true,
              data: { connected: false, status: "disconnected", needsQR: true },
            });
          }
          zaloDisplayName = account.displayName;
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          connected,
          status,
          needsQR: status !== "connected",
          zaloDisplayName,
        },
      });
    }

    // ── 소유권 검증: 모든 데이터 액션 전에 ZaloAccount 소유자 확인 ──
    // 세션 userId와 ZaloAccount.userId 불일치 시 빈 데이터 반환 (개인정보 보호)
    {
      const myAccount = await prisma.zaloAccount.findUnique({
        where: { userId },
        select: { userId: true },
      });
      if (myAccount && myAccount.userId !== userId) {
        console.error(`[Zalo] 소유권 불일치 차단: session=${userId}, account=${myAccount.userId}`);
        return NextResponse.json({ success: true, data: [] });
      }
    }

    // 읽기 전용 액션: Zalo 미연결 시에도 DB 데이터 반환
    if (action === "recentchat") {
      const threads = await listRecentChat(userId);
      const users = threads.map((t) => ({
        userId: t.threadId,
        displayName: t.alias || t.displayName,
        originalName: t.displayName,
        avatar: t.avatar,
        lastMessage: t.lastMessage,
        lastMessageTime: t.lastMessageTime,
        unreadCount: t.unreadCount,
        isGroup: t.isGroup || false,
        memberCount: t.memberCount,
        alias: t.alias,
      }));
      return NextResponse.json({ success: true, data: users });
    }

    if (action === "conversation") {
      const threadId = searchParams.get("userId");
      if (!threadId) {
        return NextResponse.json({ success: false, error: "userId required" }, { status: 400 });
      }
      const result = await getConversation(userId, threadId);
      return NextResponse.json({
        success: true,
        data: result.messages,
        hasMore: result.hasMore,
      });
    }

    if (action === "messages") {
      const threadId = searchParams.get("threadId");
      const before = searchParams.get("before");
      const limit = Math.min(
        Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1),
        200
      );
      if (!threadId) {
        return NextResponse.json({ success: false, error: "threadId required" }, { status: 400 });
      }
      const beforeTs = before ? parseInt(before, 10) : NaN;
      const result = await getOlderMessages(
        userId,
        threadId,
        Number.isFinite(beforeTs) ? beforeTs : Date.now(),
        limit
      );
      return NextResponse.json({
        success: true,
        data: result.messages,
        hasMore: result.hasMore,
      });
    }

    if (!isZaloConnected(userId)) {
      return NextResponse.json(
        { success: false, error: "Zalo not connected", code: "NOT_CONNECTED" },
        { status: 503 }
      );
    }

    switch (action) {
      case "poll": {
        const threadId = searchParams.get("threadId");
        const since = parseInt(searchParams.get("since") || "0", 10) || 0;
        if (!threadId) {
          return NextResponse.json({ success: false, error: "threadId required" }, { status: 400 });
        }
        const newMsgs = await getNewMessages(userId, threadId, since);
        const store = getMessageStoreForUser(userId);
        const deletedIds = store.getAndClearDeletedIds(threadId);
        return NextResponse.json({ success: true, data: newMsgs, deletedIds });
      }

      case "reactions": {
        const msgIds = searchParams.get("ids");
        if (!msgIds) {
          return NextResponse.json({ success: false, error: "ids required" }, { status: 400 });
        }
        const store = getMessageStoreForUser(userId);
        const reactionMap: Record<string, { icon: string; count: number; reactors?: string[] }[]> =
          {};
        for (const id of msgIds.split(",").filter(Boolean).slice(0, 100)) {
          const summary = store.getReactionSummary(id);
          if (summary.length > 0) {
            reactionMap[id] = summary;
          }
        }
        return NextResponse.json({ success: true, data: reactionMap });
      }

      case "voiceTranslations": {
        const ids = searchParams.get("ids");
        if (!ids) {
          return NextResponse.json({ success: false, error: "ids required" }, { status: 400 });
        }
        const messageIds = ids.split(",").filter(Boolean).slice(0, 100);
        const results = await getVoiceTranslations(userId, messageIds);
        return NextResponse.json({ success: true, data: results });
      }

      case "profile": {
        const targetId = searchParams.get("userId");
        if (!targetId) {
          return NextResponse.json({ success: false, error: "userId required" }, { status: 400 });
        }
        const data = await getZaloProfile(userId, targetId);
        return NextResponse.json({ success: true, data });
      }

      case "groupMembers": {
        const groupId = searchParams.get("groupId");
        if (!groupId) {
          return NextResponse.json({ success: false, error: "groupId required" }, { status: 400 });
        }
        const members = await getGroupMembers(userId, groupId);
        return NextResponse.json({ success: true, data: members });
      }

      default:
        return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    return zaloErrorResponse(error);
  }
}

async function _POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit (사용자별)
    const rateCheck = zaloSendLimiter.check(userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "메시지 전송이 너무 빠릅니다. 잠시 후 다시 시도하세요." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.resetMs / 1000)) } }
      );
    }

    await ensureConnection(userId);

    if (!isZaloConnected(userId)) {
      return NextResponse.json(
        { success: false, error: "Zalo not connected", code: "NOT_CONNECTED" },
        { status: 503 }
      );
    }

    const contentType = request.headers.get("content-type") || "";

    // 파일/이미지 전송 (FormData)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const action = formData.get("action") as string;
      const threadId = formData.get("userId") as string;

      if (action === "sendImage") {
        const file = formData.get("image") as File | null;
        if (!threadId || !file) {
          return NextResponse.json(
            { success: false, error: "userId and file required" },
            { status: 400 }
          );
        }

        // MIME 타입 + 확장자 불일치 + 크기 검증
        const validation = validateUploadFile(file, ALLOWED_UPLOAD_TYPES);
        if (!validation.valid) {
          return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const caption = (formData.get("caption") as string) || "";
        const isGroup = formData.get("isGroup") === "true";
        const isImage = file.type.startsWith("image/");

        const msgId = await sendZaloImage(userId, threadId, buffer, file.name, caption, isGroup);

        writeAuditLog({
          action: "CREATE",
          entity: "ZaloMessage",
          entityId: msgId || threadId,
          userId,
          changes: { type: "sendImage", threadId, fileName: file.name, size: buffer.length },
        }).catch(() => {});

        let thumbBase64: string | undefined;
        if (isImage) {
          try {
            const thumb = await compressImageToThumb(buffer);
            thumbBase64 = `data:image/jpeg;base64,${thumb.data.toString("base64")}`;
          } catch {
            // 썸네일 생성 실패 시 무시
          }
        }

        return NextResponse.json({ success: true, msgId, thumbUrl: thumbBase64 });
      }
    }

    // 텍스트 전송 (JSON)
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "잘못된 JSON 형식" }, { status: 400 });
    }
    const { action, userId: threadId, message, messageId, originalText } = body;

    switch (action) {
      case "send": {
        if (!threadId || !message) {
          return NextResponse.json(
            { success: false, error: "userId and message required" },
            { status: 400 }
          );
        }
        // 타입/길이 검증 — 비문자열 페이로드(객체/배열)나 과도한 길이 차단
        if (typeof message !== "string" || message.length > 10000) {
          return NextResponse.json(
            { success: false, error: "message must be a string up to 10000 chars" },
            { status: 400 }
          );
        }
        const isGroup = body.isGroup || false;
        const quote = body.quote as
          | { msgId: string; text: string; senderName?: string }
          | undefined;
        const mentions = body.mentions as { pos: number; uid: string; len: number }[] | undefined;
        await sendZaloMessage(
          userId,
          threadId,
          message,
          messageId,
          originalText,
          isGroup,
          quote,
          mentions
        );
        writeAuditLog({
          action: "CREATE",
          entity: "ZaloMessage",
          entityId: messageId || threadId,
          userId,
          changes: { type: "send", threadId, hasQuote: !!quote, hasMentions: !!mentions },
        }).catch(() => {});
        return NextResponse.json({ success: true });
      }
      case "react": {
        const { threadId: tid, msgId, icon, isGroup: isGrp } = body;
        if (!tid || !msgId || !icon) {
          return NextResponse.json(
            { success: false, error: "threadId, msgId, and icon required" },
            { status: 400 }
          );
        }
        await sendZaloReaction(userId, tid, msgId, icon, isGrp || false);
        writeAuditLog({
          action: "UPDATE",
          entity: "ZaloMessage",
          entityId: msgId,
          userId,
          changes: { type: "react", threadId: tid, icon },
        }).catch(() => {});
        return NextResponse.json({ success: true });
      }
      case "saveTranslation": {
        const { messageId: msgId, translatedText } = body;
        if (!msgId || !translatedText) {
          return NextResponse.json(
            { success: false, error: "messageId and translatedText required" },
            { status: 400 }
          );
        }
        getMessageStoreForUser(userId).updateTranslation(msgId, translatedText);
        return NextResponse.json({ success: true });
      }
      case "sendProduct": {
        const { imageUrl, caption, isGroup: isGrp2 } = body;
        const prodThreadId = body.userId as string;
        if (!prodThreadId || !imageUrl) {
          return NextResponse.json(
            { success: false, error: "userId and imageUrl required" },
            { status: 400 }
          );
        }

        // SSRF 방지: 허용된 CDN 도메인만 접근 가능
        if (!isAllowedImageUrl(imageUrl)) {
          return NextResponse.json(
            { success: false, error: "허용되지 않은 이미지 URL입니다" },
            { status: 400 }
          );
        }

        // KiotViet CDN에서 이미지 fetch → Buffer 변환
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        const imgRes = await fetch(imageUrl, { signal: controller.signal }).finally(() =>
          clearTimeout(timeout)
        );
        if (!imgRes.ok) {
          // 이미지 로드 실패 시 텍스트만 전송
          if (caption) {
            await sendZaloMessage(
              userId,
              prodThreadId,
              caption,
              undefined,
              undefined,
              isGrp2 || false
            );
          }
          return NextResponse.json({ success: true, fallback: "text" });
        }

        // P2-3: Content-Length 헤더로 크기 사전 검증
        const contentLength = parseInt(imgRes.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_PRODUCT_IMAGE_BYTES) {
          return NextResponse.json(
            { success: false, error: `이미지가 너무 큽니다 (${Math.round(contentLength / 1024 / 1024)}MB > 10MB)` },
            { status: 400 }
          );
        }

        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

        // P2-3: 실제 버퍼 크기 이중 검증 (Content-Length 미제공 대비)
        if (imgBuffer.length > MAX_PRODUCT_IMAGE_BYTES) {
          return NextResponse.json(
            { success: false, error: `이미지가 너무 큽니다 (${Math.round(imgBuffer.length / 1024 / 1024)}MB > 10MB)` },
            { status: 400 }
          );
        }
        const ext = imageUrl.split(".").pop()?.split("?")[0] || "jpg";
        const fileName = `product.${ext}`;

        const msgId = await sendZaloImage(
          userId,
          prodThreadId,
          imgBuffer,
          fileName,
          caption || "",
          isGrp2 || false
        );

        writeAuditLog({
          action: "CREATE",
          entity: "ZaloMessage",
          entityId: msgId || prodThreadId,
          userId,
          changes: { type: "sendProduct", threadId: prodThreadId, imageUrl, size: imgBuffer.length },
        }).catch(() => {});

        let thumbBase64: string | undefined;
        try {
          const thumb = await compressImageToThumb(imgBuffer);
          thumbBase64 = `data:image/jpeg;base64,${thumb.data.toString("base64")}`;
        } catch {
          // 썸네일 생성 실패 시 무시
        }

        return NextResponse.json({ success: true, msgId, thumbUrl: thumbBase64 });
      }
      case "forward": {
        const { messageId: fwdMsgId, attachmentIndex, targetUserId, isGroup: fwdIsGroup } = body;
        if (!fwdMsgId || !targetUserId) {
          return NextResponse.json(
            { success: false, error: "messageId and targetUserId required" },
            { status: 400 }
          );
        }

        // DB에서 첨부파일 바이너리 조회 (zalo-db-store 계층 사용)
        const attData = await getMessageAttachmentData(userId, fwdMsgId, attachmentIndex ?? 0);
        if (!attData) {
          return NextResponse.json(
            { success: false, error: "첨부파일 데이터를 찾을 수 없습니다" },
            { status: 404 }
          );
        }

        const ext = attData.type === "image" ? "jpg" : attData.fileName?.split(".").pop() || "bin";
        const fwdFileName = attData.fileName || `forward_${Date.now()}.${ext}`;

        const sentMsgId = await sendZaloImage(
          userId,
          targetUserId,
          attData.data,
          fwdFileName,
          "",
          fwdIsGroup || false
        );

        writeAuditLog({
          action: "CREATE",
          entity: "ZaloMessage",
          entityId: sentMsgId || fwdMsgId,
          userId,
          changes: { type: "forward", sourceMsgId: fwdMsgId, targetUserId },
        }).catch(() => {});

        return NextResponse.json({ success: true, msgId: sentMsgId });
      }
      case "setAlias": {
        const { userId: targetId, alias } = body;
        if (!targetId) {
          return NextResponse.json({ success: false, error: "userId required" }, { status: 400 });
        }
        if (alias && alias.trim()) {
          await changeAlias(userId, targetId, alias.trim());
        } else {
          await removeAlias(userId, targetId);
        }
        writeAuditLog({
          action: "UPDATE",
          entity: "ZaloThread",
          entityId: targetId,
          userId,
          changes: { type: "setAlias", alias: alias?.trim() || null },
        }).catch(() => {});
        return NextResponse.json({ success: true });
      }
      default:
        return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    return zaloErrorResponse(error);
  }
}

export const GET = withRequestLog(_GET);
export const POST = withRequestLog(_POST);
