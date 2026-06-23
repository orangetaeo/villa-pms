// GET/POST /api/bookings/[id]/services — 예약 부가서비스 목록·생성 (T7.1, Phase 2)
// 마진 비공개(절대 규칙): 원가·판매가·마진 노출 → ADMIN 전용. 첫 줄 role 검사.
import { auth } from "@/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { serializeBigInt } from "@/lib/serialize";
import { getFxVndPerKrw } from "@/lib/pricing";
import { parseUtcDateOnly } from "@/lib/date-vn";
import {
  validateServiceOrderInput,
  computeServiceMarginKrw,
  type ServiceOrderInput,
} from "@/lib/service-order";
import type { ServiceType } from "@prisma/client";
import { canSetPrice } from "@/lib/permissions";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) {
    return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!canSetPrice(session.user.role)) {
    return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { userId: session.user.id };
}

const postSchema = z.object({
  type: z.string(),
  costVnd: z.union([z.string(), z.number()]), // BigInt(VND 동) — 문자열 권장
  priceKrw: z.number().int(),
  serviceDate: z.string().nullish(),
  vendorName: z.string().nullish(),
  note: z.string().nullish(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, fxVndPerKrw: true },
  });
  if (!booking) return Response.json({ error: "not_found" }, { status: 404 });

  const orders = await prisma.serviceOrder.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: "desc" },
  });

  // 마진 환산용 환율: 예약 스냅샷 우선, 없으면 현재 운영 환율(AppSetting)
  const fx = booking.fxVndPerKrw
    ? booking.fxVndPerKrw.toString()
    : await getFxVndPerKrw(prisma);

  const services = orders.map((o) => {
    const serialized = serializeBigInt(o) as Record<string, unknown>;
    // 마진은 항목별로 격리 — 환율(AppSetting 자유 텍스트)이 깨진 형식이어도
    // 목록 전체가 500이 되지 않도록 실패 시 null로 degrade (QA Minor-1)
    let marginKrw: number | null = null;
    if (fx) {
      try {
        marginKrw = computeServiceMarginKrw(o.costVnd, o.priceKrw, fx);
      } catch {
        marginKrw = null;
      }
    }
    return { ...serialized, marginKrw };
  });

  return Response.json({ services, fxVndPerKrw: fx });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!booking) return Response.json({ error: "not_found" }, { status: 404 });

  // costVnd → BigInt — 정수 문자열만 허용 (16진수 "0x10"·공백·"" 등 거부, QA Minor-2)
  const costRaw = String(parsed.data.costVnd).trim();
  if (!/^\d+$/.test(costRaw)) {
    return Response.json(
      { error: "VALIDATION_FAILED", errors: ["NEGATIVE_COST"] },
      { status: 400 }
    );
  }
  const costVnd = BigInt(costRaw);

  const input: ServiceOrderInput = {
    type: parsed.data.type as ServiceType,
    costVnd,
    priceKrw: parsed.data.priceKrw,
    serviceDate: parsed.data.serviceDate ?? null,
    vendorName: parsed.data.vendorName ?? null,
    note: parsed.data.note ?? null,
  };
  const errors = validateServiceOrderInput(input);
  if (errors.length > 0) {
    return Response.json({ error: "VALIDATION_FAILED", errors }, { status: 400 });
  }

  const created = await prisma.serviceOrder.create({
    data: {
      bookingId: id,
      type: input.type,
      status: "REQUESTED",
      costVnd: input.costVnd,
      priceKrw: input.priceKrw,
      serviceDate: input.serviceDate ? parseUtcDateOnly(input.serviceDate) : null,
      vendorName: input.vendorName || null,
      note: input.note || null,
    },
  });

  // 감사 로그 — 데이터 변경 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: admin.userId,
    action: "CREATE",
    entity: "ServiceOrder",
    entityId: created.id,
    changes: {
      bookingId: { new: id },
      type: { new: created.type },
      costVnd: { new: created.costVnd.toString() },
      priceKrw: { new: created.priceKrw },
    },
  });

  return Response.json({ service: serializeBigInt(created) }, { status: 201 });
}
