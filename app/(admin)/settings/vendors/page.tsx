// /settings/vendors — 원천 공급자(ServiceVendor) 관리 (ADR-0023 S1)
// RSC: ServiceVendor 전체 조회((admin) 레이아웃 운영자 가드 하). /settings/services 미러.
//   ★ 정산계좌(bankInfo)는 canViewFinance만 — select·직렬화 모두에서 제외(showBank).
//   CRUD는 canSetPrice(OWNER/MANAGER) → canEdit. STAFF는 읽기 전용.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isOperator, canViewFinance, canSetPrice } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import VendorsManager, { type VendorRow } from "./vendors-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminVendors");
  return { title: `${t("title")} — Villa Go` };
}

export default async function VendorsPage() {
  const t = await getTranslations("adminVendors");
  const session = await auth();
  const role = session?.user?.role;

  if (!isOperator(role)) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center text-slate-400">
        <span className="material-symbols-outlined text-5xl text-slate-600 mb-3 block">lock</span>
        <p className="font-bold">{t("forbidden")}</p>
      </div>
    );
  }

  const showBank = canViewFinance(role);
  const canEdit = canSetPrice(role);

  // bankInfo(정산계좌)는 canViewFinance만 — select에서부터 제외(클라 조건부 렌더 의존 금지, 원칙2)
  const [vendors, inProgressGroups] = await Promise.all([
    prisma.serviceVendor.findMany({
      // 승인대기(PENDING_APPROVAL)를 최상단으로 — 운영자가 먼저 처리하도록.
      orderBy: [{ approvalStatus: "asc" }, { active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        nameKo: true,
        phone: true,
        zaloUserId: true,
        note: true,
        active: true,
        userId: true,
        approvalStatus: true,
        rejectionReason: true,
        _count: { select: { catalogItems: true } },
        ...(showBank ? { bankInfo: true } : {}),
      },
    }),
    // 진행 중 발주 건수(admin-vendor-ops E) — 발주대기·수락 + 미취소 + 미정산. 건수만(금액 없음).
    prisma.serviceOrder.groupBy({
      by: ["vendorId"],
      where: {
        vendorStatus: { in: ["PENDING_VENDOR", "VENDOR_ACCEPTED"] },
        status: { not: "CANCELLED" },
        vendorSettledAt: null,
      },
      _count: true,
    }),
  ]);
  const inProgressByVendor = new Map(
    inProgressGroups
      .filter((g): g is typeof g & { vendorId: string } => g.vendorId != null)
      .map((g) => [g.vendorId, g._count])
  );

  const rows: VendorRow[] = vendors.map((v) => ({
    id: v.id,
    name: v.name,
    nameKo: v.nameKo ?? "",
    phone: v.phone ?? "",
    zaloUserId: v.zaloUserId ?? "",
    note: v.note ?? "",
    active: v.active,
    hasAccount: v.userId != null,
    approvalStatus: v.approvalStatus,
    rejectionReason: v.rejectionReason ?? "",
    catalogCount: v._count.catalogItems,
    inProgressCount: inProgressByVendor.get(v.id) ?? 0,
    ...(showBank && "bankInfo" in v
      ? { bankInfo: parseBankInfo((v as { bankInfo: unknown }).bankInfo) }
      : {}),
  }));

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors mb-3"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          {t("back")}
        </Link>
        <h1 className="text-2xl font-bold text-white tracking-tight">{t("title")}</h1>
        <p className="text-sm text-slate-500 mt-1">{t("subtitle")}</p>
      </div>

      <VendorsManager initialVendors={rows} showBank={showBank} canEdit={canEdit} />
    </div>
  );
}

// bankInfo JSON 안전 파싱 — {bank,account,holder} 문자열 3필드(아니면 빈값)
function parseBankInfo(raw: unknown): { bank: string; account: string; holder: string } {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return {
      bank: typeof o.bank === "string" ? o.bank : "",
      account: typeof o.account === "string" ? o.account : "",
      holder: typeof o.holder === "string" ? o.holder : "",
    };
  }
  return { bank: "", account: "", holder: "" };
}
