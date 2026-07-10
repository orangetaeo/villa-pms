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
import {
  ProposalStatus,
  ZaloCounterpartyType,
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
} from "@prisma/client";
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
import {
  isCostSideType,
  isSellSideType,
  currencyForType,
} from "@/lib/zalo-counterparty";
import { loadVillaShareImage } from "@/lib/zalo-share-image";
import {
  buildVillaShareTextForSupplier,
  buildVillaShareTextForCustomer,
  buildProposalShareText,
  buildSettlementShareText,
  type VillaShareBase,
} from "@/lib/zalo-share";
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
]);

interface ConversationCtx {
  id: string;
  zaloUserId: string;
  userId: string | null;
  counterpartyType: ZaloCounterpartyType;
}

/** 공유 결과를 ZaloMessage(OUTBOUND·CHAT)로 영속 + lastMessageAt + AuditLog. 본문/금액 미기록. */
async function persistShare(
  conversationId: string,
  adminUserId: string,
  msgType: string,
  text: string | null,
  attachmentUrls: string[],
  send: { ok: boolean; messageId?: string | null; error?: string },
  sharedEntity: { type: string; id: string }
) {
  const status = send.ok ? ZaloMessageStatus.SENT : ZaloMessageStatus.FAILED;
  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.zaloMessage.create({
      data: {
        conversationId,
        direction: ZaloMessageDirection.OUTBOUND,
        source: ZaloMessageSource.CHAT,
        msgType,
        text,
        attachmentUrls,
        zaloMsgId: send.ok ? (send.messageId ?? null) : null,
        status,
        error: send.ok ? null : (send.error ?? null),
        sentBy: adminUserId,
      },
      select: { id: true, status: true, createdAt: true },
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
      action: "CREATE",
      entity: "ZaloMessage",
      entityId: created.id,
      changes: {
        direction: { new: "OUTBOUND" },
        source: { new: "CHAT" },
        msgType: { new: msgType },
        status: { new: status },
        sharedEntity: { new: `${sharedEntity.type}:${sharedEntity.id}` },
      },
      db: tx,
    });
    return created;
  });
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
    select: { id: true, zaloUserId: true, userId: true, counterpartyType: true },
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

async function handlePhoto(
  file: File,
  conv: ConversationCtx,
  adminUserId: string,
  captionText: string | undefined
): Promise<NextResponse> {
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // 표시·증빙용 URL 확보(R2/디스크). 같은 Buffer로 zca-js 이미지 발송(URL 재다운로드 아님).
  const { url } = await saveFile(buffer, file.type, adminUserId);
  const fileName = url.split("/").pop() ?? `image-${Date.now()}.jpg`;

  const send = await sendChatImageAsAdmin(
    adminUserId,
    conv.zaloUserId,
    buffer,
    fileName,
    captionText
  );

  return persistShare(
    conv.id,
    adminUserId,
    "photo",
    captionText ?? null,
    [url],
    send,
    { type: "photo", id: fileName }
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
    captionText
  );

  // 본문(text)은 파일명(다운로드 표시·증빙). 캡션이 있으면 캡션 우선.
  return persistShare(
    conv.id,
    adminUserId,
    "file",
    captionText ?? displayName,
    [url],
    send,
    { type: "file", id: displayName }
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
  const send = await sendChatMessageAsAdmin(adminUserId, conv.zaloUserId, text);
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

  // 판매가측(고객·여행사·랜드사) 경로 — ratePeriods는 salePriceVnd/salePriceKrw만 SELECT.
  // supplierCostVnd/margin 미조회 (D4.1, ADR-0014). 본문 통화는 currencyForType()로 분류별 결정.
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
  // 통화 — 분류값으로 결정(R2-3): CUSTOMER=KRW, TRAVEL_AGENCY/LAND_AGENCY=VND.
  const saleCurrency = currencyForType(conv.counterpartyType);
  // 전체 기간 나열(기본 먼저·시작일 순) — 받는 쪽이 "언제 가격인지" 알도록 기간 병기.
  const text = buildVillaShareTextForCustomer(toShareBase(villa, "ko"), villa.ratePeriods, saleCurrency);
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
  const image = photoUrl ? await loadVillaShareImage(photoUrl) : null;
  let send = image
    ? await sendChatImageAsAdmin(adminUserId, conv.zaloUserId, image.buffer, image.fileName, text)
    : await sendChatMessageAsAdmin(adminUserId, conv.zaloUserId, text);
  let sentWithPhoto = image != null;
  if (image && !send.ok) {
    // 이미지 발송 실패(포맷·용량 등) — 텍스트만으로 1회 재시도. 봇 미연결이면 이것도 실패(기존 FAILED 기록과 동일).
    send = await sendChatMessageAsAdmin(adminUserId, conv.zaloUserId, text);
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
  const send = await sendChatMessageAsAdmin(adminUserId, conv.zaloUserId, text);
  return persistShare(conv.id, adminUserId, "settlement_share", text, [], send, {
    type: "settlement",
    id: settlement.id,
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
