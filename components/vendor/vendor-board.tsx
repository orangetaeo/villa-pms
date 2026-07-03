"use client";

// 원천 공급자 발주함 보드 (ADR-0023 S3 §6) — 발주함 | 예약현황 | 정산내역.
//   GET /api/vendor/orders 로드(클라 fetch — 수락/거절 후 즉시 재조회 필요).
//   ★ 누수: API가 costVnd(자기 지급액)만 내려줌. 판매가·마진·타 공급자 발주 없음.
//      추가 데이터 호출 금지 — 이 컴포넌트는 /api/vendor/orders shape만 사용.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import ListSearch from "@/components/list-search";
import PaginationBar from "@/components/pagination-bar";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

type VendorStatus = "PENDING_VENDOR" | "VENDOR_ACCEPTED" | "VENDOR_REJECTED" | null;

type VendorOrder = {
  id: string;
  villaName: string | null;
  villaAddress: string | null; // 이행 장소 주소(발주된 빌라만) — 지도 링크와 함께 표시
  checkIn: string | null;
  checkOut: string | null;
  serviceDate: string | null;
  serviceTime: string | null;
  itemName: string | null;
  optionLabel: string | null; // 선택 코스/옵션(가격 제거) — "오일 마사지 90분" 등
  type: string | null;
  quantity: number;
  guestCount: number | null; // 투숙 인원 — 카드에 아이콘으로 표시
  guestNote: string | null; // 게스트 요청사항(이행 정보) — 줄바꿈 허용 표시
  pickupAvailable: boolean; // 픽업 제공 품목 여부(카탈로그) — 뱃지 표시
  vendorStatus: VendorStatus;
  status: string;
  costVnd: string; // BigInt 문자열 — Number() 금지
  vendorSettledAt: string | null;
  vendorSettleMethod: SettleMethod; // 정산 수단(정산 완료 건)
  vendorSettleNote: string | null; // 정산 메모(정산 완료 건)
  poSentAt: string | null; // 발주 발송 시각(상태 타임라인)
  vendorRespondedAt: string | null; // 가부 응답 시각(상태 타임라인)
  vendorCompletedAt: string | null; // 서비스 이행 완료 보고 시각(null=미보고)
};

type SettleMethod = "CASH" | "BANK_TRANSFER" | "OTHER" | null;

type Tab = "inbox" | "schedule" | "settlement";

