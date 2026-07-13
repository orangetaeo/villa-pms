// /settings/holidays — 공휴일 캘린더 관리 (ADR-0042, ADMIN 전용)
// 전역 날짜 목록(한국·베트남 공용, 빌라 무관). 프리미엄 박 판정의 공휴일 축 — "어느 박이 프리미엄인가"만
// 답한다(얼마인가는 빌라 요율표 premium* 컬럼). RSC: 초기 연도(올해) 목록만 조회, 이후 연도 전환·추가·삭제는
// 클라이언트가 /api/admin/holidays 로 처리. 권한: isSystemAdmin(설정 페이지와 동일 등급).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isSystemAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString } from "@/lib/date-vn";
import HolidayManager, { type HolidayRow } from "./holiday-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSettings.holidays");
  return { title: `${t("title")} — Villa Go` };
}

export default async function HolidaysPage() {
  // 첫 줄 권한 검사 — 설정 페이지와 동일 등급(OWNER/ADMIN). 그 외 운영자는 404(존재 미누설).
  const session = await auth();
  if (!isSystemAdmin(session?.user?.role)) notFound();

  const t = await getTranslations("adminSettings.holidays");
  const currentYear = new Date().getUTCFullYear();

  const holidays = await prisma.holidayDate.findMany({
    where: {
      date: {
        gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
        lt: new Date(`${currentYear + 1}-01-01T00:00:00.000Z`),
      },
    },
    orderBy: { date: "asc" },
    select: { id: true, date: true, label: true },
  });
  const initialRows: HolidayRow[] = holidays.map((h) => ({
    id: h.id,
    date: toDateOnlyString(h.date),
    label: h.label,
  }));

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t("title")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("subtitle")}</p>
        </div>
      </div>
      <HolidayManager initialYear={currentYear} initialRows={initialRows} />
    </div>
  );
}
