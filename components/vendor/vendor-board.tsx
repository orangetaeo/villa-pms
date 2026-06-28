"use client";

// 원천 공급자 발주함 보드 (ADR-0023 S3 §6) — 발주함 | 예약현황 | 정산내역.
//   GET /api/vendor/orders 로드(클라 fetch — 수락/거절 후 즉시 재조회 필요).
//   ★ 누수: API가 costVnd(자기 지급액)만 내려줌. 판매가·마진·타 공급자 발주 없음.
//      추가 데이터 호출 금지 — 이 컴포넌트는 /api/vendor/orders shape만 사용.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import ListSearch from "@/components/list-search";
import PaginationBar from "@/components/pagination-bar";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

type VendorStatus = "PENDING_VENDOR" | "VENDOR_ACCEPTED" | "VENDOR_REJECTED" | null;

type VendorOrder = {
  id: string;
  villaName: string | null;
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
  vendorStatus: VendorStatus;
  status: string;
  costVnd: string; // BigInt 문자열 — Number() 금지
  vendorSettledAt: string | null;
  vendorSettleMethod: SettleMethod; // 정산 수단(정산 완료 건)
  vendorSettleNote: string | null; // 정산 메모(정산 완료 건)
  poSentAt: string | null; // 발주 발송 시각(상태 타임라인)
  vendorRespondedAt: string | null; // 가부 응답 시각(상태 타임라인)
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

/** BigInt 문자열 합산 (Number 금지) */
function sumVnd(values: string[]): string {
  return values.reduce((acc, v) => acc + BigInt(v || "0"), 0n).toString();
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

export default function VendorBoard() {
  const t = useTranslations("vendor");
  const [orders, setOrders] = useState<VendorOrder[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("inbox");
  // 목록 검색어 (빌라명·품목명·옵션 라벨 부분일치) — 클라 인메모리 필터
  const [search, setSearch] = useState("");
  // 거절 사유 시트 대상 발주 id (null=닫힘)
  const [rejectTarget, setRejectTarget] = useState<VendorOrder | null>(null);
  // 일정 제안 시트 대상 발주 (null=닫힘)
  const [proposeTarget, setProposeTarget] = useState<VendorOrder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/vendor/orders", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { orders: VendorOrder[] };
      setOrders(data.orders);
    } catch {
      setError(true);
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 발주 응답 — action 일원화(accept|reject|propose). respond API는 action 스키마.
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
        // 409 NOT_PENDING(이미 응답됨) 포함 — 어느 쪽이든 최신 상태로 재조회
        await load();
        setRejectTarget(null);
        setProposeTarget(null);
        if (!res.ok && res.status !== 409) {
          setError(true);
        }
      } catch {
        setError(true);
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  // 섹션별 분류 — 검색(빌라명·품목명·옵션 라벨 부분일치)을 먼저 적용해 모든 탭이 동일하게 필터됨
  const q = search.trim().toLowerCase();
  const all = (orders ?? []).filter((o) => {
    if (!q) return true;
    return [o.villaName, o.itemName, o.optionLabel].some(
      (field) => field?.toLowerCase().includes(q)
    );
  });
  // ★운영자가 취소(status=CANCELLED)한 발주는 인박스(가부)·정산 대상에서 제외한다.
  //   단 "이미 발주됐던"(poSentAt 있음) 취소 건은 예약현황 상단에 '취소됨' 배지로 인앱 노출
  //   — 이행 중단을 공급자가 알아야 함(기존엔 모든 탭에서 사라져 알 수 없던 결함).
  const inbox = all.filter((o) => o.vendorStatus === "PENDING_VENDOR" && o.status !== "CANCELLED");
  const cancelled = all
    .filter((o) => o.status === "CANCELLED" && o.poSentAt != null)
    .sort((a, b) => scheduleSortKey(a) - scheduleSortKey(b));
  const accepted = all
    .filter((o) => o.vendorStatus === "VENDOR_ACCEPTED" && o.status !== "CANCELLED")
    .sort((a, b) => scheduleSortKey(a) - scheduleSortKey(b));
  // 정산 내역 = 수락/이행된 발주(우리가 지급할 대상). 거절·대기·취소 제외.
  const settleable = all.filter((o) => o.vendorStatus === "VENDOR_ACCEPTED" && o.status !== "CANCELLED");
  const settled = settleable.filter((o) => o.vendorSettledAt);
  const unsettled = settleable.filter((o) => !o.vendorSettledAt);

  const loading = orders === null;

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 pb-28 pt-16">
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
          const count = key === "inbox" ? inbox.length : 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
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

      {/* 목록 검색 — 빌라명·품목명·옵션 라벨 부분일치 (라이트 테마) */}
      <ListSearch light value={search} onChange={setSearch} placeholder={t("searchPlaceholder")} />

      {loading ? (
        <p className="py-12 text-center text-sm text-neutral-400">{t("loading")}</p>
      ) : (
        <>
          {error && (
            <button
              type="button"
              onClick={() => void load()}
              className="w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 active:scale-[0.99]"
            >
              {t("loadError")}
            </button>
          )}

          {tab === "inbox" && (
            <InboxSection
              orders={inbox}
              busyId={busyId}
              t={t}
              onAccept={(o) => respond(o, "accept")}
              onReject={(o) => setRejectTarget(o)}
              onPropose={(o) => setProposeTarget(o)}
            />
          )}

          {tab === "schedule" && (
            <ScheduleSection orders={accepted} cancelled={cancelled} t={t} />
          )}

          {tab === "settlement" && (
            <SettlementSection unsettled={unsettled} settled={settled} t={t} />
          )}
        </>
      )}

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

function scheduleSortKey(o: VendorOrder): number {
  const iso = o.serviceDate ?? o.checkIn;
  return iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER;
}

// 클라 controlled 페이지네이션(라이트 포털 목록, M5) — 발주함·예약현황·정산 목록이 길어도(예: 발주 79건)
// 한 화면에 한 페이지만 렌더. 검색으로 매 렌더 새 배열이 와도 safePage 클램프로 안전(불필요 리셋 없음).
function usePaged<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );
  const onPageSizeChange = (s: number) => {
    setPageSize(s);
    setPage(1);
  };
  return { paged, page: safePage, pageSize, setPage, setPageSize: onPageSizeChange };
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
  busyId,
  t,
  onAccept,
  onReject,
  onPropose,
}: {
  orders: VendorOrder[];
  busyId: string | null;
  t: T;
  onAccept: (o: VendorOrder) => void;
  onReject: (o: VendorOrder) => void;
  onPropose: (o: VendorOrder) => void;
}) {
  const { paged, page, pageSize, setPage, setPageSize } = usePaged(orders);
  if (orders.length === 0) {
    return <EmptyState icon="inbox" title={t("empty.inbox")} hint={t("empty.inboxHint")} />;
  }
  return (
    <div className="space-y-3">
      {paged.map((o) => (
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
        total={orders.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}

// ── 예약 현황(수락한 발주 일정 + 취소된 발주 안내) ──────────────────
function ScheduleSection({
  orders,
  cancelled,
  t,
}: {
  orders: VendorOrder[];
  cancelled: VendorOrder[];
  t: T;
}) {
  const { paged, page, pageSize, setPage, setPageSize } = usePaged(orders);
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

      {paged.map((o) => (
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
              <p className="flex items-center gap-2 text-sm font-semibold text-teal-700">
                <span>{scheduleLabel(o)}</span>
                <GuestCount count={o.guestCount} />
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700">
              <span className="material-symbols-outlined text-base [font-variation-settings:'FILL'_1]">
                check_circle
              </span>
              {t("status.accepted")}
            </span>
          </div>

          {/* 게스트 요청사항 — 이행 정보(있을 때만) */}
          <GuestNote note={o.guestNote} t={t} />

          {/* 상태 타임라인 — 발송·응답 시각(작은 글씨) */}
          {(o.poSentAt || o.vendorRespondedAt) && (
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
            </div>
          )}
        </div>
      ))}
      <PaginationBar
        light
        total={orders.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}

// ── 정산 내역 ──────────────────────────────────────────────────────
function SettlementSection({
  unsettled,
  settled,
  t,
}: {
  unsettled: VendorOrder[];
  settled: VendorOrder[];
  t: T;
}) {
  const u = usePaged(unsettled);
  const s = usePaged(settled);
  if (unsettled.length === 0 && settled.length === 0) {
    return <EmptyState icon="payments" title={t("empty.settlement")} hint={t("empty.settlementHint")} />;
  }
  const pendingTotal = sumVnd(unsettled.map((o) => o.costVnd));
  const paidTotal = sumVnd(settled.map((o) => o.costVnd));

  return (
    <div className="space-y-5">
      {/* 합계 카드 — VND만(우리 판매가·마진 없음) */}
      <section className="relative overflow-hidden rounded-2xl bg-teal-600 p-6 text-white shadow-xl">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-teal-500 opacity-20" />
        <div className="relative z-10 space-y-4">
          <div>
            <p className="text-sm font-medium text-teal-50 opacity-90">{t("settle.pendingTotal")}</p>
            <h2 className="mt-1 text-4xl font-extrabold tracking-tight">
              {formatVndDot(pendingTotal)}
            </h2>
          </div>
          <div className="h-px w-full bg-white/20" />
          <div className="flex items-center gap-1.5 text-xs font-medium text-teal-50">
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>
              {t("settle.paidTotal")}: {formatVndDot(paidTotal)}
            </span>
          </div>
        </div>
      </section>

      {unsettled.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-700">{t("settle.pendingTitle")}</h3>
          <div className="space-y-2">
            {u.paged.map((o) => (
              <SettleRow key={o.id} order={o} paid={false} t={t} />
            ))}
          </div>
          <PaginationBar
            light
            total={unsettled.length}
            page={u.page}
            pageSize={u.pageSize}
            onPageChange={u.setPage}
            onPageSizeChange={u.setPageSize}
          />
        </div>
      )}

      {settled.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-700">{t("settle.paidTitle")}</h3>
          <div className="space-y-2">
            {s.paged.map((o) => (
              <SettleRow key={o.id} order={o} paid t={t} />
            ))}
          </div>
          <PaginationBar
            light
            total={settled.length}
            page={s.page}
            pageSize={s.pageSize}
            onPageChange={s.setPage}
            onPageSizeChange={s.setPageSize}
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
