import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CheckInRejectedError, completeCheckIn } from "@/lib/checkin";

/**
 * POST /api/bookings/[id]/checkin — 체크인 완료 CONFIRMED → CHECKED_IN (T3.1, ADMIN 전용)
 * 동의서·서명(T3.2)·여권 Zalo 전달(T3.6)은 별도 — 본 라우트는 SPEC F4 체크인 1·3·5.
 */

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
  // 비공개 서빙 경로만 허용 — 공개 /uploads 경로·외부 URL 저장 차단 (QA 합의 조건 A)
  passportPhotoUrls: z
    .array(z.string().regex(/^\/api\/passports\/[a-zA-Z0-9._-]+$/))
    .min(1)
    .max(20),
  passportData: z.array(passportDataSchema).max(20).default([]),
  deposit: z
    .object({
      amount: z.number().int().min(1).max(2_147_483_647),
      currency: z.enum(["KRW", "VND", "USD"]),
    })
    .nullable()
    .default(null),
  notes: z.string().max(2000).optional(),
  // T3.2 — 터치 서명(선택). 비공개 증빙 경로만 (여권과 동일 정책)
  signatureUrl: z
    .string()
    .regex(/^\/api\/passports\/[a-zA-Z0-9._-]+$/)
    .nullable()
    .optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

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
    const record = await completeCheckIn(prisma, {
      bookingId: id,
      passportPhotoUrls: parsed.data.passportPhotoUrls,
      passportData: parsed.data.passportData,
      deposit: parsed.data.deposit,
      signatureUrl: parsed.data.signatureUrl ?? null,
      notes: parsed.data.notes,
      actorUserId: session.user.id,
    });
    return Response.json({ checkInRecord: record });
  } catch (e) {
    if (e instanceof CheckInRejectedError) {
      const status = e.reason === "NOT_FOUND" ? 404 : 409;
      return Response.json({ error: e.reason, message: e.message }, { status });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[bookings/checkin] 실패:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "체크인 처리에 실패했습니다" }, { status: 500 });
  }
}
