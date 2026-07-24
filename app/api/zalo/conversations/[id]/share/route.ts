// POST /api/zalo/conversations/[id]/share — ADMIN 채팅 공유 발송 (ADR-0009 S1~S4)
//
// 4종 공유(discriminated union): PHOTO | PROPOSAL | VILLA | SETTLEMENT.
//  - PHOTO(S1): multipart 이미지 업로드 → R2/디스크 저장 → 같은 Buffer로 zca-js 이미지 발송. 양쪽 허용.
//  - PROPOSAL(S2): 고객(CUSTOMER) 전용 — /p/[token] 공개 링크 텍스트 발송.
//  - VILLA(S3): 누수 분기 핵심 — SUPPLIER=원가만/CUSTOMER=판매가만(select 화이트리스트). 마진 양쪽 0.
//  - SETTLEMENT(S4): 공급자(SUPPLIER) 전용 — 본인(supplierId=conversation.userId) 정산 요약.
//
// ★ 누수 차단(D2/D4):
//   - 마진(marginType/marginValue)은 어떤 공유 쿼리에도 select 안 함.
//   - 공급자 경로엔 salePrice*/KRW를, 고객 경로엔 supplierCostVnd를 **쿼리에서 조회하지 않는다**.
//   - quoteStay/StayQuote(원가+판매가 동시 객체)를 본문 생성에 직접 쓰지 않는다.
//   - 빌라/정산 대상 소유 검증(임의 id 차단). 상대 타입 게이트는 D2 매트릭스로 서버 이중 가드.
//
// 권한(첫 줄): 미인증 401 / 비ADMIN 403 / 타대화·미존재 404. 본인(ownerAdminId) 대화만.
// 발송: getApiForAdmin → zca-js. 봇 미연결·실패는 status=FAILED 기록(500 금지, 영속은 200).
import { NextResponse } from "next/server";
import { z } from "zod";
import { ThreadType } from "zca-js";
import {
  Currency,
  Prisma,
  ProposalStatus,
  ZaloCounterpartyType,
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
  ZaloThreadType,
  type ZaloTranslateMode,
} from "@prisma/client";
import { ensureGuestLinkToken } from "@/lib/guest-link-token";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import {
  saveFile,
  isAllowedImageMime,
  saveAttachmentFile,
  validateAttachment,
  MAX_ATTACHMENT_SIZE,
} from "@/lib/storage";
import {
  sendChatMessageAsAdmin,
  sendChatImageAsAdmin,
  sendChatFileAsAdmin,
} from "@/lib/zalo-runtime";
import { translateText, previewTargetForMode, GeminiNotConfiguredError } from "@/lib/gemini";
import {
  isCostSideType,
  isSellSideType,
  tierForCounterparty,
} from "@/lib/zalo-counterparty";
import { loadVillaShareImage } from "@/lib/zalo-share-image";
import {
  buildVillaShareTextForSupplier,
  buildVillaShareTextForCustomer,
  buildVillaShareBriefWithBlog,
  buildProposalShareText,
  buildSettlementShareText,
  buildGuestLinkShareText,
  type GuestLinkKind,
  type VillaShareBase,
} from "@/lib/zalo-share";
import { pickLowestSalePrice } from "@/lib/pricing";
import { getPublicVillasByIds } from "@/lib/seo/public-villa";
import { absoluteUrl } from "@/lib/seo/base-url";
import { blogPaths } from "@/lib/seo/routes";
import koMessages from "@/messages/ko.json";
import viMessages from "@/messages/vi.json";
import { isOperator, canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB (uploads 라우트와 동일)

// JSON 공유(제안/빌라/정산) body — discriminated union.
const jsonShareSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PROPOSAL"), proposalId: z.string().min(1) }),
  z.object({ type: z.literal("VILLA"), villaId: z.string().min(1) }),
  z.object({
    type: z.literal("SETTLEMENT"),
    settlementId: z.string().min(1).optional(),
    yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  }),
  // (C) 게스트 링크 — CUSTOMER(투숙객) 1:1 대화 전용. 예약의 /g 링크(체크인·부가서비스·영수증) 발송.
  z.object({
    type: z.literal("GUEST_LINK"),
    kind: z.enum(["checkin", "options", "receipt"]),
    bookingId: z.string().min(1),
  }),
]);

interface ConversationCtx {
  id: string;
  zaloUserId: string;
  userId: string | null;
  counterpartyType: ZaloCounterpartyType;
  // ADR-0010 S4 — 그룹 대화면 zaloUserId 슬롯에 그룹 id 저장. 발송 시 ThreadType.Group 필요.
  threadType: ZaloThreadType;
  // (C) 게스트 링크 안내문 언어 파생용(OFF→ko, VI→vi, EN→en).
  translateMode: ZaloTranslateMode;
}

