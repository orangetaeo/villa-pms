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
import { getFxVndPerKrw } from "@/lib/pricing";
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
  // 환율(1 KRW당 VND) — KRW 미리보기용. 미설정이면 null → 클라에서 미리보기 생략.
  const fx = await getFxVndPerKrw(prisma);

  // 원가는 canViewFinance만 — select에서부터 제외(클라 조건부 렌더 의존 금지, 원칙2)
  // ADR-0023 — 카탈로그 폼의 원천 공급자 셀렉트용 활성 공급자 목록(id·name만)
  const [items, vendors] = await Promise.all([
    prisma.serviceCatalogItem.findMany({
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        type: true,
        nameKo: true,
        nameI18n: true,
        descKo: true,
        descI18n: true,
        unitLabelKo: true,
        priceVnd: true,
        photoUrl: true,
        options: true,
        active: true,
        sortOrder: true,
        vendorId: true,
        audiences: true,
        ...(showCost ? { costVnd: true } : {}),
      },
    }),
    prisma.serviceVendor.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // BigInt → 문자열 직렬화(클라 경계). costVnd는 showCost일 때만 포함. 가격은 VND 단일통화.
  const rows: CatalogRow[] = items.map((it) => ({
    id: it.id,
    type: it.type,
    nameKo: it.nameKo,
    nameI18n: it.nameI18n ?? null,
    descKo: it.descKo ?? "",
    descI18n: it.descI18n ?? null,
    unitLabelKo: it.unitLabelKo ?? "",
    priceVnd: it.priceVnd?.toString() ?? null,
    photoUrl: it.photoUrl ?? "",
    options: it.options ?? null,
    active: it.active,
    sortOrder: it.sortOrder,
    vendorId: it.vendorId ?? null,
    audiences: normalizeAudiences(it.audiences),
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

      <ServiceCatalogManager
        initialItems={rows}
        vendors={vendors}
        showCost={showCost}
        canEdit={canEdit}
        fx={fx}
      />
    </div>
  );
}

// audiences JSON → ("ADMIN"|"PARTNER"|"GUEST")[] 정규화. ADMIN은 항상 포함(운영자 늘 요청 가능).
function normalizeAudiences(raw: unknown): ("ADMIN" | "PARTNER" | "GUEST")[] {
  const allowed = ["ADMIN", "PARTNER", "GUEST"] as const;
  const set = new Set<string>(["ADMIN"]);
  if (Array.isArray(raw)) {
    for (const a of raw) if (typeof a === "string" && (allowed as readonly string[]).includes(a)) set.add(a);
  }
  return allowed.filter((a) => set.has(a));
}
