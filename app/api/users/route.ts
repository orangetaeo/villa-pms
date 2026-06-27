// GET /api/users — ADMIN 사용자 목록 + 미연결 Zalo 팔로워 (T1.8, SPEC F0)
// POST /api/users — 계정 생성 (OWNER 전용, S-RBAC-4 A1)
// passwordHash 등 민감 필드는 select 화이트리스트로 차단 (include 통째 반환 금지)
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit-log";
import { isSystemAdmin } from "@/lib/permissions";
import { BCRYPT_ROUNDS, PASSWORD_MIN, isStrongPassword, PASSWORD_POLICY_MESSAGE } from "@/lib/password-policy";

// GET ?role= 필터 화이트리스트 — 운영자 역할(OWNER/MANAGER/STAFF) 포함 (S-RBAC-4)
const ROLES = ["OWNER", "MANAGER", "STAFF", "ADMIN", "SUPPLIER", "CLEANER"] as const;

// 부여 가능 역할 — OWNER·ADMIN 제외(권한상승 표면 차단·단일 OWNER 유지, 계약 A1)
const ASSIGNABLE_ROLES = ["MANAGER", "STAFF", "SUPPLIER", "CLEANER"] as const;

// 역할별 기본 locale — SUPPLIER/CLEANER=vi(공급자), MANAGER/STAFF=ko(운영자)
const DEFAULT_LOCALE: Record<(typeof ASSIGNABLE_ROLES)[number], "ko" | "vi"> = {
  MANAGER: "ko",
  STAFF: "ko",
  SUPPLIER: "vi",
  CLEANER: "vi",
};

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string(),
  password: z.string().min(PASSWORD_MIN).refine(isStrongPassword, PASSWORD_POLICY_MESSAGE),
  role: z.enum(ASSIGNABLE_ROLES),
  locale: z.enum(["ko", "vi"]).optional(),
});

export async function GET(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // ?role= 필터 — 화이트리스트 외 값은 400
  const roleParam = new URL(req.url).searchParams.get("role");
  if (roleParam !== null && !(ROLES as readonly string[]).includes(roleParam)) {
    return NextResponse.json(
      { error: "INVALID_ROLE", role: roleParam },
      { status: 400 }
    );
  }
  const role = roleParam as Role | null;

  const [users, unlinkedZalo] = await Promise.all([
    prisma.user.findMany({
      where: role ? { role } : undefined,
      // select 화이트리스트 — passwordHash 절대 제외 (계약 T1.8)
      select: {
        id: true,
        role: true,
        name: true,
        phone: true,
        email: true,
        zaloUserId: true,
        locale: true,
        isActive: true,
        createdAt: true,
        _count: { select: { villas: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // 미가입 Zalo 팔로워 — FE 수동 매칭 드롭다운용 (userId 미연결만)
    prisma.zaloConversation.findMany({
      where: { userId: null },
      select: {
        id: true,
        zaloUserId: true,
        displayName: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({ users, unlinkedZalo });
}

// POST /api/users — 계정 생성 (OWNER 전용, S-RBAC-4 A1)
export async function POST(req: Request) {
  // 권한 검사 — isSystemAdmin(OWNER) 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

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
  const { name, password, role } = parsed.data;

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
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const locale = parsed.data.locale ?? DEFAULT_LOCALE[role];

  const created = await prisma.user.create({
    data: {
      name,
      phone,
      passwordHash,
      role,
      locale,
      isActive: true,
      // OWNER가 정한 초기 비번 → 사용자가 첫 로그인 후 직접 변경하도록 강제
      mustChangePassword: true,
    },
    // 응답 select 화이트리스트 — passwordHash 절대 제외 (계약 A1)
    select: {
      id: true,
      role: true,
      name: true,
      phone: true,
      isActive: true,
      createdAt: true,
    },
  });

  // 감사 로그 CREATE — changes에 role·name·phone (비밀번호 제외, 글로벌 절대 규칙)
  await writeAuditLog({
    userId: session.user.id,
    action: "CREATE",
    entity: "User",
    entityId: created.id,
    changes: {
      role: { new: created.role },
      name: { new: created.name },
      phone: { new: created.phone },
    },
  });

  return NextResponse.json(created, { status: 201 });
}