/**
 * 발송용 zca-js ThreadType 파생 — 그룹 대화(GROUP)면 Group, 1:1은 User.
 * messages/route.ts와 동일 패턴. 미전달 시 zca-js 기본 User라 그룹 id가 낯선 1:1로 오발송됨(P0).
 */
function sendThreadTypeOf(conv: ConversationCtx): ThreadType {
  return conv.threadType === ZaloThreadType.GROUP ? ThreadType.Group : ThreadType.User;
}

/** 공유 결과를 ZaloMessage(OUTBOUND·CHAT)로 영속 + lastMessageAt + AuditLog. 본문/금액 미기록. */
async function persistShare(
  conversationId: string,
  adminUserId: string,
  msgType: string,
  text: string | null,
  attachmentUrls: string[],
  send: { ok: boolean; messageId?: string | null; error?: string },
  sharedEntity: { type: string; id: string },
  // 사진/파일 캡션 번역문(수신자에게 발송된 vi/en). text=원문(ko) 보존 — 사진 버블이 원문+번역 자막 표시.
  captionTranslated: string | null = null
) {
  const status = send.ok ? ZaloMessageStatus.SENT : ZaloMessageStatus.FAILED;
  const zaloMsgId = send.ok ? (send.messageId ?? null) : null;
  const now = new Date();
  const messageSelect = { id: true, status: true, createdAt: true } as const;
  // ★셀프에코 레이스(P2002) — messages/route.ts와 동일. 워커 리스너가 내 발신 에코를 먼저 저장하면
  //   같은 (conversationId, zaloMsgId) create가 터져 500 → 실제로는 전달됐는데 "전송 실패"로 보인다.
  //   → 에코 행을 내 발신 기록(원문·캡션 번역·R2 URL·sentBy)으로 보강하고 정상 응답한다.
  const echoPatch = {
    source: ZaloMessageSource.CHAT,
    msgType,
    text,
    captionTranslated,
    attachmentUrls,
    status,
    error: send.ok ? null : (send.error ?? null),
    sentBy: adminUserId,
  };
  const persist = (patchEcho: boolean) =>
    prisma.$transaction(async (tx) => {
      const created =
        patchEcho && zaloMsgId
          ? await tx.zaloMessage.update({
              where: { conversationId_zaloMsgId: { conversationId, zaloMsgId } },
              data: echoPatch,
              select: messageSelect,
            })
          : await tx.zaloMessage.create({
              data: {
                conversationId,
                direction: ZaloMessageDirection.OUTBOUND,
                source: ZaloMessageSource.CHAT,
                msgType,
                text,
                captionTranslated,
                attachmentUrls,
                zaloMsgId,
                status,
                error: send.ok ? null : (send.error ?? null),
                sentBy: adminUserId,
              },
              select: messageSelect,
            });
      await tx.zaloConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: now,
          // 인박스 미리보기 비정규화(perf) — 공유 카드 본문·타입 캐시.
          lastMessageText: text,
          lastMessageType: msgType,
        },
      });
      // AuditLog — 본문·금액·credential 미기록 (D4.5)
      await writeAuditLog({
        userId: adminUserId,
        action: patchEcho ? "UPDATE" : "CREATE",
        entity: "ZaloMessage",
        entityId: created.id,
        changes: {
          direction: { new: "OUTBOUND" },
          source: { new: "CHAT" },
          msgType: { new: msgType },
          status: { new: status },
          sharedEntity: { new: `${sharedEntity.type}:${sharedEntity.id}` },
          ...(patchEcho ? { echoReconciled: { new: "true" } } : {}),
        },
        db: tx,
      });
      return created;
    });

  let message: Awaited<ReturnType<typeof persist>>;
  try {
    message = await persist(false);
  } catch (err) {
    if (zaloMsgId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      message = await persist(true);
    } else {
      throw err;
    }
  }
  return NextResponse.json({
    id: message.id,
    status: message.status,
    error: send.ok ? null : (send.error ?? null),
    createdAt: message.createdAt.toISOString(),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄)
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const adminUserId = session.user.id;
  const { id: conversationId } = await params;

  // 소유 검증 — 본인(ownerAdminId) 대화만 (ADR-0007 D3.4). 타인/미존재는 404.
  const conversation = await prisma.zaloConversation.findFirst({
    where: { id: conversationId, ownerAdminId: adminUserId },
    select: {
      id: true,
      zaloUserId: true,
      userId: true,
      counterpartyType: true,
      threadType: true,
      translateMode: true,
    },
  });
  if (!conversation) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") ?? "";

  // ── S1 사진 / 파일 첨부 — multipart ──────────────────────────
  // type=FILE(또는 비이미지 MIME)는 일반 파일 경로, 그 외는 사진(이미지) 경로.
  if (contentType.includes("multipart/form-data")) {
    return handleMultipart(req, conversation, adminUserId);
  }

  // ── S2/S3/S4 — JSON ──────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = jsonShareSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;

  // [S-RBAC-3] 판매가·정산이 본문에 실리는 공유는 재무 권한 필요(STAFF 차단).
  // STAFF는 공급자(원가측) 빌라 공유·사진/파일만 가능. 마진 비공개 원칙을 share 경로까지 확장.
  // PROPOSAL=판매가 링크, SETTLEMENT=정산금액, VILLA 고객분기=판매가 → canViewFinance 게이트.
  if (body.type === "PROPOSAL") {
    if (!canViewFinance(session.user.role)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    return handleProposal(conversation, adminUserId, body.proposalId, req);
  }
  if (body.type === "VILLA") {
    if (
      isSellSideType(conversation.counterpartyType) &&
      !canViewFinance(session.user.role)
    ) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    return handleVilla(conversation, adminUserId, body.villaId);
  }
  if (body.type === "GUEST_LINK") {
    // 게스트 링크는 금액 없음(무금액 게이트) — canViewFinance 불필요(STAFF 허용, 웹챗 send-link와 동일).
    return handleGuestLink(conversation, adminUserId, body.kind, body.bookingId, req);
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return handleSettlement(conversation, adminUserId, body);
}

// ===================== S1 사진 / 파일 (multipart) =====================

/**
 * multipart 분기 — 이미지(MIME 화이트리스트)는 photo 경로(EXIF 회전·이미지 발송),
 * 그 외(문서 등)는 file 경로(위험 확장자 차단·크기 상한 20MB·일반 첨부 발송).
 * form field `type`이 "FILE"이면 강제로 파일 경로(이미지여도 photo로 안 보냄 — 명시 우선).
 * 누수 무관(파일은 ADMIN 업로드) — 양쪽 대화(공급자·고객·미분류) 모두 허용.
 */
async function handleMultipart(
  req: Request,
  conv: ConversationCtx,
  adminUserId: string
): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const file = formData.get("file");
  const caption = formData.get("caption");
  const type = formData.get("type");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  }
  const captionText =
    typeof caption === "string" && caption.trim() ? caption.trim() : undefined;
  const isFileType = typeof type === "string" && type.toUpperCase() === "FILE";

  // 이미지면서 FILE 강제가 아니면 → photo 경로. 그 외 전부 → file 경로.
  if (!isFileType && isAllowedImageMime(file.type)) {
    return handlePhoto(file, conv, adminUserId, captionText);
  }
  return handleFile(file, conv, adminUserId, captionText);
}

