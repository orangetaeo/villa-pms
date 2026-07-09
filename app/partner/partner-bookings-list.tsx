"use client";

// 파트너 예약 현황 목록 — 서버 페이지네이션 (T-partner-scale 1).
//   검색(q)·기간(from/to)·page/pageSize는 URL이 단일 진실 — 서버(page.tsx)가 where/skip/take로 조회.
//   이 컴포넌트는 현재 페이지 rows만 받아 렌더 + URL 갱신만 한다(전량로드·클라 slice 제거, PR #165 패턴).
//   ★ 누수: roomCharge(VND 청구액)만 — totalSaleKrw·원가·마진 없음(서버 select에서 이미 차단).
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import PaginationBar from "@/components/pagination-bar";
import ListSearch from "@/components/list-search";
import { DateField } from "@/components/date-field";
import { formatVillaName } from "@/lib/villa-name";
import type { PartnerBookingRow } from "@/lib/partner-portal";
import { formatVndDot, formatDayMonth } from "./_format";

const STATUS_STYLE: Record<string, string> = {
  HOLD: "bg-amber-100 text-amber-700",
  CONFIRMED: "bg-teal-100 text-teal-700",
  CHECKED_IN: "bg-blue-100 text-blue-700",
  CHECKED_OUT: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-neutral-100 text-neutral-500",
  EXPIRED: "bg-neutral-100 text-neutral-500",
  NO_SHOW: "bg-rose-100 text-rose-700",
};

export default function PartnerBookingsList({
  bookings,
  total,
  page,
  pageSize,
  dateFrom,
  dateTo,
}: {
  /** 현재 페이지 rows (서버 where/skip/take 결과) */
  bookings: PartnerBookingRow[];
  total: number;
  page: number;
  pageSize: number;
  dateFrom: string; // "" = 미설정
  dateTo: string;
}) {
  const t = useTranslations("partner");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 기간 필터 URL 갱신 — 변경 시 page 제거(1페이지 리셋). ListSearch(URL 모드)와 동일 규칙.
  const setDateParam = (key: "from" | "to", value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  };
  const clearDates = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("from");
    next.delete("to");
    next.delete("page");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  };

  return (
    <>
      <div className="mb-3 space-y-2">
        {/* 검색 — URL 모드(q 파라미터·디바운스·page 리셋은 ListSearch가 처리) */}
        <ListSearch
          light
          placeholder={t("bookings.searchPlaceholder")}
          className="max-w-xs"
        />
        {/* 날짜(기간) 검색 — 투숙기간이 범위와 겹치는 예약만(서버 where) */}
        <div className="flex items-center gap-2">
          <DateField
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateParam("from", e.target.value)}
            aria-label={t("bookings.dateFrom")}
            placeholder={t("bookings.datePlaceholder")}
            placeholderClassName="text-neutral-400"
            wrapperClassName="min-w-0 flex-1"
            className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm text-neutral-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <span className="shrink-0 text-sm text-neutral-400">~</span>
          <DateField
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateParam("to", e.target.value)}
            aria-label={t("bookings.dateTo")}
            placeholder={t("bookings.datePlaceholder")}
            placeholderClassName="text-neutral-400"
            wrapperClassName="min-w-0 flex-1"
            className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm text-neutral-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={clearDates}
              aria-label={t("bookings.dateClear")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-neutral-700"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          )}
        </div>
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 bg-white p-6 text-center text-sm text-neutral-400">
          {t("bookings.noMatch")}
        </div>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => {
            const statusStyle = STATUS_STYLE[b.status] ?? "bg-neutral-100 text-neutral-500";
            return (
              <li key={b.id}>
                <Link
                  href={`/partner/bookings/${b.id}`}
                  className="block rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm transition-transform active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h2 className="truncate font-bold text-neutral-900">
                        {formatVillaName({ name: b.villaName, nameVi: b.villaNameVi })}
                      </h2>
                      {/* 연장(분할숙박) 묶음 표시 — 자식이면 "연장 예약", 부모면 자식 수 (ADR-0030) */}
                      {(b.isExtension || b.extensionCount > 0) && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600">
                          <span className="material-symbols-outlined text-xs">link</span>
                          {b.isExtension
                            ? t("bookings.extensionChild")
                            : t("bookings.extensionParent", { count: b.extensionCount })}
                        </span>
                      )}
                      {b.villaComplex && (
                        <p className="truncate text-xs text-neutral-400">{b.villaComplex}</p>
                      )}
                      <p className="text-sm text-neutral-500">
                        {formatDayMonth(b.checkIn)} – {formatDayMonth(b.checkOut)} ·{" "}
                        {t("bookings.nights", { count: b.nights })}
                      </p>
                      <p className="text-sm text-neutral-600">
                        {b.guestName} · {t("bookings.guests", { count: b.guestCount })}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${statusStyle}`}
                    >
                      {t(`status.${b.status}`)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
                    <span className="text-xs font-medium text-neutral-400">
                      {t("bookings.roomCharge")}
                    </span>
                    <span className="text-base font-bold text-teal-700">
                      {formatVndDot(b.roomChargeVnd)}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* URL 모드 페이지네이션 — page/pageSize 파라미터 갱신(서버 skip/take 기준 total) */}
      {total > 0 && <PaginationBar light total={total} page={page} pageSize={pageSize} />}
    </>
  );
}
