// GET  /api/complex-areas — 지역(단지) 마스터 목록 (로그인 필수: SUPPLIER·운영자 공용, ADR-0046)
//   응답 화이트리스트 { id, name, nameKo, sortOrder } — active만, sortOrder→name 정렬. 마진·재고 무관(무해 등급)이나 최소 필드.
// POST /api/complex-areas — 신규 단지 생성 (운영자 전용). name(라틴 정본)·nameKo?·code?(슬러그 자동)·sortOrder?.
//   name 중복 400 DUPLICATE_COMPLEX. 전 변경 AuditLog 필수(글로벌 절대 규칙).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireAuth, requireCapability } from "@/lib/api-guard";
import { slugifyComplexCode } from "@/lib/complex-area";
import { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  // 로그인 필수 — 공급자·운영자 공용 드롭다운 소스. 비로그인 401.
  const g = await requireAuth(req);
  if (!g.ok) return g.response;

  const areas = await prisma.complexArea.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, nameKo: true, sortOrder: true },
  });
  return NextResponse.json({ areas });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100), // 라틴 정본(고유명사) — Villa.complex 캐시에 들어갈 값
  nameKo: z.string().trim().min(1).max(100).nullable().optional(), // 운영자 병기 전용(매칭 금지)
  code: z.string().trim().min(1).max(40).optional(), // 미수신 시 name에서 슬러그 자동 생성
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function POST(req: Request) {
  // 운영자 전용 — 마스터 데이터 관리(재무 아님 → isOperator, D5)
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // name(정본) 중복 차단 — 표기 분열 원천 봉인
  const dupName = await prisma.complexArea.findFirst({
    where: { name: data.name },
    select: { id: true },
  });
  if (dupName) return NextResponse.json({ error: "DUPLICATE_COMPLEX" }, { status: 400 });

  // code — 수신값 우선(슬러그 정규화), 미수신이면 name에서 자동 생성. 유일성 보장.
  const codeExplicit = data.code != null;
  const baseCode = slugifyComplexCode(data.code ?? data.name);
  let code = baseCode;
  if (codeExplicit) {
    const dupCode = await prisma.complexArea.findUnique({ where: { code }, select: { id: true } });
    if (dupCode) return NextResponse.json({ error: "DUPLICATE_CODE" }, { status: 400 });
  } else {
    // 자동 생성 — 충돌 시 -2, -3… 접미사로 회피(운영자 개입 불요)
    for (let n = 2; n <= 99; n++) {
      const dupCode = await prisma.complexArea.findUnique({ where: { code }, select: { id: true } });
      if (!dupCode) break;
      code = `${baseCode}-${n}`.slice(0, 40);
    }
  }

  let created;
  try {
    created = await prisma.complexArea.create({
      data: {
        name: data.name,
        nameKo: data.nameKo ?? null,
        code,
        ...(data.sortOrder != null ? { sortOrder: data.sortOrder } : {}),
      },
      select: { id: true, name: true, nameKo: true, code: true, sortOrder: true, active: true },
    });
  } catch (e) {
    // 동시성 경합으로 unique 충돌(P2002) — name/code 중 하나
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "DUPLICATE_COMPLEX" }, { status: 400 });
    }
    throw e;
  }

  await writeAuditLog({
    userId: g.session.user.id,
    action: "CREATE",
    entity: "ComplexArea",
    entityId: created.id,
    changes: {
      name: { new: created.name },
      code: { new: created.code },
      nameKo: { new: created.nameKo },
      sortOrder: { new: created.sortOrder },
      active: { new: created.active },
    },
  });

  return NextResponse.json(created, { status: 201 });
}