/**
 * 사진/파일 캡션 발신 번역 (텍스트 메시지와 동일 규칙, ADR-0009 D7).
 * VI/EN 모드면 캡션을 번역해 상대에게 발송하고 원문(ko)은 기록용으로 보존한다.
 * OFF 모드면 원문 그대로. 번역 실패 시엔 원문(한국어) 오발송을 막기 위해 발송 중단(에러 응답).
 *   ok=false면 라우트가 그 response(503/502)를 그대로 반환한다.
 * outbound=상대에게 실제 발송할 캡션, translated=번역문(기록·사진 버블 자막). 캡션 없으면 undefined/null.
 */
async function resolveCaptionForSend(
  conv: ConversationCtx,
  captionText: string | undefined
): Promise<
  | { ok: true; outbound: string | undefined; translated: string | null }
  | { ok: false; response: NextResponse }
> {
  if (!captionText) return { ok: true, outbound: undefined, translated: null };
  const target = previewTargetForMode(conv.translateMode);
  if (!target) return { ok: true, outbound: captionText, translated: null };
  try {
    const tr = (await translateText(captionText, target)).trim();
    return { ok: true, outbound: tr || captionText, translated: tr || null };
  } catch (err) {
    if (err instanceof GeminiNotConfiguredError) {
      return {
        ok: false,
        response: NextResponse.json({ error: "TRANSLATE_NOT_CONFIGURED" }, { status: 503 }),
      };
    }
    return { ok: false, response: NextResponse.json({ error: "TRANSLATE_FAILED" }, { status: 502 }) };
  }
}

