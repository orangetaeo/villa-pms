// /settings/complex-areas — 지역(단지) 마스터 CRUD (ADR-0046, T-complex-area-master)
//   단일 원천 = ComplexArea. Villa.complex는 이 마스터 name의 비정규화 캐시.
//   RSC: prisma 직접 조회(비활성 포함 전체 + 연결 빌라 수). 목록 GET API는 active만 주므로,
//     관리자 CRUD 목록은 여기서 직접 조회한다(vendors 페이지 미러). 변경은 API(POST/PATCH) 경유.
//   권한: isOperator(재무 아님 — 단지명은 마진·재고 아님). 생성/수정/토글 전부 서버 AuditLog.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isOperator } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import ComplexAreasManager, { type ComplexAreaRow } from "./complex-areas-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminComplexAreas");
  return { title: `${t("title")} — Villa Go` };
}

export default async function ComplexAreasPage() {
  const t = await getTranslations("adminComplexAreas");
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

  // 비활성 포함 전체 목록 + 연결 빌라 수(비정규화 캐시 정합 참고용). sortOrder→name 정렬(목록·드롭다운 동일).
  const areas = await prisma.complexArea.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      nameKo: true,
      code: true,
      active: true,
      sortOrder: true,
      _count: { select: { villas: true } },
    },
  });

  const rows: ComplexAreaRow[] = areas.map((a) => ({
    id: a.id,
    name: a.name,
    nameKo: a.nameKo ?? "",
    code: a.code,
    active: a.active,
    sortOrder: a.sortOrder,
    villaCount: a._count.villas,
  }));

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t("title")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("subtitle")}</p>
        </div>
        <nav className="flex text-xs text-slate-500 gap-2 whitespace-nowrap">
          <span>{t("breadcrumbSettings")}</span>
          <span>/</span>
          <span className="text-slate-300">{t("breadcrumbCurrent")}</span>
        </nav>
      </div>

      <ComplexAreasManager initialAreas={rows} />
    </div>
  );
}
