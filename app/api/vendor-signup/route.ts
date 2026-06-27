// /api/vendor-signup — 원천 공급자 자가 회원가입 (ADR-0023 S5, 공개·비인증)
//   POST: 비로그인 공급자가 직접 계정+ServiceVendor 생성 → approvalStatus=PENDING_APPROVAL.
//         운영자 승인(/api/vendors/[id]/approval) 전에는 카탈로그 배정·발주 수신 불가.
//   계정 생성 기준은 /api/users·/api/vendors/[id]/account와 동일(bcrypt·phone 숫자정규화).
//   ★ 자가 비번이라 mustChangePassword=false. 공개지만 응답에 민감정보(passwordHash·bankInfo) 미반환.
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { BCRYPT_ROUNDS, PASSWORD_MIN, isStrongPassword, PASSWORD_POLICY_MESSAGE } from "@/lib/password-policy";
import type { Prisma } from "@prisma/client";

// 공개·미인증 가입 스팸 방어 (rate-limit, T-sec-public-hardening 패턴 재사용).
const SIGNUP_IP_LIMIT = { max: 10, windowMs: 60 * 60_000 };

const signupSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string(),
  password: z.string().min(PASSWORD_MIN).refine(isStrongPassword, PASSWORD_POLICY_MESSAGE),
  zaloUserId: z.string().max(64).optional(),
  bankBank: z.string().max(120).optional(),
  bankAccount: z.string().max(120).optional(),
  bankHolder: z.string().max(120).optional(),
  note: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  // 폭주·가입 스팸 방어 — IP best-effort 윈도우. 초과 시 429.
  const ip = clientIp(req.headers);
  if (ip && !checkRateLimit(`vendor-signup:ip:${ip}`, SIGNUP_IP_LIMIT).allowed) {
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
  const passwordHash = await bcrypt.hash(d.password, BCRYPT_ROUNDS);

  // 정산 계좌 정보 — 입력된 필드가 하나라도 있을 때만 JSON 구성
  const bankInfo: Prisma.InputJsonValue | undefined =
    d.bankBank || d.bankAccount || d.bankHolder
      ? {
          ...(d.bankBank ? { bank: d.bankBank } : {}),
          ...(d.bankAccount ? { account: d.bankAccount } : {}),
          ...(d.bankHolder ? { holder: d.bankHolder } : {}),
        }
      : undefined;

  // 계정 생성 + 공급자 엔티티 생성을 한 트랜잭션으로 묶어 원자성 보장
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        role: "VENDOR",
        name: d.name,
        phone,
        passwordHash,
        locale: "vi", // 베트남 외부 거래처 — vi 기본 (ADR-0023 VENDOR UX)
        isActive: true,
        // 자가 가입(본인이 정한 비번) → 첫 로그인 강제변경 불필요
        mustChangePassword: false,
      },
      select: { id: true },
    });

    const vendor = await tx.serviceVendor.create({
      data: {
        name: d.name,
        phone,
        zaloUserId: d.zaloUserId ?? null,
        ...(bankInfo !== undefined ? { bankInfo } : {}),
        note: d.note ?? null,
        userId: user.id,
        approvalStatus: "PENDING_APPROVAL", // 운영자 승인 대기 (ADR-0023 S5)
        active: true,
      },
      select: { id: true },
    });

    // 감사 로그 — 자가 가입(actor=생성된 user 본인). 비밀번호·계좌 정보 미기록(글로벌 절대 규칙·원칙2).
    await writeAuditLog({
      db: tx,
      userId: user.id,
      action: "CREATE",
      entity: "ServiceVendor",
      entityId: vendor.id,
      changes: {
        approvalStatus: { new: "PENDING_APPROVAL" },
        selfSignup: { new: true },
      },
    });

    return vendor;
  });

  // 응답 화이트리스트 — 민감정보(passwordHash·bankInfo·id 등) 미반환
  void created;
  return NextResponse.json({ ok: true }, { status: 201 });
}
