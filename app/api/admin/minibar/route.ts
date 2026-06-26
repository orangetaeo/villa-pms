// GET/POST /api/admin/minibar — 미니바 회사표준 품목(MinibarItem) 목록·생성 (#2b, ADR-0016)
//
// 권한(첫 줄): 읽기 isOperator / 쓰기 canSetPrice(가격이 걸린 작업, STAFF 차단).
//   unitPriceVnd = 우리 판매가 → 공급자·공개 라우트 비노출. MinibarItem엔 villaId가 없어 구조적으로 도달 불가.
// AuditLog 필수(데이터 변경 API 절대 규칙). BigInt는 JSON 직렬화 불가 → 문자열로 송수신.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator, canSetPrice } from "@/lib/permissions";
import { MINIBAR_VND_DIGITS, generateMinibarItemKey, autoTranslateNameVi } from "@/lib/minibar";

const createSchema = z.object({
  nameKo: z.string().trim().min(1).max(60),
  // VND 동 단위 비음수 정수 문자열 (우리 판매가)
  unitPriceVnd: z.string().regex(MINIBAR_VND_DIGITS),
  // 매입 단가(입고가) VND 동 단위 — 운영자 전용. 미입력 허용(빈문자열·미전송 → null).
  costVnd: z.string().regex(MINIBAR_VND_DIGITS).optional().nullable(),
  // 기본 비치 수량 — 각 빌라 표준 비치 개수 (체크아웃 소모 계산 기준)
  stockQty: z.number().int().min(0).max(999).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});

/** 목록 — 운영자 조회. active·sortOrder 순(인덱스 정합) → 생성순. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const items = await prisma.minibarItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      itemKey: true,
      nameKo: true,
      nameVi: true,
      unitPriceVnd: true,
      costVnd: true,
      stockQty: true,
      sortOrder: true,
      active: true,
    },
  });
  return NextResponse.json({
    items: items.map((m) => ({
      ...m,
      unitPriceVnd: m.unitPriceVnd.toString(),
      costVnd: m.costVnd?.toString() ?? null,
    })),
  });
}

/** 생성 — 가격설정 권한. itemKey 자동생성(표시명 무관 안정키). */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canSetPrice(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const userId = session.user.id;

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
  const data = parsed.data;

  // 한국어명 → 베트남어 자동번역(소비자 vi 화면용). 실패 시 null(폴백 nameKo, 무해).
  const nameVi = await autoTranslateNameVi(data.nameKo);
  const costVnd = data.costVnd && data.costVnd !== "" ? BigInt(data.costVnd) : null;

  const created = await prisma.minibarItem.create({
    data: {
      itemKey: generateMinibarItemKey(Date.now()),
      nameKo: data.nameKo,
      nameVi,
      unitPriceVnd: BigInt(data.unitPriceVnd),
      costVnd,
      stockQty: data.stockQty ?? 1,
      sortOrder: data.sortOrder ?? 0,
      active: data.active ?? true,
    },
    select: {
      id: true,
      itemKey: true,
      nameKo: true,
      nameVi: true,
      unitPriceVnd: true,
      costVnd: true,
      stockQty: true,
      sortOrder: true,
      active: true,
    },
  });

  // 감사 로그 — 판매가·입고가 스냅샷 포함(BigInt → 문자열). 데이터 변경 절대 규칙.
  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "MinibarItem",
    entityId: created.id,
    changes: {
      nameKo: { new: created.nameKo },
      unitPriceVnd: { new: created.unitPriceVnd.toString() },
      costVnd: { new: created.costVnd?.toString() ?? null },
      active: { new: created.active },
    },
  });

  return NextResponse.json({
    item: {
      ...created,
      unitPriceVnd: created.unitPriceVnd.toString(),
      costVnd: created.costVnd?.toString() ?? null,
    },
  });
}
