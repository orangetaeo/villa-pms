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

  // 검색(부분일치) — 빌라명(병기) + 게스트명. 표시 필터(데이터 경계 변경 없음).
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bookings;
    return bookings.filter((b) => {
      const villa = formatVillaName({ name: b.villaName, nameVi: b.villaNameVi }).toLowerCase();
      const complex = (b.villaComplex ?? "").toLowerCase();
      const guest = b.guestName.toLowerCase();
      return villa.includes(q) || complex.includes(q) || guest.includes(q);
    });
  }, [bookings, search]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => setPage(1), [bookings, search]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  // 빈 상태(전체 0건)는 부모에서 안내 — 여기는 목록이 있을 때만 렌더
  return (
    <>
      <div className="mb-3">
        <ListSearch
          light
          placeholder={t("bookings.searchPlaceholder")}
          value={search}
          onChange={setSearch}
          className="max-w-xs"
        />
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
