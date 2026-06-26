// /api/vendor/stats — 원천 공급자 본인 발주 통계 (ADR-0023 S4 §6.4)
//   GET: Role=VENDOR + 본인 vendorId 스코프 강제(서버). 자기 발주만.
//   ★ 누수: 우리 판매가(priceKrw/priceVnd)·마진 절대 미포함.
//      공급자는 costVnd(=우리가 그에게 지급할 금액=그의 매출)만 본다.
//   기간: ?range= 프리셋(thisMonth 기본) 또는 ?from=&to= 커스텀(resolveStatsPeriod 단일 해석).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isVendor, type Role } from "@/lib/permissions";
import { getVendorIdForUser } from "@/lib/vendor-auth";
import { resolveStatsPeriod } from "@/lib/statistics";
import { loadVendorStats } from "@/lib/vendor-stats";
import { getSupplierLocale } from "@/lib/locale";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const vendorId = await getVendorIdForUser(session.user.id);
  if (!vendorId) return NextResponse.json({ error: "NOT_A_VENDOR" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  // resolveStatsPeriod가 무효·미지정을 thisMonth로 폴백(단일 해석). 커스텀(from·to)도 검증 포함.
  const period = resolveStatsPeriod({
    range: searchParams.get("range") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });

  const locale = await getSupplierLocale(session.user.locale);
  const stats = await loadVendorStats(vendorId, period, locale);

  // 직렬화 객체에는 costVnd 기반 금액(VND)·건수·수락율만. 판매가/마진 키 없음(vendor-stats 보장).
  return NextResponse.json({
    range: { from: period.fromText, to: period.toText, presetKey: period.presetKey },
    stats,
  });
}
