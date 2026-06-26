// /inventory — 미니바 실재고 현황 (ADR-0019 S1, b18) · 운영자 다크 화면
// RSC: (admin) 레이아웃 운영자 가드 + 미들웨어 이중 보호 아래에서만 렌더.
//   현재고는 MinibarStockMovement 원장 ΣqtyDelta로 산출(캐시 없음). par=오버라이드 ?? 회사표준.
//   ★ 마진 비공개(원칙2): 현황 표엔 원가 컬럼 없음. 매입 단가는 입고 폼에서만(canViewFinance만 입력칸 노출).
import type { Metadata } from "next";
import { getTranslations, getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { isOperator, canViewFinance, canSetPrice, type Role } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadInventoryMatrix } from "@/lib/minibar-inventory-load";
import InventoryTabs from "./inventory-tabs";
import type { MinibarRow } from "./minibar-manager";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: `${t("title")} — Villa Go` };
}

export default async function InventoryPage() {
  const [session, t, locale] = await Promise.all([
    auth(),
    getTranslations("inventory"),
    getLocale(),
  ]);
  const role = session?.user?.role as Role | undefined;

  // 운영자 전용 — 레이아웃/미들웨어가 이미 막지만 페이지에서도 게이트(이중)
  if (!isOperator(role)) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center text-slate-400">
        <span className="material-symbols-outlined text-5xl text-slate-600 mb-3 block">lock</span>
        <p className="font-bold">{t("title")}</p>
      </div>
    );
  }

  // 매입 단가는 canViewFinance만 — 서버에서 입력칸 노출 여부를 결정(클라 조건부 렌더 아님).
  const showCost = canViewFinance(role);
  // 미니바 품목 관리(회사표준 CRUD) 탭은 가격 설정 권한(OWNER/MANAGER)만 — 판매가·입고가 노출.
  const canManageItems = canSetPrice(role);

  const { rows, summary } = await loadInventoryMatrix(prisma, locale);

  // 품목 관리 탭용 회사표준 목록 — 권한자만 조회(판매가·입고가 BigInt→문자열).
  let minibarItems: MinibarRow[] = [];
  if (canManageItems) {
    const items = await prisma.minibarItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        nameKo: true,
        unitPriceVnd: true,
        costVnd: true,
        stockQty: true,
        sortOrder: true,
        active: true,
      },
    });
    minibarItems = items.map((m) => ({
      id: m.id,
      nameKo: m.nameKo,
      unitPriceVnd: m.unitPriceVnd.toString(),
      costVnd: m.costVnd?.toString() ?? null,
      stockQty: m.stockQty,
      sortOrder: m.sortOrder,
      active: m.active,
    }));
  }

  // 입고 폼 셀렉트 옵션 — 빌라(중복 제거, 표시순) / 품목(중복 제거, 표시순)
  const villaOptions: { id: string; name: string }[] = [];
  const seenVilla = new Set<string>();
  const itemOptions: { id: string; label: string }[] = [];
  const seenItem = new Set<string>();
  for (const r of rows) {
    if (!seenVilla.has(r.villaId)) {
      seenVilla.add(r.villaId);
      villaOptions.push({ id: r.villaId, name: r.villaName });
    }
    if (!seenItem.has(r.minibarItemId)) {
      seenItem.add(r.minibarItemId);
      itemOptions.push({ id: r.minibarItemId, label: r.itemLabel });
    }
  }

  return (
    <InventoryTabs
      rows={rows}
      summary={summary}
      villaOptions={villaOptions}
      itemOptions={itemOptions}
      showCost={showCost}
      minibarItems={minibarItems}
      canManageItems={canManageItems}
    />
  );
}