async function handlePhoto(
  file: File,
  conv: ConversationCtx,
  adminUserId: string,
  captionText: string | undefined
): Promise<NextResponse> {
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });
  }

  // 캡션 번역 — 번역 실패 시 원문 오발송 방지(저장·발송 전에 먼저 확정).
  const cap = await resolveCaptionForSend(conv, captionText);
  if (!cap.ok) return cap.response;

  const buffer = Buffer.from(await file.arrayBuffer());
  // 표시·증빙용 URL 확보(R2/디스크). 같은 Buffer로 zca-js 이미지 발송(URL 재다운로드 아님).
  const { url } = await saveFile(buffer, file.type, adminUserId);
  const fileName = url.split("/").pop() ?? `image-${Date.now()}.jpg`;

  const send = await sendChatImageAsAdmin(
    adminUserId,
    conv.zaloUserId,
    buffer,
    fileName,
    cap.outbound, // 상대에게는 번역된 캡션(OFF면 원문)
    sendThreadTypeOf(conv)
  );

  // text=원문 캡션(ko 기록), captionTranslated=발송 번역문 → 사진 버블이 원문+번역 자막 표시.
  return persistShare(
    conv.id,
    adminUserId,
    "photo",
    captionText ?? null,
    [url],
    send,
    { type: "photo", id: fileName },
    cap.translated
  );
}

/**
 * 일반 파일 첨부 발송 — 비이미지 문서 등. 위험 확장자 차단·크기 상한(20MB).
 * text엔 파일명(증빙·표시), attachmentUrls엔 저장 URL. msgType="file".
 */
async function handleFile(
  file: File,
  conv: ConversationCtx,
  adminUserId: string,
  captionText: string | undefined
): Promise<NextResponse> {
  const origName = file.name || "file";
  // 위험 확장자·확장자 누락·이미지(별도 경로)·크기 상한 검증.
  const valid = validateAttachment(origName, file.size);
  if (!valid.ok) {
    const status = valid.reason === "TOO_LARGE" ? 400 : 400;
    return NextResponse.json(
      { error: valid.reason, maxSize: MAX_ATTACHMENT_SIZE },
      { status }
    );
  }

  // 캡션 번역 — 파일 저장 전에 확정(번역 실패 시 원문 오발송·불필요 저장 방지).
  const cap = await resolveCaptionForSend(conv, captionText);
  if (!cap.ok) return cap.response;

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  // 저장(R2/디스크)은 예외 가능 — 던지면 라우트가 500으로 죽고 DB 기록도 0건이 된다(버그 A).
  // 저장 실패는 UPLOAD_FAILED(500)로 명시 반환 → FE가 fileError.generic 안내.
  let url: string;
  let displayName: string;
  try {
    const saved = await saveAttachmentFile(
      buffer,
      origName,
      valid.ext,
      mimeType,
      adminUserId
    );
    url = saved.url;
    displayName = saved.displayName;
  } catch (err) {
    console.error(
      "[share] 파일 저장 실패:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ error: "UPLOAD_FAILED" }, { status: 500 });
  }

  // 발송은 throw-safe(내부 try/catch로 {ok:false} 반환) — 봇 미연결·발송 실패도
  // 아래 persistShare에서 FAILED(200)로 기록된다(DB 0건 방지).
  const send = await sendChatFileAsAdmin(
    adminUserId,
    conv.zaloUserId,
    buffer,
    displayName as `${string}.${string}`,
    cap.outbound, // 상대에게는 번역된 캡션(OFF면 원문)
    sendThreadTypeOf(conv)
  );

  // 본문(text)은 원문 캡션(있으면)·없으면 파일명(다운로드 표시·증빙). captionTranslated=발송 번역문.
  return persistShare(
    conv.id,
    adminUserId,
    "file",
    captionText ?? displayName,
    [url],
    send,
    { type: "file", id: displayName },
    cap.translated
  );
}

// ===================== S2 제안서 (고객 전용) =====================

async function handleProposal(
  conv: ConversationCtx,
  adminUserId: string,
  proposalId: string,
  req: Request
): Promise<NextResponse> {
  // 상대 타입 게이트 — 제안은 판매가측 전용(/p/[token] 판매가 페이지). 원가측·UNKNOWN 거부 (R2-2).
  if (!isSellSideType(conv.counterpartyType)) {
    return NextResponse.json({ error: "COUNTERPARTY_NOT_ALLOWED" }, { status: 403 });
  }

  // 제안 조회 — 빌라 요약+판매가(totalKrw/totalVnd)만. 원가·마진 미조회(고객 경로, D4.1).
  // ACTIVE + 미만료 검증(D4.2, 리스크 ⑥).
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      token: true,
      clientName: true,
      status: true,
      expiresAt: true,
      saleCurrency: true,
      conversationId: true,
      items: {
        select: {
          checkIn: true,
          checkOut: true,
          totalKrw: true,
          totalVnd: true,
          totalUsd: true,
          villa: { select: { name: true, nameVi: true, bedrooms: true, hasPool: true } },
        },
      },
    },
  });
  if (!proposal) {
    return NextResponse.json({ error: "PROPOSAL_NOT_FOUND" }, { status: 404 });
  }
  if (proposal.status !== ProposalStatus.ACTIVE || proposal.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "PROPOSAL_NOT_ACTIVE" }, { status: 409 });
  }

  // 대화 귀속 bind(계약 H, Q3) — 오발송 차단. 이미 다른 대화에 귀속됐으면 공유 중단(409).
  //   미귀속이면 이 대화 id로 심고(bind + AuditLog 원자적), 같은 대화면 통과.
  if (proposal.conversationId && proposal.conversationId !== conv.id) {
    return NextResponse.json({ error: "PROPOSAL_BOUND_OTHER_CONVERSATION" }, { status: 409 });
  }
  if (!proposal.conversationId) {
    await prisma.$transaction(async (tx) => {
      await tx.proposal.update({
        where: { id: proposal.id },
        data: { conversationId: conv.id },
      });
      await writeAuditLog({
        userId: adminUserId,
        action: "UPDATE",
        entity: "Proposal",
        entityId: proposal.id,
        changes: { conversationId: { old: null, new: conv.id } },
        db: tx,
      });
    });
  }

  const baseUrl = resolveBaseUrl(req);
  const text = buildProposalShareText(
    {
      token: proposal.token,
      clientName: proposal.clientName,
      expiresAt: proposal.expiresAt,
      saleCurrency: proposal.saleCurrency,
      items: proposal.items.map((it) => ({
        villaName: it.villa.name,
        villaNameVi: it.villa.nameVi,
        bedrooms: it.villa.bedrooms,
        hasPool: it.villa.hasPool,
        checkIn: it.checkIn,
        checkOut: it.checkOut,
        totalKrw: it.totalKrw,
        totalVnd: it.totalVnd,
        totalUsd: it.totalUsd,
      })),
    },
    baseUrl
  );
  const send = await sendChatMessageAsAdmin(
    adminUserId,
    conv.zaloUserId,
    text,
    sendThreadTypeOf(conv)
  );
  return persistShare(conv.id, adminUserId, "proposal_share", text, [], send, {
    type: "proposal",
    id: proposal.id,
  });
}

