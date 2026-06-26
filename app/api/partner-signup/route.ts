// /api/partner-signup — 파트너(여행사·랜드사) 자가 회원가입 (ADR-0028 PP2, 공개·비인증)
//   POST: 비로그인 파트너가 직접 계정(Role=PARTNER)+Partner 엔티티 생성 → approvalStatus=PENDING_APPROVAL.
//         운영자 승인(ApprovalGate) 전에는 /partner 포털 접근 불가.
//   계정 생성 기준은 /api/vendor-signup과 동일(bcrypt·phone 숫자정규화).
//   ★ 자가 비번이라 mustChangePassword=false. 공개지만 응답에 민감정보(passwordHash 등) 미반환.
//   여신(creditTier·creditLimitVnd·depositRatePct·paymentTermDays)은 스키마 기본값 — 운영자 승인 시 설정.
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// 공개·미인증 가입 스팸 방어 (rate-limit, vendor-signup 패턴 재사용).
const SIGNUP_IP_LIMIT = { max: 10, windowMs: 60 * 60_000 };

const signupSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["TRAVEL_AGENCY", "LAND_AGENCY"]),
  phone: z.string(),
  password: z.string().min(8),
  contactEmail: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  // 폭주·가입 스팸 방어 — IP best-effort 윈도우. 초과 시 429.
  const ip = clientIp(req.headers);
  if (ip && !checkRateLimit(`partner-signup:ip:${ip}`, SIGNUP_IP_LIMIT).allowed) {
    return NextResponse.json({ error: "TOO_MANY_REQUESTS" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const d = parsed.data;

  // phone 숫자 정규화 — 로그인은 정확매칭, 로그인 폼이 비숫자 제거하므로
  // 저장 전화도 숫자형식이어야 매칭됨 (메모리 phone-digit-normalization)
  const phone = d.phone.replace(/\D/g, "");
  if (!phone) {
    return NextResponse.json({ error: "PHONE_TAKEN" }, { status: 409 });
  }

  // 중복 phone → 409 (phone @unique)
  const existing = await prisma.user.findUnique({
    where: { phone },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: "PHONE_TAKEN" }, { status: 409 });
  }

  // 비밀번호 해시 — auth.ts와 동일 bcryptjs
  const passwordHash = await bcrypt.hash(d.password, 10);

  const contactEmail = d.contactEmail?.trim() || undefined;

  // 계정 생성 + 파트너 엔티티 생성을 한 트랜잭션으로 묶어 원자성 보장
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        role: "PARTNER",
        name: d.name,
        phone,
        passwordHash,
        // 한국 여행사·랜드사 다수 → ko 기본 (ADR-0028 PARTNER UX, 미들웨어 /partner 기본도 ko)
        locale: "ko",
        isActive: true,
        // 자가 가입(본인이 정한 비번) → 첫 로그인 강제변경 불필요
        mustChangePassword: false,
      },
      select: { id: true },
    });

    const partner = await tx.partner.create({
      data: {
        type: d.type,
        name: d.name,
        contactPhone: phone,
        ...(contactEmail ? { contactEmail } : {}),
        userId: user.id,
        // 자가가입 → 운영자 승인 대기. 여신/선금율/지급기한은 스키마 기본값(승인 시 운영자 설정).
        approvalStatus: "PENDING_APPROVAL",
        status: "ACTIVE",
      },
      select: { id: true },
    });

    // 감사 로그 — 자가 가입(actor=생성된 user 본인). 비밀번호 미기록(글로벌 절대 규칙).
    await writeAuditLog({
      db: tx,
      userId: user.id,
      action: "CREATE",
      entity: "Partner",
      entityId: partner.id,
      changes: {
        approvalStatus: { new: "PENDING_APPROVAL" },
        selfSignup: { new: true },
      },
    });
  });

  // 응답 화이트리스트 — 민감정보(passwordHash·id 등) 미반환
  return NextResponse.json({ ok: true }, { status: 201 });
}