/** VND 점 구분 표기 (15.000.000₫). BigInt 문자열 정규식 — Number() 금지(정밀도 손실 방지) */
function formatVndDot(raw: string): string {
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped}₫`;
}

/** ISO 날짜 → "dd/MM" (UTC 자정 @db.Date). serviceDate/checkIn 표시용 */
function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/** ISO(UTC 타임스탬프) → "dd/MM/yyyy" — 정산일·발송일 등 전체 날짜 표시용 */
function formatFullDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** 정산 수단 라벨 키 (CASH→Tiền mặt 등) — i18n vendor.settle.method.* */
function settleMethodKey(m: SettleMethod): string | null {
  if (m === "CASH") return "settle.method.CASH";
  if (m === "BANK_TRANSFER") return "settle.method.BANK_TRANSFER";
  if (m === "OTHER") return "settle.method.OTHER";
  return null;
}

/** 발주 일정 라벨 — serviceDate 우선, 없으면 checkIn~checkOut */
function scheduleLabel(o: VendorOrder): string {
  if (o.serviceDate) {
    const day = formatDayMonth(o.serviceDate);
    return o.serviceTime ? `${day} ${o.serviceTime}` : day;
  }
  if (o.checkIn && o.checkOut) {
    return `${formatDayMonth(o.checkIn)} - ${formatDayMonth(o.checkOut)}`;
  }
  if (o.checkIn) return formatDayMonth(o.checkIn);
  return "—";
}

type SettleTotals = { pendingVnd: string; unsettledCount: number; paidVnd: string; settledCount: number };
type VendorData = {
  orders: VendorOrder[];
  total: number;
  inboxCount: number;
  cancelled?: VendorOrder[];
  settleTotals?: SettleTotals;
};

export default function VendorBoard() {
  const t = useTranslations("vendor");
  const [tab, setTab] = useState<Tab>("inbox");
  // 정산 서브탭(지급대기|지급완료) — 서버 조회를 유발하므로 부모로 리프트.
  const [settleSub, setSettleSub] = useState<"pending" | "paid">("pending");
  // 검색: 입력(즉시) → 디바운스 → search(서버 조회 트리거). 빌라·품목명 부분일치.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState<VendorData | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<VendorOrder | null>(null);
  const [proposeTarget, setProposeTarget] = useState<VendorOrder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 검색 디바운스(300ms) — 값이 바뀔 때만 반영 + 1페이지로.
  useEffect(() => {
    const tmr = setTimeout(() => {
      setSearch((prev) => (prev === searchInput ? prev : searchInput));
      if (searchInput) setPage(1);
    }, 300);
    return () => clearTimeout(tmr);
  }, [searchInput]);

  // 탭/서브/검색/페이지 변경 시 서버 조회(그 페이지만). 경쟁 응답은 최신 id만 반영.
  const reqId = useRef(0);
  useEffect(() => {
    const qs = new URLSearchParams();
    qs.set("tab", tab);
    if (tab === "settlement") qs.set("sub", settleSub);
    if (search.trim()) qs.set("search", search.trim());
    qs.set("page", String(page));
    qs.set("pageSize", String(pageSize));
    const id = ++reqId.current;
    setError(false);
    setFetching(true);
    fetch(`/api/vendor/orders?${qs.toString()}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json() as Promise<VendorData>;
      })
      .then((json) => {
        if (id === reqId.current) setData(json);
      })
      .catch(() => {
        if (id === reqId.current) setError(true);
      })
      .finally(() => {
        if (id === reqId.current) setFetching(false);
      });
  }, [tab, settleSub, search, page, pageSize, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  // 발주 응답 — action 일원화(accept|reject|propose). 완료 후 현재 화면 재조회.
  const respond = useCallback(
    async (
      order: VendorOrder,
      action: "accept" | "reject" | "propose",
      extra?: {
        rejectReason?: string;
        proposedServiceDate?: string;
        proposedServiceTime?: string;
        proposalNote?: string;
      }
    ) => {
      setBusyId(order.id);
      try {
        const res = await fetch(`/api/vendor/orders/${order.id}/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            rejectReason: extra?.rejectReason ?? null,
            proposedServiceDate: extra?.proposedServiceDate ?? null,
            proposedServiceTime: extra?.proposedServiceTime ?? null,
            proposalNote: extra?.proposalNote ?? null,
          }),
        });
        setRejectTarget(null);
        setProposeTarget(null);
        if (!res.ok && res.status !== 409) setError(true);
        // 409(이미 응답됨) 포함 — 어느 쪽이든 최신 상태로 재조회
        setRefreshKey((k) => k + 1);
      } catch {
        setError(true);
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  // 서비스 이행 완료 보고 — 확인 후 POST. 409(이미 보고됨) 포함 어느 쪽이든 재조회로 최신화.
  const complete = useCallback(
    async (order: VendorOrder) => {
      if (!window.confirm(t("complete.confirm"))) return;
      setBusyId(order.id);
      try {
        const res = await fetch(`/api/vendor/orders/${order.id}/complete`, { method: "POST" });
        if (!res.ok && res.status !== 409) setError(true);
        setRefreshKey((k) => k + 1);
      } catch {
        setError(true);
      } finally {
        setBusyId(null);
      }
    },
    [t]
  );

  const loading = data === null;
  const setPageSizeReset = (s: number) => {
    setPageSize(s);
    setPage(1);
  };

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 pb-28 pt-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold text-neutral-900">{t("title")}</h1>
          <p className="text-sm text-neutral-500">{t("subtitle")}</p>
        </div>
        {/* 통계 진입 — 서버 렌더 /vendor/stats (costVnd 기반 매출·발주 통계) */}
        <Link
          href="/vendor/stats"
          className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-teal-700 active:scale-95"
        >
          <span className="material-symbols-outlined text-base">bar_chart</span>
          {t("stats.title")}
        </Link>
      </header>

      {/* 탭 — 발주함 | 예약현황 | 정산 (라벨 3개, 한 화면 1작업) */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {(["inbox", "schedule", "settlement"] as const).map((key) => {
          const active = tab === key;
          const count = key === "inbox" ? data?.inboxCount ?? 0 : 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setPage(1);
              }}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "relative rounded-lg bg-white py-2 text-center text-sm font-bold text-teal-700 shadow-sm"
                  : "relative rounded-lg py-2 text-center text-sm font-medium text-slate-500"
              }
            >
              {t(`tab.${key}`)}
              {key === "inbox" && count > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 목록 검색 — 빌라명·품목명 부분일치 (라이트 테마). 서버 조회(디바운스). */}
      <ListSearch light value={searchInput} onChange={setSearchInput} placeholder={t("searchPlaceholder")} />

      {error && (
        <button
          type="button"
          onClick={reload}
          className="w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 active:scale-[0.99]"
        >
          {t("loadError")}
        </button>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-neutral-400">{t("loading")}</p>
      ) : data ? (
        <div className={fetching ? "space-y-5 opacity-60 transition-opacity" : "space-y-5 transition-opacity"}>
          {tab === "inbox" && (
            <InboxSection
              orders={data.orders}
              total={data.total}
              page={page}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={setPageSizeReset}
              busyId={busyId}
              t={t}
              onAccept={(o) => respond(o, "accept")}
              onReject={(o) => setRejectTarget(o)}
              onPropose={(o) => setProposeTarget(o)}
            />
          )}

          {tab === "schedule" && (
            <ScheduleSection
              orders={data.orders}
              cancelled={data.cancelled ?? []}
              total={data.total}
              page={page}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={setPageSizeReset}
              busyId={busyId}
              onComplete={complete}
              t={t}
            />
          )}

          {tab === "settlement" && (
            <SettlementSection
              rows={data.orders}
              total={data.total}
              page={page}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={setPageSizeReset}
              sub={settleSub}
              onSub={(s) => {
                setSettleSub(s);
                setPage(1);
              }}
              totals={data.settleTotals}
              t={t}
            />
          )}
        </div>
      ) : null}

      {/* 거절 사유 시트 */}
      {rejectTarget && (
        <RejectSheet
          order={rejectTarget}
          busy={busyId === rejectTarget.id}
          t={t}
          onCancel={() => setRejectTarget(null)}
          onConfirm={(reason) => respond(rejectTarget, "reject", { rejectReason: reason })}
        />
      )}

      {/* 일정 제안 시트 — 수락하되 대안 시간 제안 */}
      {proposeTarget && (
        <ProposeSheet
          order={proposeTarget}
          busy={busyId === proposeTarget.id}
          t={t}
          onCancel={() => setProposeTarget(null)}
          onConfirm={(date, time, note) =>
            respond(proposeTarget, "propose", {
              proposedServiceDate: date,
              proposedServiceTime: time || undefined,
              proposalNote: note || undefined,
            })
          }
        />
      )}
    </main>
  );
}

type T = ReturnType<typeof useTranslations<"vendor">>;

// 게스트 요청사항 — 이행에 필요하므로 truncate 없이 줄바꿈 허용(whitespace-pre-line).
function GuestNote({ note, t }: { note: string | null; t: T }) {
  if (!note) return null;
  return (
    <div className="flex items-start gap-1 rounded-lg bg-amber-50 px-2 py-1.5 text-sm text-amber-900">
      <span className="material-symbols-outlined text-base text-amber-500">sticky_note_2</span>
      <span className="min-w-0">
        <span className="font-semibold">{t("guestNote")}: </span>
        <span className="whitespace-pre-line break-words">{note}</span>
      </span>
    </div>
  );
}

// 이행 장소 주소 + 지도 링크 — 발주된 빌라 1채만(계약 A). 주소 없으면 표시 안 함.
function VillaAddress({ address, t }: { address: string | null; t: T }) {
  if (!address) return null;
  return (
    <p className="flex items-start gap-1 text-sm text-neutral-500">
      <span className="material-symbols-outlined mt-0.5 text-base text-neutral-400">location_on</span>
      <span className="min-w-0 break-words">
        {address}{" "}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap font-semibold text-teal-700 underline underline-offset-2"
        >
          {t("mapLink")}
        </a>
      </span>
    </p>
  );
}

// 픽업 제공 품목 뱃지 — 카탈로그 pickupAvailable=true일 때만.
function PickupBadge({ show, t }: { show: boolean; t: T }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-bold text-indigo-700">
      <span className="material-symbols-outlined text-sm">local_taxi</span>
      {t("pickupBadge")}
    </span>
  );
}

// 정원(투숙 인원) — 아이콘만(라벨 불필요). 0/null이면 표시 안 함.
function GuestCount({ count }: { count: number | null }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-sm text-neutral-500">
      <span className="material-symbols-outlined text-base text-neutral-400">group</span>
      {count}
    </span>
  );
}

// ── 발주함(받은 발주) ───────────────────────────────────────────────
function InboxSection({
  orders,
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  busyId,
  t,
  onAccept,
  onReject,
  onPropose,
}: {
  orders: VendorOrder[];
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
  busyId: string | null;
  t: T;
  onAccept: (o: VendorOrder) => void;
  onReject: (o: VendorOrder) => void;
  onPropose: (o: VendorOrder) => void;
}) {
  if (orders.length === 0) {
    return <EmptyState icon="inbox" title={t("empty.inbox")} hint={t("empty.inboxHint")} />;
  }
  return (
    <div className="space-y-3">
      {orders.map((o) => (
        <div
          key={o.id}
          className="space-y-3 rounded-2xl border-l-4 border-rose-400 bg-white p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="truncate text-base font-bold text-neutral-900">
                {o.itemName ?? "—"}
                <span className="ml-2 rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-bold text-teal-700">
                  ×{o.quantity}
                </span>
                <span className="ml-1.5">
                  <PickupBadge show={o.pickupAvailable} t={t} />
                </span>
              </h3>
              {o.optionLabel && (
                <p className="truncate text-sm font-semibold text-teal-700">{o.optionLabel}</p>
              )}
              {o.villaName && (
                <p className="flex items-center gap-1 text-sm text-neutral-600">
                  <span className="material-symbols-outlined text-base text-neutral-400">
                    home
                  </span>
                  {o.villaName}
                </p>
              )}
              <VillaAddress address={o.villaAddress} t={t} />
              <p className="flex items-center gap-2 text-sm text-neutral-600">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-base text-neutral-400">
                    event
                  </span>
                  {scheduleLabel(o)}
                </span>
                <GuestCount count={o.guestCount} />
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                {t("payLabel")}
              </p>
              <p className="text-lg font-extrabold text-teal-700">{formatVndDot(o.costVnd)}</p>
            </div>
          </div>

          {/* 게스트 요청사항 — 이행 정보(있을 때만) */}
          <GuestNote note={o.guestNote} t={t} />

          {/* 거절 / 제안 / 수락 — 버튼 3개. 제안=수락하되 대안 시간 협의(propose). */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={busyId === o.id}
              onClick={() => onReject(o)}
              className="rounded-xl border border-neutral-200 bg-white py-3 text-sm font-bold text-neutral-600 transition active:scale-95 disabled:opacity-50"
            >
              {t("reject")}
            </button>
            <button
              type="button"
              disabled={busyId === o.id}
              onClick={() => onPropose(o)}
              className="rounded-xl border border-blue-200 bg-blue-50 py-3 text-sm font-bold text-blue-700 transition active:scale-95 disabled:opacity-50"
            >
              {t("propose.button")}
            </button>
            <button
              type="button"
              disabled={busyId === o.id}
              onClick={() => onAccept(o)}
              className="rounded-xl bg-teal-600 py-3 text-sm font-bold text-white transition active:scale-95 disabled:opacity-50"
            >
              {busyId === o.id ? t("submitting") : t("accept")}
            </button>
          </div>
        </div>
      ))}
      <PaginationBar
        light
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={onPage}
        onPageSizeChange={onPageSize}
      />
    </div>
  );
}

// ── 예약 현황(수락한 발주 일정 + 취소된 발주 안내) ──────────────────
function ScheduleSection({
  orders,
  cancelled,
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  busyId,
  onComplete,
  t,
}: {
  orders: VendorOrder[];
  cancelled: VendorOrder[];
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
  busyId: string | null;
  onComplete: (o: VendorOrder) => void;
  t: T;
}) {
  if (orders.length === 0 && cancelled.length === 0) {
    return <EmptyState icon="event_available" title={t("empty.schedule")} hint={t("empty.scheduleHint")} />;
  }
  return (
    <div className="space-y-3">
      {/* 취소됨 — 이미 발주됐다가 운영자가 취소(이행 중단 안내). 상단 별도 표시. */}
      {cancelled.map((o) => (
        <div
          key={o.id}
          className="space-y-2 rounded-xl border-l-4 border-rose-400 bg-rose-50/60 p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="truncate font-bold text-neutral-700 line-through">
                {o.itemName ?? "—"}
                <span className="ml-2 text-sm font-semibold text-neutral-400">×{o.quantity}</span>
              </h3>
              {o.optionLabel && (
                <p className="truncate text-sm font-medium text-neutral-500">{o.optionLabel}</p>
              )}
              <p className="flex items-center gap-2 text-sm text-neutral-500">
                <span>
                  {o.villaName ? `${o.villaName} · ` : ""}
                  {scheduleLabel(o)}
                </span>
                <GuestCount count={o.guestCount} />
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">
              <span className="material-symbols-outlined text-base [font-variation-settings:'FILL'_1]">
                cancel
              </span>
              {t("status.cancelled")}
            </span>
          </div>
        </div>
      ))}

      {orders.map((o) => (
        <div
          key={o.id}
          className="space-y-2 rounded-xl border-l-4 border-teal-500 bg-white p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="truncate font-bold text-neutral-900">
                {o.itemName ?? "—"}
                <span className="ml-2 text-sm font-semibold text-neutral-500">×{o.quantity}</span>
              </h3>
              {o.optionLabel && (
                <p className="truncate text-sm font-medium text-neutral-600">{o.optionLabel}</p>
              )}
              {o.villaName && <p className="truncate text-sm text-neutral-500">{o.villaName}</p>}
              <VillaAddress address={o.villaAddress} t={t} />
              <p className="flex items-center gap-2 text-sm font-semibold text-teal-700">
                <span>{scheduleLabel(o)}</span>
                <GuestCount count={o.guestCount} />
                <PickupBadge show={o.pickupAvailable} t={t} />
              </p>
            </div>
            {/* 상태 칩 — 완료 보고 전엔 '수락됨', 보고 후엔 '이행 완료' */}
            {o.vendorCompletedAt ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                <span className="material-symbols-outlined text-base [font-variation-settings:'FILL'_1]">
                  flag_circle
                </span>
                {t("complete.done")}
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700">
                <span className="material-symbols-outlined text-base [font-variation-settings:'FILL'_1]">
                  check_circle
                </span>
                {t("status.accepted")}
              </span>
            )}
          </div>

          {/* 게스트 요청사항 — 이행 정보(있을 때만) */}
          <GuestNote note={o.guestNote} t={t} />

          {/* 상태 타임라인 — 발송·응답·완료 시각(작은 글씨) */}
          {(o.poSentAt || o.vendorRespondedAt || o.vendorCompletedAt) && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-400">
              {o.poSentAt && (
                <span>
                  {t("timeline.sent")}: {formatFullDate(o.poSentAt)}
                </span>
              )}
              {o.vendorRespondedAt && (
                <span>
                  {t("timeline.responded")}: {formatFullDate(o.vendorRespondedAt)}
                </span>
              )}
              {o.vendorCompletedAt && (
                <span>
                  {t("timeline.completed")}: {formatFullDate(o.vendorCompletedAt)}
                </span>
              )}
            </div>
          )}

          {/* 완료 보고 — 수락 건 중 미보고만. 보고는 되돌릴 수 없으므로 confirm 후 전송. */}
          {!o.vendorCompletedAt && (
            <button
              type="button"
              disabled={busyId === o.id}
              onClick={() => onComplete(o)}
              className="w-full rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-sm font-bold text-emerald-700 transition active:scale-[0.99] disabled:opacity-50"
            >
              {busyId === o.id ? t("submitting") : t("complete.button")}
            </button>
          )}
        </div>
      ))}
      <PaginationBar
        light
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={onPage}
        onPageSizeChange={onPageSize}
      />
    </div>
  );
}

// ── 정산 내역 (서버 페이지네이션) ────────────────────────────────────
function SettlementSection({
  rows,
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  sub,
  onSub,
  totals,
  t,
}: {
  rows: VendorOrder[];
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
  sub: "pending" | "paid";
  onSub: (s: "pending" | "paid") => void;
  totals?: SettleTotals;
  t: T;
}) {
  // 합계·건수는 서버 집계(totals). 목록은 서버 페이지(rows).
  const pendingTotal = totals?.pendingVnd ?? "0";
  const paidTotal = totals?.paidVnd ?? "0";
  const pendingCount = totals?.unsettledCount ?? 0;
  const paidCount = totals?.settledCount ?? 0;
  if (pendingCount === 0 && paidCount === 0) {
    return <EmptyState icon="payments" title={t("empty.settlement")} hint={t("empty.settlementHint")} />;
  }

  return (
    <div className="space-y-4">
      {/* 합계 카드 — VND만(우리 판매가·마진 없음). 대기·완료 나란히 요약 */}
      <section className="relative overflow-hidden rounded-2xl bg-teal-600 p-5 text-white shadow-xl">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-teal-500 opacity-20" />
        <div className="relative z-10 grid grid-cols-2 gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium text-teal-50 opacity-90">
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              {t("settle.pendingTotal")}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
              {formatVndDot(pendingTotal)}
            </h2>
          </div>
          <div className="border-l border-white/20 pl-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-teal-50 opacity-90">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {t("settle.paidTotal")}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-teal-50">
              {formatVndDot(paidTotal)}
            </h2>
          </div>
        </div>
      </section>

      {/* 세그먼트 필터 — 지급대기 | 지급완료 (건수 뱃지). 선택한 목록만 렌더. */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {(["pending", "paid"] as const).map((key) => {
          const isActive = sub === key;
          const count = key === "pending" ? pendingCount : paidCount;
          const label = key === "pending" ? t("settle.pendingTitle") : t("settle.paidTitle");
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSub(key)}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "rounded-lg bg-white py-2 text-center text-sm font-bold text-teal-700 shadow-sm"
                  : "rounded-lg py-2 text-center text-sm font-medium text-slate-500"
              }
            >
              {label}
              <span
                className={`ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ${
                  isActive
                    ? key === "pending"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                    : "bg-slate-200 text-slate-500"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
          {sub === "pending" ? t("settle.emptyPending") : t("settle.emptyPaid")}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((o) => (
            <SettleRow key={o.id} order={o} paid={sub === "paid"} t={t} />
          ))}
          <PaginationBar
            light
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={onPage}
            onPageSizeChange={onPageSize}
          />
        </div>
      )}
    </div>
  );
}

function SettleRow({ order, paid, t }: { order: VendorOrder; paid: boolean; t: T }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border-l-4 bg-white p-4 shadow-sm ${
        paid ? "border-emerald-500" : "border-slate-300"
      }`}
    >
      <div className="min-w-0 space-y-1">
        <h4 className="truncate font-bold text-neutral-900">
          {order.itemName ?? "—"}
          <span className="ml-2 text-sm font-semibold text-neutral-500">×{order.quantity}</span>
        </h4>
        {order.optionLabel && (
          <p className="truncate text-sm font-medium text-neutral-600">{order.optionLabel}</p>
        )}
        <p className="truncate text-sm text-slate-500">
          {order.villaName ? `${order.villaName} · ` : ""}
          {scheduleLabel(order)}
        </p>
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
            paid
              ? "bg-emerald-100 text-emerald-700"
              : "border border-slate-200 bg-slate-100 text-slate-500"
          }`}
        >
          {paid ? t("settle.paid") : t("settle.pending")}
        </span>
        {/* 정산 투명성 — 정산 완료 건의 수단·정산일·메모(자기 지급 내역) */}
        {paid && (
          <div className="space-y-0.5 text-[11px] text-slate-500">
            <p>
              {settleMethodKey(order.vendorSettleMethod)
                ? t(settleMethodKey(order.vendorSettleMethod)!)
                : ""}
              {order.vendorSettledAt
                ? `${order.vendorSettleMethod ? " · " : ""}${formatFullDate(order.vendorSettledAt)}`
                : ""}
            </p>
            {order.vendorSettleNote && (
              <p className="whitespace-pre-line break-words text-slate-400">
                {order.vendorSettleNote}
              </p>
            )}
          </div>
        )}
      </div>
      <p className={`shrink-0 text-lg font-bold ${paid ? "text-teal-700" : "text-slate-600"}`}>
        {formatVndDot(order.costVnd)}
      </p>
    </div>
  );
}