// ===================== S3 빌라 (양쪽, 누수 분기) =====================

async function handleVilla(
  conv: ConversationCtx,
  adminUserId: string,
  villaId: string
): Promise<NextResponse> {
  // 상대 타입 게이트 — UNKNOWN은 어느 금액을 보낼지 결정 불가 → 잠금 (R2-2).
  // 원가측=원가 경로, 판매가측=판매가 경로. 그 외(UNKNOWN)는 거부.
  if (!isCostSideType(conv.counterpartyType) && !isSellSideType(conv.counterpartyType)) {
    return NextResponse.json({ error: "COUNTERPARTY_NOT_ALLOWED" }, { status: 403 });
  }

  // 공통 빌라 메타(금액 무관). amenities는 라벨용 itemKey/customLabel만.
  const base = {
    name: true,
    nameVi: true,
    complex: true,
    bedrooms: true,
    bathrooms: true,
    maxGuests: true,
    hasPool: true,
    breakfastAvailable: true,
    supplierId: true,
    status: true,
    isSellable: true,
    // #2b: 미니바는 회사표준(MinibarItem) — 공급자·고객 공유 명칭에서 제외(공급자 미관여 원칙, 전환기 명칭 누수 차단).
    amenities: {
      where: { category: { not: "MINIBAR" } },
      // customLabelKo = custom 라벨의 ko 저장형 번역. 판매측(ko) 공유는 customLabelKo ?? customLabel.
      select: { itemKey: true, customLabel: true, customLabelKo: true },
    },
    // 대표 사진 1장(sortOrder 최상단 — 목록 썸네일과 동일 규칙) — 이미지+캡션 발송용. 금액 무관.
    photos: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { url: true } },
  } as const;

  if (isCostSideType(conv.counterpartyType)) {
    // 원가측(공급자) 경로 — ratePeriods는 supplierCostVnd만 SELECT. salePrice*/margin 미조회 (D4.1, ADR-0014).
    const villa = await prisma.villa.findUnique({
      where: { id: villaId },
      select: {
        ...base,
        ratePeriods: {
          select: {
            season: true,
            isBase: true,
            startDate: true,
            endDate: true,
            label: true,
            supplierCostVnd: true,
          },
        },
      },
    });
    if (!villa) {
      return NextResponse.json({ error: "VILLA_NOT_FOUND" }, { status: 404 });
    }
    // 대상 검증(D4.2) — 공급자 대화면 그 공급자(conversation.userId) 소유 빌라만.
    //   userId=null(미매칭 공급자)이면 소유 특정 불가 → 거부(원가 오발송 방지).
    if (!conv.userId || villa.supplierId !== conv.userId) {
      return NextResponse.json({ error: "VILLA_NOT_OWNED" }, { status: 403 });
    }
    // 전체 기간 나열(기본 먼저·시작일 순) — 받는 쪽이 "언제 원가인지" 알도록 기간 병기.
    const text = buildVillaShareTextForSupplier(toShareBase(villa, "vi"), villa.ratePeriods);
    return sendVillaShare(conv, adminUserId, text, villa.photos[0]?.url ?? null, villa.name);
  }

  // 판매가측(고객·여행사·랜드사) 경로 — ratePeriods는 salePrice*/consumerSalePrice*만 SELECT.
  // supplierCostVnd/margin 미조회 (D4.1, ADR-0014·ADR-0031). 본문 통화는 항상 VND(2026-07-24).
  const villa = await prisma.villa.findUnique({
    where: { id: villaId },
    select: {
      ...base,
      ratePeriods: {
        select: {
          season: true,
          isBase: true,
          startDate: true,
          endDate: true,
          label: true,
          salePriceVnd: true,
          salePriceKrw: true,
          // ADR-0031 소비자 직판가 — CONSUMER 계층(CUSTOMER)에서 참조. NET(여행사·랜드사)에선 미사용.
          consumerSalePriceVnd: true,
          consumerSalePriceKrw: true,
        },
      },
    },
  });
  if (!villa) {
    return NextResponse.json({ error: "VILLA_NOT_FOUND" }, { status: 404 });
  }
  // 대상 검증(D4.2) — 고객에게는 ACTIVE+isSellable 빌라만(미검수·미운영 재고 노출 차단).
  if (villa.status !== "ACTIVE" || !villa.isSellable) {
    return NextResponse.json({ error: "VILLA_NOT_SELLABLE" }, { status: 403 });
  }
  // ★통화 — 빌라 공유는 분류 무관 항상 VND(2026-07-24). CUSTOMER도 KRW→VND로 통일.
  //   (제안 공유(handleProposal) 통화는 proposal.saleCurrency 그대로 — 여기서 건드리지 않음.)
  const saleCurrency = Currency.VND;
  // ★계층(ADR-0031) — CUSTOMER=소비자가(CONSUMER), 여행사·랜드사=도매가(NET). 통화와 별개 축.
  const tier = tierForCounterparty(conv.counterpartyType);
  // 상세 폴백 빌더는 CustomerRateView(salePrice*)만 받으므로, 계층 유효가(consumer??net)를
  //   salePrice* 자리에 매핑해 넘긴다(빌더 불변 — 입력값만 계층가). consumerSalePrice* 컬럼은 빌더로 넘기지 않음.
  const tierRates = villa.ratePeriods.map((r) => ({
    season: r.season,
    isBase: r.isBase,
    startDate: r.startDate,
    endDate: r.endDate,
    label: r.label,
    salePriceVnd: tier === "CONSUMER" ? (r.consumerSalePriceVnd ?? r.salePriceVnd) : r.salePriceVnd,
    salePriceKrw: tier === "CONSUMER" ? (r.consumerSalePriceKrw ?? r.salePriceKrw) : r.salePriceKrw,
  }));

  // Q2(계약 F) — 공개 게이트 통과한 빌라 상세 페이지(/blog/villa/[slug], 상담 CTA 있음)가 있으면
  //   간단정보 + 대표 "부터" 가격 + 그 페이지 링크로 발송. 없으면 기존 상세 요율 나열(폴백).
  //   getPublicVillasByIds는 공개 화이트리스트 관문(판매가·원가·마진 미조회) — 누수 불변식 유지.
  const [publicVilla] = await getPublicVillasByIds([villaId]);
  if (publicVilla) {
    const from = pickLowestSalePrice(villa.ratePeriods, false, tier);
    const briefText = buildVillaShareBriefWithBlog(toShareBase(villa, "ko"), from, saleCurrency, {
      url: absoluteUrl(blogPaths.villa(publicVilla.slug)),
      title: publicVilla.publicLabel, // 공개 상세 페이지 H1 라벨(지역·특징 조합, 실명 아님)
    });
    return sendVillaShare(conv, adminUserId, briefText, villa.photos[0]?.url ?? null, villa.name);
  }

  // 폴백 — 전체 기간 나열(기본 먼저·시작일 순). 받는 쪽이 "언제 가격인지" 알도록 기간 병기.
  const text = buildVillaShareTextForCustomer(toShareBase(villa, "ko"), tierRates, saleCurrency);
  return sendVillaShare(conv, adminUserId, text, villa.photos[0]?.url ?? null, villa.name);
}

