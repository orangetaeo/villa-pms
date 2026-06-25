// /settings/services — 서비스 카탈로그 관리 (ADR-0019 S2, Stitch b19 변환)
// RSC: ServiceCatalogItem 전체 조회((admin) 레이아웃 운영자 가드 하).
//   ★ 마진 비공개: 매입원가(costVnd)·마진은 canViewFinance만 — select·직렬화 모두에서 제외(STAFF엔 미전달).
//   CRUD는 canSetPrice(OWNER/MANAGER) — 클라에 canEdit 전달, STAFF는 읽기 전용.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isOperator, canViewFinance, canSetPrice } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import ServiceCatalogManager, { type CatalogRow } from "./catalog-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminServices");
  return { title: `${t("title")} — Villa Go` };
}

export default async function ServiceCatalogPage() {
  const t = await getTranslations("adminServices");
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

  const showCost = canViewFinance(role);
  const canEdit = canSetPrice(role);

  // 원가는 canViewFinance만 — select에서부터 제외(클라 조건부 렌더 의존 금지, 원칙2)
  const items = await prisma.serviceCatalogItem.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      type: true,
      nameKo: true,
      nameVi: true,
      nameEn: true,
      descKo: true,
      descVi: true,
      unitLabelKo: true,
      priceKrw: true,
      priceVnd: true,
      photoUrl: true,
      options: true,
      active: true,
      sortOrder: true,
      ...(showCost ? { costVnd: true } : {}),
    },
  });

  // BigInt → 문자열 직렬화(클라 경계). costVnd는 showCost일 때만 포함.
  const rows: CatalogRow[] = items.map((it) => ({
    id: it.id,
    type: it.type,
    nameKo: it.nameKo,
    nameVi: it.nameVi ?? "",
    nameEn: it.nameEn ?? "",
    descKo: it.descKo ?? "",
    descVi: it.descVi ?? "",
    unitLabelKo: it.unitLabelKo ?? "",
    priceKrw: it.priceKrw ?? null,
    priceVnd: it.priceVnd?.toString() ?? null,
    photoUrl: it.photoUrl ?? "",
    options: it.options ?? null,
    active: it.active,
    sortOrder: it.sortOrder,
    ...(showCost && "costVnd" in it
      ? { costVnd: (it as { costVnd: bigint | null }).costVnd?.toString() ?? null }
      : {}),
  }));

  return (
    <div className="max-w-6xl mx-auto space-y-8">
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

      <ServiceCatalogManager initialItems={rows} showCost={showCost} canEdit={canEdit} />
    </div>
  );
}
