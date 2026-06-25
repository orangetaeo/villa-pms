// /settings/minibar — 미니바 회사표준 품목 관리 (#2b, ADR-0016)
// RSC: MinibarItem 전체 조회((admin) 레이아웃 운영자 가드 하). 판매가 노출 화면이므로 canSetPrice 게이트.
//   전 빌라 공통 1세트(빌라별 오버라이드 없음). 테오가 여기서 품목·단가를 직접 입력한다.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { canSetPrice } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import MinibarManager, { type MinibarRow } from "./minibar-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminMinibar");
  return { title: `${t("title")} — Villa Go` };
}

export default async function MinibarSettingsPage() {
  const t = await getTranslations("adminMinibar");
  const session = await auth();

  // 판매가(고객 청구 단가) 노출 화면 — STAFF 차단(마진 비공개 경계). 그 외 운영자 허용.
  if (!canSetPrice(session?.user?.role)) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center text-slate-400">
        <span className="material-symbols-outlined text-5xl text-slate-600 mb-3 block">lock</span>
        <p className="font-bold">{t("forbidden")}</p>
      </div>
    );
  }

  const items = await prisma.minibarItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      nameKo: true,
      nameVi: true,
      unitPriceVnd: true,
      stockQty: true,
      sortOrder: true,
      active: true,
    },
  });
  const rows: MinibarRow[] = items.map((m) => ({
    id: m.id,
    nameKo: m.nameKo,
    nameVi: m.nameVi ?? "",
    unitPriceVnd: m.unitPriceVnd.toString(),
    stockQty: m.stockQty,
    sortOrder: m.sortOrder,
    active: m.active,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-8">
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

      <MinibarManager initialItems={rows} />
    </div>
  );
}