/**
 * 빌라 공유 발송 공통 꼬리 — 대표 사진이 있으면 이미지+캡션(본문) 1건으로,
 * 사진 미보유·로드 실패·이미지 발송 실패면 기존 텍스트 발송으로 폴백(공유 실패 금지, T-villa-share-photo).
 * 사진은 공개 빌라 사진(금액 무관)이라 공급자/고객 어느 쪽이든 노출 문제 없음.
 */
async function sendVillaShare(
  conv: ConversationCtx,
  adminUserId: string,
  text: string,
  photoUrl: string | null,
  villaName: string
): Promise<NextResponse> {
  const sendThreadType = sendThreadTypeOf(conv);
  const image = photoUrl ? await loadVillaShareImage(photoUrl) : null;
  let send = image
    ? await sendChatImageAsAdmin(adminUserId, conv.zaloUserId, image.buffer, image.fileName, text, sendThreadType)
    : await sendChatMessageAsAdmin(adminUserId, conv.zaloUserId, text, sendThreadType);
  let sentWithPhoto = image != null;
  if (image && !send.ok) {
    // 이미지 발송 실패(포맷·용량 등) — 텍스트만으로 1회 재시도. 봇 미연결이면 이것도 실패(기존 FAILED 기록과 동일).
    send = await sendChatMessageAsAdmin(adminUserId, conv.zaloUserId, text, sendThreadType);
    sentWithPhoto = false;
  }
  return persistShare(
    conv.id,
    adminUserId,
    "villa_share",
    text,
    sentWithPhoto && photoUrl ? [photoUrl] : [],
    send,
    { type: "villa", id: villaName }
  );
}