// ── 빈 상태 ────────────────────────────────────────────────────────
function EmptyState({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-white p-12 text-center shadow-sm">
      <span className="material-symbols-outlined text-5xl text-teal-600">{icon}</span>
      <p className="text-sm font-bold text-slate-700">{title}</p>
      <p className="text-sm text-slate-500">{hint}</p>
    </div>
  );
}

// ── 거절 사유 입력 시트 ────────────────────────────────────────────
function RejectSheet({
  order,
  busy,
  t,
  onCancel,
  onConfirm,
}: {
  order: VendorOrder;
  busy: boolean;
  t: T;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  // 자주 쓰는 거절 사유 — 누르면 textarea 채움(자유입력 유지). vi 기준 라벨은 i18n.
  const presetKeys = ["outOfStock", "scheduleClash", "outOfArea", "priceMismatch"] as const;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40">
      <div className="w-full max-w-md space-y-4 rounded-t-3xl bg-white p-5 pb-8 shadow-2xl">
        <div className="mx-auto h-1.5 w-12 rounded-full bg-neutral-200" />
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-neutral-900">{t("rejectSheet.title")}</h3>
          <p className="text-sm text-neutral-500">
            {order.itemName ?? "—"}
            {order.optionLabel ? ` · ${order.optionLabel}` : ""} ×{order.quantity} ·{" "}
            {scheduleLabel(order)}
          </p>
        </div>
        {/* 프리셋 칩 — 클릭 시 사유 채움 */}
        <div className="flex flex-wrap gap-2">
          {presetKeys.map((k) => {
            const text = t(`rejectPreset.${k}`);
            const active = reason === text;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setReason(text)}
                className={
                  active
                    ? "rounded-full bg-rose-100 px-3 py-1.5 text-sm font-semibold text-rose-700 active:scale-95"
                    : "rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-600 active:scale-95"
                }
              >
                {text}
              </button>
            );
          })}
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder={t("rejectSheet.placeholder")}
          className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-base text-neutral-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-neutral-200 bg-white py-3.5 text-base font-bold text-neutral-600 active:scale-95 disabled:opacity-50"
          >
            {t("rejectSheet.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-xl bg-rose-600 py-3.5 text-base font-bold text-white active:scale-95 disabled:opacity-50"
          >
            {busy ? t("submitting") : t("rejectSheet.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 일정 제안 입력 시트 (propose) ──────────────────────────────────
//   수락하되 대안 시간 제안. 날짜 필수·시각 선택·메모 선택. 투숙기간(checkIn~checkOut) 내로 권장.
function ProposeSheet({
  order,
  busy,
  t,
  onCancel,
  onConfirm,
}: {
  order: VendorOrder;
  busy: boolean;
  t: T;
  onCancel: () => void;
  onConfirm: (date: string, time: string, note: string) => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  // 날짜 입력 범위 — 투숙 체크인~체크아웃(있을 때). @db.Date는 UTC 자정 ISO라 앞 10자리로 절단.
  const dateMin = order.checkIn ? order.checkIn.slice(0, 10) : undefined;
  const dateMax = order.checkOut ? order.checkOut.slice(0, 10) : undefined;
  const canSubmit = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40">
      <div className="w-full max-w-md space-y-4 rounded-t-3xl bg-white p-5 pb-8 shadow-2xl [&_input]:scroll-mb-24">
        <div className="mx-auto h-1.5 w-12 rounded-full bg-neutral-200" />
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-neutral-900">{t("propose.title")}</h3>
          <p className="text-sm text-neutral-500">
            {order.itemName ?? "—"}
            {order.optionLabel ? ` · ${order.optionLabel}` : ""} ×{order.quantity} ·{" "}
            {scheduleLabel(order)}
          </p>
          <p className="text-xs text-neutral-400">{t("propose.hint")}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-neutral-500">{t("propose.dateLabel")}</label>
            <input
              type="date"
              value={date}
              min={dateMin}
              max={dateMax}
              onChange={(e) => setDate(e.target.value)}
              aria-label={t("propose.dateLabel")}
              className="mt-1 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base text-neutral-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500">{t("propose.timeLabel")}</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label={t("propose.timeLabel")}
              className="mt-1 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base text-neutral-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder={t("propose.notePlaceholder")}
          className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-base text-neutral-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-neutral-200 bg-white py-3.5 text-base font-bold text-neutral-600 active:scale-95 disabled:opacity-50"
          >
            {t("propose.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !canSubmit}
            onClick={() => onConfirm(date, time, note.trim())}
            className="rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white active:scale-95 disabled:opacity-50"
          >
            {busy ? t("submitting") : t("propose.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
