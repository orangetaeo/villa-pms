// POST /api/supplier/bookings/[id]/checkin — 공급자 직접예약 체크인 (T10.5, F10 D5 / ADR-0021 §6)
//
// 공급자가 자기 빌라 현장에서 자기 직접예약(seller=SUPPLIER) 게스트를 정식 F4 체크인한다.
// 비즈니스 로직은 운영자와 동일한 lib/checkin.completeCheckIn 재사용 — "운영자 전달" 단계만 제외(공급자 본인 임시거주신고).
// 권한·누수: SUPPLIER + seller=SUPPLIER + villa.supplierId === 본인. 미일치=404(존재 비노출, T10.2 패턴).
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CheckInRejectedError, completeCheckIn } from "@/lib/checkin";
import {
  SupplierBookingForbiddenError,
  assertSupplierCanInspectBooking,
} from "@/lib/supplier-booking-access";

const passportDataSchema = z.object({
  surname: z.string().nullable().default(null),
  givenNames: z.string().nullable().default(null),
  passportNo: z.string().nullable().default(null),
  nationality: z.string().nullable().default(null),
  birthDate: z.string().nullable().default(null),
  expiryDate: z.string().nullable().default(null),
  sex: z.string().nullable().default(null),
});

const checkinSchema = z.object({
  // 비공개 서빙 경로만 허용 — 공개 /uploads 경로·외부 URL 저장 차단 (운영자 라우트와 동일 정책)
  passportPhotoUrls: z
    .array(z.string().regex(/^\/api\/passports\/[a-zA-Z0-9._-]+$/))
    .min(1)
    .max(20),
  passportData: z.array(passportDataSchema).max(20).default([]),
  deposit: z
    .object({
      // 공급자 현장은 동 단위 — VND만 허용(디자인: KRW/USD 토글 제거)
      amount: z.number().int().min(1).max(2_147_483_647),
      currency: z.literal("VND"),
    })
    .nullable()
    .default(null),
  notes: z.string().max(2000).optional(),
  signatureUrl: z
    .string()
    .regex(/^\/api\/passports\/[a-zA-Z0-9._-]+$/)
    .nullable()
    .optional(),
  agreementVersion: z.string().max(50).nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 첫 줄 권한 검사 — SUPPLIER 전용 (비로그인 401 / 타롤 403)
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPPLIER") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const supplierId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = checkinSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { id } = await params;
  try {
    // 소유·주체 가드 — 자기 빌라 AND seller=SUPPLIER 가 아니면 404(존재 비노출)
    await assertSupplierCanInspectBooking(prisma, id, supplierId);

    const record = await completeCheckIn(prisma, {
      bookingId: id,
      passportPhotoUrls: parsed.data.passportPhotoUrls,
      passportData: parsed.data.passportData,
      deposit: parsed.data.deposit,
      signatureUrl: parsed.data.signatureUrl ?? null,
      agreementVersion: parsed.data.agreementVersion ?? null,
      notes: parsed.data.notes,
      actorUserId: supplierId,
    });
    return Response.json({ checkInRecord: record });
  } catch (e) {
    if (e instanceof SupplierBookingForbiddenError) {
      // 운영자 예약·타 공급자 예약·없는 예약 모두 404로 흡수 (재고·마진 비공개)
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (e instanceof CheckInRejectedError) {
      const status = e.reason === "NOT_FOUND" ? 404 : 409;
      return Response.json({ error: e.reason, message: e.message }, { status });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[supplier/checkin] 실패:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "체크인 처리에 실패했습니다" }, { status: 500 });
  }
}