// ===================== S4 정산 (공급자 전용) =====================

async function handleSettlement(
  conv: ConversationCtx,
  adminUserId: string,
  body: { settlementId?: string; yearMonth?: string }
): Promise<NextResponse> {
  // 상대 타입 게이트 — 정산은 원가측(공급자)↔운영자. 판매가측·UNKNOWN 거부 (R2-2).
  if (!isCostSideType(conv.counterpartyType)) {
    return NextResponse.json({ error: "COUNTERPARTY_NOT_ALLOWED" }, { status: 403 });
  }
  // 본인 특정 불가(미매칭 공급자)면 정산 공유 불가 (D4.2, 리스크 ④).
  if (!conv.userId) {
    return NextResponse.json({ error: "SUPPLIER_NOT_LINKED" }, { status: 403 });
  }
  if (!body.settlementId && !body.yearMonth) {
    return NextResponse.json({ error: "SETTLEMENT_REF_REQUIRED" }, { status: 400 });
  }

  // 정산 조회 — totalVnd(원가 기반 VND)만. 판매가·마진 없음(스키마상 정산엔 부재).
  // ★ 반드시 본인(supplierId=conversation.userId)만 — 타 공급자 정산 누수 차단.
  const settlement = body.settlementId
    ? await prisma.settlement.findFirst({
        where: { id: body.settlementId, supplierId: conv.userId },
        select: {
          id: true,
          yearMonth: true,
          totalVnd: true,
          status: true,
          _count: { select: { items: true } },
        },
      })
    : await prisma.settlement.findFirst({
        where: { supplierId: conv.userId, yearMonth: body.yearMonth },
        select: {
          id: true,
          yearMonth: true,
          totalVnd: true,
          status: true,
          _count: { select: { items: true } },
        },
      });
  if (!settlement) {
    // 존재하지 않거나 타 공급자 정산(where supplierId 불일치로 0건) → 404 (소유 누설 안 함)
    return NextResponse.json({ error: "SETTLEMENT_NOT_FOUND" }, { status: 404 });
  }

  const text = buildSettlementShareText({
    yearMonth: settlement.yearMonth,
    totalVnd: settlement.totalVnd,
    itemCount: settlement._count.items,
    status: settlement.status,
  });
  const send = await sendChatMessageAsAdmin(
    adminUserId,
    conv.zaloUserId,
    text,
    sendThreadTypeOf(conv)
  );
  return persistShare(conv.id, adminUserId, "settlement_share", text, [], send, {
    type: "settlement",
    id: settlement.id,
  });
}

// ===================== GUEST_LINK 게스트 링크 (CUSTOMER 전용) =====================

/** kind → /g 경로 suffix (send-link 라우트와 동일 규칙). */
function guestKindPathSuffix(kind: GuestLinkKind): string {
  return kind === "options" ? "/options" : kind === "receipt" ? "/receipt" : "";
}

/** CUSTOMER 대화 번역모드 → 안내문 언어(OFF→ko 한국 직접고객 기본, VI→vi, EN→en). 5언어 밖은 빌더가 en 폴백. */
function localeForCustomer(mode: ZaloTranslateMode): string {
  return mode === "VI" ? "vi" : mode === "EN" ? "en" : "ko";
}

/**
 * 게스트 링크 공유 — 투숙객(CUSTOMER) 1:1 대화에서만. /g 체크인·부가서비스·영수증 링크 발송.
 *  게이트(호출부 진입 전 재확인): counterpartyType=CUSTOMER + 1:1(GROUP 아님). 아니면 403.
 *  예약 존재·영수증 게이트(체크아웃 완료) 검증 — 금액 필드는 조회하지 않는다(누수 불가·안내문뿐).
 *  토큰: 활성 재사용/없으면 발급(ensureGuestLinkToken — 기전달 QR·링크 불파괴). 실패=FAILED(200 영속).
 */
