// /api/vendor/catalog-items — 벤더 보드 품목(티켓 분류) 필터 셀렉트 소스 (계약 vendor-board-item-filter)
//   GET: Role=VENDOR + 본인 vendorId 스코프 강제. 본인 소속 카탈로그 품목의 { id, name }만 반환.
//   ★ 누수: priceVnd(우리 판매가)·costVnd·마진·audiences 등 절대 미포함 — id·name 2필드만.
//   active true/false 모두 포함 — 과거(비활성) 품목이 붙은 구주문도 필터로 걸러야 하므로.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isVendor, type Role } from "@/lib/permissions";
import { getVendorIdForUser } from "@/lib/vendor-auth";
import { getSupplierLocale } from "@/lib/locale";
import { pickI18n } from "@/lib/service-display";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const vendorId = await getVendorIdForUser(session.user.id);
  if (!vendorId) return NextResponse.json({ error: "NOT_A_VENDOR" }, { status: 403 });

  const locale = await getSupplierLocale(session.user.locale);
  // ★ select는 id·이름 원천(nameKo·nameI18n)만 — 가격·원가·audiences 필드 자체를 로드하지 않음(누수 차단).
  const items = await prisma.serviceCatalogItem.findMany({
    where: { vendorId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, nameKo: true, nameI18n: true },
  });

  // 응답 원소 = { id, name }만. name은 벤더 locale로 현지화.
  const result = items.map((i) => ({ id: i.id, name: pickI18n(i.nameKo, i.nameI18n, locale) }));
  return NextResponse.json({ items: result });
}
