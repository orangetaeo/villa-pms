"use client";

// 파트너 예약 현황 목록 — 검색(빌라명·게스트명) + controlled 페이지네이션(라이트).
//   서버(page.tsx)가 자기 partnerId 스코프로 조회한 전체 목록을 props로 받아 클라에서 표시 슬라이스만 한다.
//   ★ 누수: roomCharge(VND 청구액)만 — totalSaleKrw·원가·마진 없음(서버 select에서 이미 차단).
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import PaginationBar from "@/components/pagination-bar";
import ListSearch from "@/components/list-search";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
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
}: {
  bookings: PartnerBookingRow[];
}) {
  const t = useTranslations("partner");

  // 검색(부분일치) — 빌라명(병기)·단지·게스트명 + 날짜(기간) 필터. 표시 필터(데이터 경계 변경 없음).
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(""); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState("");
  const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10); // @db.Date(UTC) → YYYY-MM-DD
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      // 텍스트
      if (q) {
        const villa = formatVillaName({ name: b.villaName, nameVi: b.villaNameVi }).toLowerCase();
        const complex = (b.villaComplex ?? "").toLowerCase();
        const guest = b.guestName.toLowerCase();
        if (!(villa.includes(q) || complex.includes(q) || guest.includes(q))) return false;
      }
      // 날짜(기간 겹침) — 투숙기간 [checkIn, checkOut]이 [from, to]와 겹치면 표시
      if (dateFrom && ymd(b.checkOut) < dateFrom) return false;
      if (dateTo && ymd(b.checkIn) > dateTo) return false;
      return true;
    });
  }, [bookings, search, dateFrom, dateTo]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => setPage(1), [bookings, search, dateFrom, dateTo]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  // 빈 상태(전체 0건)는 부모에서 안내 — 여기는 목록이 있을 때만 렌더
  return (
    <>
      <div className="mb-3 space-y-2">
        <ListSearch
          light
          placeholder={t("bookings.searchPlaceholder")}
          value={search}
          onChange={setSearch}
          className="max-w-xs"
        />
        {/* 날짜(기간) 검색 — 투숙기간이 범위와 겹치는 예약만 */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label={t("bookings.dateFrom")}
            className="h-10 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm text-neutral-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <span className="shrink-0 text-sm text-neutral-400">~</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label={t("bookings.dateTo")}
            className="h-10 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm text-neutral-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              aria-label={t("bookings.dateClear")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-neutral-700"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 bg-white p-6 text-center text-sm text-neutral-400">
          {t("bookings.noMatch")}
        </div>
      ) : (
        <ul className="space-y-3">
          {paged.map((b) => {
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

      {filtered.length > 0 && (
        <PaginationBar
          light
          total={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      )}
    </>
  );
}