async function handleGuestLink(
  conv: ConversationCtx,
  adminUserId: string,
  kind: GuestLinkKind,
  bookingId: string,
  req: Request
): Promise<NextResponse> {
  // ★게이트 — 투숙객(CUSTOMER)만. 공급자·여행사·랜드사·UNKNOWN·IGNORED 거부(게스트 링크는 투숙객 대상).
  if (conv.counterpartyType !== ZaloCounterpartyType.CUSTOMER) {
    return NextResponse.json({ error: "COUNTERPARTY_NOT_ALLOWED" }, { status: 403 });
  }
  // ★그룹 대화 차단 — 1:1 CUSTOMER만(투숙객 개인 안내). 그룹엔 게스트 링크 미노출.
  if (conv.threadType === ZaloThreadType.GROUP) {
    return NextResponse.json({ error: "GROUP_NOT_ALLOWED" }, { status: 403 });
  }

  // 예약 로드 — 토큰 만료(checkOut) + 영수증 게이트(status·checkOutRecord)용. 금액 미조회.
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      checkOutRecord: { select: { id: true } },
    },
  });
  if (!booking) {
    return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
  }

  // 영수증은 체크아웃 완료 예약만(웹챗 send-link와 동일 가드: CHECKED_OUT && CheckOutRecord 존재).
  if (kind === "receipt") {
    const checkedOut = booking.status === "CHECKED_OUT" && booking.checkOutRecord != null;
    if (!checkedOut) {
      return NextResponse.json({ error: "not_checked_out" }, { status: 400 });
    }
  }

  // 토큰 확보(활성 재사용/발급) — 채널 독립 lib. URL: base + /g/<token>(+ /options | /receipt).
  const { token } = await ensureGuestLinkToken(booking.id);
  const baseUrl = resolveBaseUrl(req).replace(/\/$/, "");
  const url = `${baseUrl}/g/${token}${guestKindPathSuffix(kind)}`;

  // 안내문 — 대화 상대 언어 사전 번역(Gemini 미경유).
  const text = buildGuestLinkShareText(kind, localeForCustomer(conv.translateMode), url);
  const send = await sendChatMessageAsAdmin(
    adminUserId,
    conv.zaloUserId,
    text,
    sendThreadTypeOf(conv)
  );
  // sharedEntity에 kind 포함 → persistShare가 AuditLog에 "GUEST_LINK:<kind>:<bookingId>" 기록.
  return persistShare(conv.id, adminUserId, "guest_link_share", text, [], send, {
    type: `GUEST_LINK:${kind}`,
    id: booking.id,
  });
}

// ===================== 헬퍼 =====================

/** 빌라 select 결과 → 공유 빌더 입력(금액 무관 메타). amenity는 언어별 라벨로 변환. */
function toShareBase(
  villa: {
    name: string;
    nameVi: string | null;
    complex: string | null;
    bedrooms: number;
    bathrooms: number;
    maxGuests: number;
    hasPool: boolean;
    breakfastAvailable: boolean;
    amenities: { itemKey: string; customLabel: string | null; customLabelKo: string | null }[];
  },
  lang: "ko" | "vi"
): VillaShareBase {
  return {
    name: villa.name,
    nameVi: villa.nameVi,
    complex: villa.complex,
    bedrooms: villa.bedrooms,
    bathrooms: villa.bathrooms,
    maxGuests: villa.maxGuests,
    hasPool: villa.hasPool,
    breakfastAvailable: villa.breakfastAvailable,
    amenityLabels: villa.amenities.map((a) => amenityLabel(a, lang)),
  };
}

/** amenity itemKey → 표시 라벨. custom은 공급자 입력 라벨(ko는 저장형 번역 우선), 그 외 i18n 사전(없으면 itemKey). */
function amenityLabel(
  a: { itemKey: string; customLabel: string | null; customLabelKo: string | null },
  lang: "ko" | "vi"
): string {
  if (a.itemKey === "custom") {
    // 판매측(ko)엔 저장형 번역 우선, 미번역이면 vi 원문 폴백. vi 공유엔 원문 그대로.
    return (lang === "ko" ? a.customLabelKo ?? a.customLabel : a.customLabel) ?? "";
  }
  const dict = (lang === "vi" ? viMessages : koMessages) as {
    amenities?: { items?: Record<string, string> };
  };
  return dict.amenities?.items?.[a.itemKey] ?? a.itemKey;
}

/** 공개 링크 base URL — NEXTAUTH_URL 우선, 없으면 요청 origin. */
function resolveBaseUrl(req: Request): string {
  const env = process.env.NEXTAUTH_URL;
  if (env) return env;
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}
