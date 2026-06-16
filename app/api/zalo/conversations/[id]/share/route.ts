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
  Currency,
  ProposalStatus,
  ZaloCounterpartyType,
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
} from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { saveFile, isAllowedImageMime } from "@/lib/storage";
import { sendChatMessageAsAdmin, sendChatImageAsAdmin } from "@/lib/zalo-runtime";
import {
  buildVillaShareTextForSupplier,
  buildVillaShareTextForCustomer,
  buildProposalShareText,
  buildSettlementShareText,
  type VillaShareBase,
} from "@/lib/zalo-share";
import koMessages from "@/messages/ko.json";
import viMessages from "@/messages/vi.json";

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
      data: { lastMessageAt: now },
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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
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

  // ── S1 사진 — multipart ──────────────────────────────────────
  if (contentType.includes("multipart/form-data")) {
    return handlePhoto(req, conversation, adminUserId);
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

  if (body.type === "PROPOSAL") {
    return handleProposal(conversation, adminUserId, body.proposalId, req);
  }
  if (body.type === "VILLA") {
    return handleVilla(conversation, adminUserId, body.villaId);
  }
  return handleSettlement(conversation, adminUserId, body);
}

// ===================== S1 사진 =====================

async function handlePhoto(
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
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  }
  // MIME 화이트리스트 — svg/gif 등 위장 차단 (storage.ts MIME_EXT 재사용)
  if (!isAllowedImageMime(file.type)) {
    return NextResponse.json({ error: "INVALID_TYPE" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // 표시·증빙용 URL 확보(R2/디스크). 같은 Buffer로 zca-js 이미지 발송(URL 재다운로드 아님).
  const { url } = await saveFile(buffer, file.type, adminUserId);
  const fileName = url.split("/").pop() ?? `image-${Date.now()}.jpg`;
  const captionText = typeof caption === "string" && caption.trim() ? caption.trim() : undefined;

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

// ===================== S2 제안서 (고객 전용) =====================

async function handleProposal(
  conv: ConversationCtx,
  adminUserId: string,
  proposalId: string,
  req: Request
): Promise<NextResponse> {
  // 상대 타입 게이트 — 제안은 고객용 판매가 페이지. SUPPLIER/UNKNOWN 거부 (D2).
  if (conv.counterpartyType !== ZaloCounterpartyType.CUSTOMER) {
    return NextResponse.json({ error: "COUNTERPARTY_NOT_ALLOWED" }, { status: 403 });
  }

  // 제안 조회 — 금액 필드 미조회(링크만). ACTIVE + 미만료 검증(D4.2, 리스크 ⑥).
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { id: true, token: true, clientName: true, status: true, expiresAt: true },
  });
  if (!proposal) {
    return NextResponse.json({ error: "PROPOSAL_NOT_FOUND" }, { status: 404 });
  }
  if (proposal.status !== ProposalStatus.ACTIVE || proposal.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "PROPOSAL_NOT_ACTIVE" }, { status: 409 });
  }

  const baseUrl = resolveBaseUrl(req);
  const text = buildProposalShareText(
    { token: proposal.token, clientName: proposal.clientName, expiresAt: proposal.expiresAt },
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
  // 상대 타입 게이트 — UNKNOWN은 어느 금액을 보낼지 결정 불가 → 잠금 (D2).
  if (
    conv.counterpartyType !== ZaloCounterpartyType.SUPPLIER &&
    conv.counterpartyType !== ZaloCounterpartyType.CUSTOMER
  ) {
    return NextResponse.json({ error: "COUNTERPARTY_NOT_ALLOWED" }, { status: 403 });
  }

  // 공통 빌라 메타(금액 무관). amenities는 라벨용 itemKey/customLabel만.
  const base = {
    name: true,
    complex: true,
    bedrooms: true,
    bathrooms: true,
    maxGuests: true,
    hasPool: true,
    breakfastAvailable: true,
    supplierId: true,
    status: true,
    isSellable: true,
    amenities: { select: { itemKey: true, customLabel: true } },
  } as const;

  if (conv.counterpartyType === ZaloCounterpartyType.SUPPLIER) {
    // 공급자 경로 — rates는 supplierCostVnd만 SELECT. salePrice*/margin 미조회 (D4.1).
    const villa = await prisma.villa.findUnique({
      where: { id: villaId },
      select: {
        ...base,
        rates: { select: { season: true, supplierCostVnd: true } },
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
    const text = buildVillaShareTextForSupplier(
      toShareBase(villa, "vi"),
      villa.rates.map((r) => ({ season: r.season, supplierCostVnd: r.supplierCostVnd }))
    );
    const send = await sendChatMessageAsAdmin(adminUserId, conv.zaloUserId, text);
    return persistShare(conv.id, adminUserId, "villa_share", text, [], send, {
      type: "villa",
      id: villa.name,
    });
  }

  // 고객 경로 — rates는 salePriceVnd/salePriceKrw만 SELECT. supplierCostVnd/margin 미조회 (D4.1).
  const villa = await prisma.villa.findUnique({
    where: { id: villaId },
    select: {
      ...base,
      rates: { select: { season: true, salePriceVnd: true, salePriceKrw: true } },
    },
  });
  if (!villa) {
    return NextResponse.json({ error: "VILLA_NOT_FOUND" }, { status: 404 });
  }
  // 대상 검증(D4.2) — 고객에게는 ACTIVE+isSellable 빌라만(미검수·미운영 재고 노출 차단).
  if (villa.status !== "ACTIVE" || !villa.isSellable) {
    return NextResponse.json({ error: "VILLA_NOT_SELLABLE" }, { status: 403 });
  }
  // 통화 — 고객 맥락(여행사·랜드사=VND, 직접=KRW). counterpartyType만으론 채널 불명 →
  // Phase 1: 고객 대화 기본 KRW(직접 소비자). 채널 세분화는 Phase 2(대화↔Booking 링크).
  const saleCurrency = Currency.KRW;
  const text = buildVillaShareTextForCustomer(
    toShareBase(villa, "ko"),
    villa.rates.map((r) => ({
      season: r.season,
      salePriceVnd: r.salePriceVnd,
      salePriceKrw: r.salePriceKrw,
    })),
    saleCurrency
  );
  const send = await sendChatMessageAsAdmin(adminUserId, conv.zaloUserId, text);
  return persistShare(conv.id, adminUserId, "villa_share", text, [], send, {
    type: "villa",
    id: villa.name,
  });
}

// ===================== S4 정산 (공급자 전용) =====================

async function handleSettlement(
  conv: ConversationCtx,
  adminUserId: string,
  body: { settlementId?: string; yearMonth?: string }
): Promise<NextResponse> {
  // 상대 타입 게이트 — 정산은 공급자↔운영자. CUSTOMER/UNKNOWN 거부 (D2).
  if (conv.counterpartyType !== ZaloCounterpartyType.SUPPLIER) {
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
    complex: string | null;
    bedrooms: number;
    bathrooms: number;
    maxGuests: number;
    hasPool: boolean;
    breakfastAvailable: boolean;
    amenities: { itemKey: string; customLabel: string | null }[];
  },
  lang: "ko" | "vi"
): VillaShareBase {
  return {
    name: villa.name,
    complex: villa.complex,
    bedrooms: villa.bedrooms,
    bathrooms: villa.bathrooms,
    maxGuests: villa.maxGuests,
    hasPool: villa.hasPool,
    breakfastAvailable: villa.breakfastAvailable,
    amenityLabels: villa.amenities.map((a) => amenityLabel(a.itemKey, a.customLabel, lang)),
  };
}

/** amenity itemKey → 표시 라벨. custom은 공급자 입력 라벨, 그 외 i18n 사전(없으면 itemKey). */
function amenityLabel(itemKey: string, customLabel: string | null, lang: "ko" | "vi"): string {
  if (itemKey === "custom") return customLabel ?? "";
  const dict = (lang === "vi" ? viMessages : koMessages) as {
    amenities?: { items?: Record<string, string> };
  };
  return dict.amenities?.items?.[itemKey] ?? itemKey;
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
