// PATCH /api/users/[id] — ADMIN 사용자 관리 (T1.8, SPEC F0)
// 활성/비활성 토글 + Zalo 수동 연결·해제 + 비번 초기화. 본인 비활성화 금지(락아웃 방지)
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isSystemAdmin } from "@/lib/permissions";

// 부여 가능 역할 — OWNER·ADMIN 제외(권한상승 표면 차단, 계약 A2)
const ASSIGNABLE_ROLES = ["MANAGER", "STAFF", "SUPPLIER", "CLEANER"] as const;

// 임시 비밀번호 생성 — 혼동 문자(0/O, 1/l/I) 제외, 기본 10자.
// OWNER가 사용자에게 Zalo 등으로 전달 → 사용자가 직접 변경 가정.
const TEMP_PW_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateTempPassword(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += TEMP_PW_ALPHABET[randomInt(TEMP_PW_ALPHABET.length)];
  }
  return out;
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("DEACTIVATE") }),
  z.object({ action: z.literal("ACTIVATE") }),
  z.object({ action: z.literal("LINK_ZALO"), zaloUserId: z.string().min(1) }),
  z.object({ action: z.literal("UNLINK_ZALO") }),
  z.object({ action: z.literal("CHANGE_ROLE"), role: z.enum(ASSIGNABLE_ROLES) }),
  z.object({ action: z.literal("RESET_PASSWORD") }),
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // 본인 비활성화 금지 — ADMIN 락아웃 방지 (계약 T1.8)
  if (input.action === "DEACTIVATE" && id === session.user.id) {
    return NextResponse.json(
      { error: "CANNOT_DEACTIVATE_SELF" },
      { status: 400 }
    );
  }

  // 본인 역할 변경 금지 — 자기 강등·락아웃 방지 (계약 A2)
  if (input.action === "CHANGE_ROLE" && id === session.user.id) {
    return NextResponse.json(
      { error: "CANNOT_CHANGE_OWN_ROLE" },
      { status: 400 }
    );
  }

  // 비번 초기화 — 임시 비밀번호 생성·해시는 트랜잭션 밖(bcrypt는 무거움).
  // 평문은 응답으로 1회만 반환하고 감사 로그·DB엔 절대 저장하지 않는다.
  const tempPassword =
    input.action === "RESET_PASSWORD" ? generateTempPassword() : null;
  const tempPasswordHash = tempPassword ? await bcrypt.hash(tempPassword, 10) : null;

  // 트랜잭션 — 대상 확인·중복 검사·갱신·Zalo 동기화·감사 로그를 원자적으로 처리
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        isActive: true,
        zaloUserId: true,
        _count: { select: { villas: true } },
      },
    });
    if (!user) return { kind: "NOT_FOUND" as const };

    if (input.action === "CHANGE_ROLE") {
      // 빌라 고아 방지 — SUPPLIER가 빌라 보유 중인데 비SUPPLIER로 변경 시 차단
      // (villa.supplierId 스코프 깨짐 방지, 계약 A2)
      if (
        user.role === "SUPPLIER" &&
        input.role !== "SUPPLIER" &&
        user._count.villas > 0
      ) {
        return { kind: "HAS_VILLAS" as const };
      }
      const updated = await tx.user.update({
        where: { id },
        data: { role: input.role },
        select: { id: true, isActive: true, zaloUserId: true, role: true },
      });
      await writeAuditLog({
        userId: session.user.id,
        action: "UPDATE",
        entity: "User",
        entityId: id,
        changes: { role: { old: user.role, new: updated.role } },
        db: tx,
      });
      return { kind: "OK" as const, user: updated };
    }

    if (input.action === "RESET_PASSWORD") {
      const updated = await tx.user.update({
        where: { id },
        // 임시 비번 발급 → 사용자가 직접 변경 전까지 다른 화면 차단(mustChangePassword)
        data: { passwordHash: tempPasswordHash!, mustChangePassword: true },
        select: { id: true, isActive: true, zaloUserId: true },
      });
      // 감사 로그 — 초기화 사실만 기록(평문·해시 절대 미기록, leak-checklist)
      await writeAuditLog({
        userId: session.user.id,
        action: "UPDATE",
        entity: "User",
        entityId: id,
        changes: { passwordReset: { new: true } },
        db: tx,
      });
      return { kind: "OK" as const, user: updated };
    }

    if (input.action === "ACTIVATE" || input.action === "DEACTIVATE") {
      const nextActive = input.action === "ACTIVATE";
      const updated = await tx.user.update({
        where: { id },
        data: { isActive: nextActive },
        select: { id: true, isActive: true, zaloUserId: true },
      });
      // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
      await writeAuditLog({
        userId: session.user.id,
        action: "UPDATE",
        entity: "User",
        entityId: id,
        changes: {
          isActive: { old: user.isActive, new: updated.isActive },
        },
        db: tx,
      });
      return { kind: "OK" as const, user: updated };
    }

    if (input.action === "LINK_ZALO") {
      // 이미 다른 사용자에 연결된 zaloUserId → 409 (zaloUserId @unique)
      const holder = await tx.user.findUnique({
        where: { zaloUserId: input.zaloUserId },
        select: { id: true },
      });
      if (holder && holder.id !== id) {
        return { kind: "ZALO_CONFLICT" as const };
      }

      // 기존 연결이 있으면 이전 ZaloConversation.userId 해제
      // (ZaloConversation.userId @unique — 새 대화 연결 전 정리 필수)
      if (user.zaloUserId && user.zaloUserId !== input.zaloUserId) {
        await tx.zaloConversation.updateMany({
          where: { userId: id },
          data: { userId: null },
        });
      }

      const updated = await tx.user.update({
        where: { id },
        data: { zaloUserId: input.zaloUserId },
        select: { id: true, isActive: true, zaloUserId: true },
      });
      // 미가입 팔로워 대화가 있으면 userId 동기화 (수동 매칭)
      await tx.zaloConversation.updateMany({
        where: { zaloUserId: input.zaloUserId },
        data: { userId: id },
      });

      await writeAuditLog({
        userId: session.user.id,
        action: "UPDATE",
        entity: "User",
        entityId: id,
        changes: {
          zaloUserId: { old: user.zaloUserId, new: updated.zaloUserId },
        },
        db: tx,
      });
      return { kind: "OK" as const, user: updated };
    }

    // UNLINK_ZALO — User.zaloUserId 해제 + ZaloConversation 동기화
    const updated = await tx.user.update({
      where: { id },
      data: { zaloUserId: null },
      select: { id: true, isActive: true, zaloUserId: true },
    });
    await tx.zaloConversation.updateMany({
      where: { userId: id },
      data: { userId: null },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE",
      entity: "User",
      entityId: id,
      changes: {
        zaloUserId: { old: user.zaloUserId, new: null },
      },
      db: tx,
    });
    return { kind: "OK" as const, user: updated };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "ZALO_CONFLICT") {
    return NextResponse.json({ error: "ZALO_ALREADY_LINKED" }, { status: 409 });
  }
  if (result.kind === "HAS_VILLAS") {
    return NextResponse.json({ error: "HAS_VILLAS" }, { status: 409 });
  }

  return NextResponse.json({
    id: result.user.id,
    isActive: result.user.isActive,
    zaloUserId: result.user.zaloUserId,
    // CHANGE_ROLE 시 변경된 role 포함 (다른 액션엔 undefined → 직렬화에서 생략)
    ...("role" in result.user ? { role: result.user.role } : {}),
    // RESET_PASSWORD 시 임시 비밀번호 1회 반환 (화면에서 OWNER에게만 표시 후 폐기)
    ...(tempPassword ? { tempPassword } : {}),
  });
}

