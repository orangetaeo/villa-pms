// /api/vendors/[id]/account — 원천 공급자 로그인 계정 프로비저닝 (ADR-0023 §6, S3 인프라)
//   POST: ServiceVendor에 Role=VENDOR User 1:1 생성 + 연결 (isSystemAdmin/OWNER 전용).
//         계정 생성은 /api/users POST와 동일 기준(bcrypt·phone 숫자정규화·mustChangePassword).
//   DELETE: 연결 계정 소프트삭제(deletedAt·isActive=false) + ServiceVendor.userId=null (계정 해제).
//   ★ 응답 select 화이트리스트 — passwordHash 절대 제외.
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isSystemAdmin } from "@/lib/permissions";

const createSchema = z.object({
  phone: z.string(),
  password: z.string().min(8),
});

// POST — 공급자 로그인 계정 생성 (Role=VENDOR, 초기 비번 → 첫 로그인 후 변경 강제)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // 권한 검사 — isSystemAdmin(OWNER) 전용 (users 생성과 동일 기준, 첫 줄 role 검사)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 대상 공급자 로드 — 없으면 404, 이미 계정 있으면 409
  const vendor = await prisma.serviceVendor.findUnique({
    where: { id },
    select: { id: true, name: true, userId: true },
  });
  if (!vendor) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (vendor.userId) {
    return NextResponse.json({ error: "ACCOUNT_EXISTS" }, { status: 409 });
  }

  // phone 숫자 정규화 — 로그인은 정확매칭, 로그인 폼이 비숫자 제거하므로
  // 저장 전화도 숫자형식이어야 매칭됨 (메모리 phone-digit-normalization)
  const phone = parsed.data.phone.replace(/\D/g, "");
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
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  // 계정 생성 + 공급자 연결을 한 트랜잭션으로 묶어 원자성 보장
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        role: "VENDOR",
        name: vendor.name, // 거래처명 = 계정명
        phone,
        passwordHash,
        locale: "vi", // 베트남 외부 거래처 — vi 기본 (ADR-0023 VENDOR UX)
        isActive: true,
        // OWNER가 정한 초기 비번 → 사용자가 첫 로그인 후 직접 변경하도록 강제
        mustChangePassword: true,
      },
      select: { id: true, phone: true },
    });

    await tx.serviceVendor.update({
      where: { id },
      data: { userId: user.id },
    });

    // 감사 로그 — 계정 생성(User) + 공급자 연결(ServiceVendor). 비밀번호 제외(글로벌 절대 규칙).
    await writeAuditLog({
      db: tx,
      userId: session.user.id,
      action: "CREATE",
      entity: "User",
      entityId: user.id,
      changes: {
        role: { new: "VENDOR" },
        name: { new: vendor.name },
        phone: { new: user.phone },
      },
    });
    await writeAuditLog({
      db: tx,
      userId: session.user.id,
      action: "UPDATE",
      entity: "ServiceVendor",
      entityId: id,
      changes: { userId: { old: null, new: user.id } },
    });

    return user;
  });

  // 응답 select 화이트리스트 — passwordHash 절대 제외
  return NextResponse.json({ userId: created.id, phone: created.phone }, { status: 201 });
}

// DELETE — 계정 해제: 연결 User 소프트삭제(deletedAt·isActive=false) + ServiceVendor.userId=null.
//   (회원 소프트삭제 패턴 재사용 — 데이터 보존, 로그인·목록에서만 제외. ServiceVendor.user는
//    onDelete:SetNull이나 하드삭제는 안 하므로 명시적으로 userId=null 설정해 즉시 해제.)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const vendor = await tx.serviceVendor.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!vendor) return { kind: "NOT_FOUND" as const };
    // 계정이 없으면 멱등 성공 처리
    if (!vendor.userId) return { kind: "OK" as const, userId: null };

    const userId = vendor.userId;

    // 연결 계정 소프트삭제 — 로그인·목록 제외, 데이터 보존 (users DELETE 패턴)
    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        isActive: false,
        // Zalo 식별자 해제 — @unique 점유 해제로 재연결 가능
        zaloUserId: null,
      },
    });
    // 끊긴 대화는 userId 분리 (UNLINK_ZALO와 동일)
    await tx.zaloConversation.updateMany({
      where: { userId },
      data: { userId: null },
    });
    // 공급자에서 계정 연결 즉시 해제
    await tx.serviceVendor.update({
      where: { id },
      data: { userId: null },
    });

    await writeAuditLog({
      db: tx,
      userId: session.user.id,
      action: "DELETE",
      entity: "User",
      entityId: userId,
      changes: { deletedAt: { old: null, new: "(soft-deleted)" } },
    });
    await writeAuditLog({
      db: tx,
      userId: session.user.id,
      action: "UPDATE",
      entity: "ServiceVendor",
      entityId: id,
      changes: { userId: { old: userId, new: null } },
    });

    return { kind: "OK" as const, userId };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ id, userId: result.userId });
}
