// GET/PUT /api/agreement — 이용 동의서 콘텐츠 조회·발행 (ADMIN 전용, T-admin-agreement-editor)
// 전 빌라 공용 단일 동의서. 발행마다 rev +1, 직전본 이력 보존, 감사 로그 기록.
// 저장소: AppSetting JSON (스키마 무변경) — lib/agreement-store.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isSystemAdmin } from "@/lib/permissions";
import { getAgreementContent, saveAgreementContent } from "@/lib/agreement-store";
import { normalizeAgreementContent, validateAgreementContent } from "@/lib/agreement";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  }
  if (!isSystemAdmin(session.user.role)) {
    return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
  return { userId: session.user.id };
}

export async function GET() {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  const content = await getAgreementContent();
  return NextResponse.json({ content });
}

export async function PUT(req: Request) {
  // 권한 검사 — ADMIN 전용
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  // 현재 rev 기준 정규화(+1) — 알 수 없는 키 제거·트림
  const current = await getAgreementContent();
  const next = normalizeAgreementContent(body, current.rev);

  // 법적 완결성 — 모든 조항 × 모든 언어 필수 (누락 발행 차단)
  const check = validateAgreementContent(next);
  if (!check.ok) {
    return NextResponse.json({ error: "INCOMPLETE", missing: check.missing }, { status: 400 });
  }

  await saveAgreementContent(prisma, next);

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: admin.userId,
    action: "UPDATE",
    entity: "Agreement",
    entityId: `rev-${next.rev}`,
    changes: { rev: { old: current.rev, new: next.rev } },
  });

  return NextResponse.json({ content: next });
}