// DELETE /api/users/[id] — 회원 소프트 삭제 (deletedAt 스탬프).
// 완전 삭제 아님: 데이터·빌라는 보존하고 목록·로그인에서만 제외. 복구는 DB에서 deletedAt=null.
// 차단: 본인(락아웃), OWNER(최상위 권한 보호), 빌라 보유 SUPPLIER(고아 방지 — 먼저 이관).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

  // 본인 삭제 금지 — ADMIN 락아웃 방지
  if (id === session.user.id) {
    return NextResponse.json({ error: "CANNOT_DELETE_SELF" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        deletedAt: true,
        zaloUserId: true,
        _count: { select: { villas: true } },
      },
    });
    if (!user) return { kind: "NOT_FOUND" as const };
    // 이미 삭제됨 — 멱등 처리 (성공으로 응답)
    if (user.deletedAt) return { kind: "OK" as const };
    // OWNER 보호 — 최상위 권한 계정은 삭제 불가 (권한상승·시스템 고립 방지)
    if (user.role === "OWNER") return { kind: "CANNOT_DELETE_OWNER" as const };
    // 빌라 보유 공급자 — 삭제 시 빌라가 고아되므로 차단 (CHANGE_ROLE과 동일 정책)
    if (user.role === "SUPPLIER" && user._count.villas > 0) {
      return { kind: "HAS_VILLAS" as const };
    }

    await tx.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        // 비활성화 동시 적용 — isActive 기반 로직도 삭제된 계정을 차단하도록
        isActive: false,
        // Zalo 식별자 해제 — @unique 점유 해제로 다른 계정이 동일 Zalo 재연결 가능
        zaloUserId: null,
      },
    });
    // 소프트 삭제로 끊긴 대화는 userId 분리 (UNLINK_ZALO와 동일)
    await tx.zaloConversation.updateMany({
      where: { userId: id },
      data: { userId: null },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "DELETE",
      entity: "User",
      entityId: id,
      changes: { deletedAt: { old: null, new: "(soft-deleted)" } },
      db: tx,
    });
    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "CANNOT_DELETE_OWNER") {
    return NextResponse.json({ error: "CANNOT_DELETE_OWNER" }, { status: 403 });
  }
  if (result.kind === "HAS_VILLAS") {
    return NextResponse.json({ error: "HAS_VILLAS" }, { status: 409 });
  }

  return NextResponse.json({ id, deleted: true });
}
