// /api/partner/receivables/payment-notice — 파트너 입금 통보 (여행사 포털 B)
//
// POST: 파트너가 청구서/채권 입금 후 "입금했어요" 신호. 게스트 GUEST_PAYMENT_NOTICE 미러.
//   ★ 상태 미변경 — 운영자가 은행 대조 후 수동 확정(자동 정산 아님). AuditLog만 적재.
//   보안: requireAuth + Role=PARTNER + 본인 partnerId 소유 검증(IDOR) + assertSameOrigin + rate-limit.
//   누수: 응답·기록에 신용한도·마진·KRW 없음 — 본인 채권/청구서 식별자와 통보 금액(파트너 자진 신고)만.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { getPartnerForUser } from "@/lib/partner-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { assertSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const NOTICE_LIMIT = { max: 20, windowMs: 10 * 60_000 };

const bodySchema = z
  .object({
    invoiceId: z.string().min(1).optional(),
    receivableId: z.string().min(1).optional(),
    // 파트너 자진 신고 금액(VND, 정수 문자열). 선택 — 미입력 시 "전액 입금" 의미로 통보만.
    amountVnd: z
      .string()
      .regex(/^\d{1,15}$/u, "금액은 동(VND) 정수여야 합니다")
      .optional(),
    depositorName: z.string().trim().max(100).optional(),
  })
  // 정확히 하나의 대상(청구서 또는 채권)만 허용
  .refine(
    (b) => Boolean(b.invoiceId) !== Boolean(b.receivableId),
    "invoiceId 또는 receivableId 중 정확히 하나가 필요합니다"
  );

export async function POST(req: Request) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  if (g.session.user.role !== "PARTNER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // 교차출처 위조 차단
  const csrf = await assertSameOrigin(req, "partner-payment-notice");
  if (csrf) return csrf;

  // rate-limit(사용자·IP) — 폭주 방어
  const ip = clientIp(req.headers);
  const userOk = checkRateLimit(`partner-pn:user:${g.session.user.id}`, NOTICE_LIMIT).allowed;
  const ipOk = ip ? checkRateLimit(`partner-pn:ip:${ip}`, NOTICE_LIMIT).allowed : true;
  if (!userOk || !ipOk) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const partner = await getPartnerForUser(g.session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const { invoiceId, receivableId, amountVnd, depositorName } = parsed.data;

  // ★ IDOR 차단: 대상이 본인 partnerId 소속인지 확인(아니면 404).
  let entity: "PartnerInvoice" | "PartnerReceivable";
  let entityId: string;
  if (invoiceId) {
    const inv = await prisma.partnerInvoice.findFirst({
      where: { id: invoiceId, partnerId: partner.id },
      select: { id: true },
    });
    if (!inv) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    entity = "PartnerInvoice";
    entityId = inv.id;
  } else {
    const r = await prisma.partnerReceivable.findFirst({
      where: { id: receivableId, partnerId: partner.id },
      select: { id: true },
    });
    if (!r) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    entity = "PartnerReceivable";
    entityId = r.id;
  }

  // 상태 미변경 — 운영자 수동 확정 대조용 신호만. changes 형식({field:{new}})은 활동로그 리더와 호환.
  await writeAuditLog({
    userId: g.session.user.id,
    action: "PARTNER_PAYMENT_NOTICE",
    entity,
    entityId,
    changes: {
      amountVnd: { new: amountVnd ?? null },
      depositorName: { new: depositorName?.trim() || null },
      notedAt: { new: new Date().toISOString() },
    },
  });

  return NextResponse.json({ ok: true });
}
