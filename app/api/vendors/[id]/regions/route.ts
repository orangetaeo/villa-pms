// PUT /api/vendors/[id]/regions — 업체 담당 지역(다중) 커버리지 설정 (ADR-0038)
//   body { coverage: [{ serviceType: "MASSAGE"|"BARBER", regions: string[] }] } — serviceType별 replace-set.
//   REGIONAL_VENDOR_TYPES(MASSAGE·BARBER)만 허용. region = Villa.complex(단지명) 값.
//   권한: isOperator. 누수: 응답은 serviceType·regions만(bankInfo·원가·마진 없음). AuditLog 필수.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { REGIONAL_VENDOR_TYPES } from "@/lib/regional-vendor";

const bodySchema = z.object({
  coverage: z.array(
    z.object({
      // 지역 분포 타입만 커버리지 대상 — 그 외 타입은 400(REGIONAL_VENDOR_TYPES가 유일 허용)
      serviceType: z.enum(REGIONAL_VENDOR_TYPES),
      // region = Villa.complex(단지명). 문자열 배열 — trim·빈문자열 제거·중복 제거는 아래에서 정규화.
      regions: z.array(z.string()),
    }),
  ),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  // serviceType별 정규화(union) — 지역 문자열 trim·빈값 제거·중복 제거. 중복 serviceType 엔트리는 병합.
  const byType = new Map<(typeof REGIONAL_VENDOR_TYPES)[number], Set<string>>();
  for (const entry of parsed.data.coverage) {
    const set = byType.get(entry.serviceType) ?? new Set<string>();
    for (const raw of entry.regions) {
      const region = raw.trim();
      if (region) set.add(region);
    }
    byType.set(entry.serviceType, set);
  }

  // 대상 벤더 존재 검증(404) — 미존재 벤더 커버리지 배정 차단.
  const vendor = await prisma.serviceVendor.findUnique({ where: { id }, select: { id: true } });
  if (!vendor) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const coverage: { serviceType: (typeof REGIONAL_VENDOR_TYPES)[number]; regions: string[] }[] = [];

  // serviceType별 replace-set — deleteMany → createMany 를 트랜잭션으로 원자 처리.
  for (const [serviceType, set] of byType) {
    const regions = [...set];
    await prisma.$transaction([
      prisma.serviceVendorRegion.deleteMany({ where: { vendorId: id, serviceType } }),
      prisma.serviceVendorRegion.createMany({
        data: regions.map((region) => ({ vendorId: id, serviceType, region })),
        skipDuplicates: true,
      }),
    ]);

    await writeAuditLog({
      db: prisma,
      userId: g.session.user.id,
      action: "UPDATE",
      entity: "ServiceVendorRegion",
      entityId: id,
      changes: {
        serviceType: { new: serviceType },
        regions: { new: regions },
      },
    });

    coverage.push({ serviceType, regions });
  }

  // ★누수 0 — serviceType·regions만 반환(bankInfo·원가·마진 없음).
  return NextResponse.json({ coverage });
}
