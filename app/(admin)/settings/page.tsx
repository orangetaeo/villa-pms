// /settings — 운영 설정 (T1.7, Stitch b8-settings 변환)
// RSC: prisma 직접 조회(시즌 목록·AppSetting). 폼·액션은 클라이언트 컴포넌트 + API fetch
// b8 구성: 시즌 달력 카드 + 예약 설정(홀드 시간) 카드. 환율 카드는 계약(T1.7) 요구로 동일 스타일 추가
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";
import { toDateOnlyString } from "@/lib/date-vn";
import { HOLD_HOURS_DEFAULT_KEY, DEFAULT_HOLD_HOURS } from "@/lib/hold";
import { FX_VND_PER_KRW_KEY } from "@/lib/pricing";
import SeasonManager, { type SeasonRow } from "./season-manager";
import HoldHoursForm from "./hold-hours-form";
import FxRateForm from "./fx-rate-form";

export const metadata: Metadata = {
  title: "설정 — Villa PMS",
};

export default async function SettingsPage() {
  const [t, periods, settings] = await Promise.all([
    getTranslations("adminSettings"),
    prisma.seasonPeriod.findMany({ orderBy: { startDate: "asc" } }),
    prisma.appSetting.findMany({
      where: { key: { in: [HOLD_HOURS_DEFAULT_KEY, FX_VND_PER_KRW_KEY] } },
    }),
  ]);

  // @db.Date → "YYYY-MM-DD" 직렬화 (클라이언트 경계, 시간대 오해 방지)
  const seasonRows: SeasonRow[] = periods.map((p) => ({
    id: p.id,
    season: p.season,
    startDate: toDateOnlyString(p.startDate),
    endDate: toDateOnlyString(p.endDate),
    label: p.label,
  }));

  const holdSetting = settings.find((s) => s.key === HOLD_HOURS_DEFAULT_KEY);
  const fxSetting = settings.find((s) => s.key === FX_VND_PER_KRW_KEY);

  // 홀드 시간 — 미설정/파싱 불가 시 기본 48 표시 (lib/hold DEFAULT_HOLD_HOURS)
  const parsedHold = holdSetting ? Number.parseInt(holdSetting.value, 10) : Number.NaN;
  const initialHoldHours =
    Number.isInteger(parsedHold) && parsedHold >= 1 && parsedHold <= 168
      ? parsedHold
      : DEFAULT_HOLD_HOURS;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* 페이지 타이틀 + 브레드크럼 (b8) */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t("title")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("subtitle")}</p>
        </div>
        <nav className="flex text-xs text-slate-500 gap-2 whitespace-nowrap">
          <span>{t("breadcrumbAdmin")}</span>
          <span>/</span>
          <span className="text-slate-300">{t("breadcrumbCurrent")}</span>
        </nav>
      </div>

      {/* Card 1: 시즌 달력 (b8) — 목록은 RSC 조회, 폼·액션은 클라이언트 */}
      <SeasonManager periods={seasonRows} />

      {/* Card 2: 예약 설정 — 가예약 기본 유지 시간 (b8 스테퍼) */}
      <HoldHoursForm initialHours={initialHoldHours} />

      {/* Card 3: 환율 — 계약(T1.7) 범위. b8에는 없어 동일 카드 스타일로 추가 */}
      <FxRateForm
        initialValue={fxSetting?.value ?? null}
        updatedAtText={fxSetting ? formatDateTime(fxSetting.updatedAt) : null}
      />
    </div>
  );
}
