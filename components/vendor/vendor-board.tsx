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
import { DateField } from "@/components/date-field";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { resolveQuickRange, addDateOnlyDays } from "@/lib/date-vn";

// 원탭 칩용 날짜 범위 — resolveQuickRange는 반개구간 [from, to)를 주므로,
//   API가 양끝 포함(from ≤ serviceDate ≤ to)이라 끝을 하루 당겨 inclusive로 맞춘다.
//   VN(Asia/Ho_Chi_Minh) 기준 — 기기 타임존과 무관하게 벤더 현지 날짜로 계산.
function chipRange(key: "today" | "thisWeek"): { from: string; to: string } {
  const r = resolveQuickRange(key)!; // 반개구간
  return { from: r.from, to: addDateOnlyDays(r.to, -1) };
}

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
  // ★무료 티켓(판매가 0) — 서버 파생 boolean. true면 발행 UI 대신 "무료 입장" 안내(판매가 값은 미노출).
  freeEntry: boolean;
  ticketUrls: string[]; // 티켓형(TICKET) 발행 이미지 URL — 발행 현황·삭제용(판매가 무관)
  // TICKET 전용 — 이용자(이름·생년월일·신장)만. 연령/신장 구분 티켓 발행·현장 검표용(ADR-0036).
  //   ★그 외 여권 필드 없음(서버 화이트리스트). 비TICKET 응답엔 키 자체가 없음(optional).
  //   ★주문 스냅샷만(전체명단 폴백 제거) — 비면 빈 배열 → "이용자 미지정" 안내.
  guests?: { name: string | null; birthDate: string | null; heightCm?: number | null }[];
  quantity: number;
  guestCount: number | null; // 투숙 인원 — 카드에 아이콘으로 표시
  customerName: string | null; // 이용자 이름(주문 스냅샷 또는 예약 대표자 폴백) — 응대 대상 식별용(이름만)
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
  // 시간 제안(propose) 현황(ADR-0035) — 본인 스코프(판매가 무관)
  proposedServiceDate: string | null; // 제안 날짜(ISO @db.Date)
  proposedServiceTime: string | null; // 제안 시각("HH:MM")
  vendorProposalNote: string | null; // 제안 메모(내 사유)
  vendorProposalRespondedAt: string | null; // 해결 시각(null=고객 응답 대기)
  vendorProposalOutcome: string | null; // "APPLIED"|"DECLINED"|"DISMISSED"|null
};

type SettleMethod = "CASH" | "BANK_TRANSFER" | "OTHER" | null;

type Tab = "inbox" | "proposal" | "schedule" | "settlement";

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

/** 여권 생년월일 "YYYY-MM-DD" → "dd/MM/yyyy" 단순 재배치(타임존 변환 금지 — 날짜 문자열 그대로 조립).
 *  null·불량 형식이면 "—"·원문 그대로 표시(모델 OCR 원천이라 방어적). */
function formatBirthDate(raw: string | null): string {
  if (!raw) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
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
  proposalPendingCount: number; // 시간제안 탭 미해결(고객 응답 대기) 뱃지용
  cancelled?: VendorOrder[];
  settleTotals?: SettleTotals;
};

export default function VendorBoard({ ticketOnly = false }: { ticketOnly?: boolean }) {
  const t = useTranslations("vendor");
  const [tab, setTab] = useState<Tab>("inbox");
  // 정산 서브탭(지급대기|지급완료) — 서버 조회를 유발하므로 부모로 리프트.
  const [settleSub, setSettleSub] = useState<"pending" | "paid">("pending");
  // 검색: 입력(즉시) → 디바운스 → search(서버 조회 트리거). 빌라·품목명 부분일치.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // 날짜 필터(serviceDate 기준, 양끝 포함) — 4탭 공통 상태(탭 전환해도 유지). "" = 미적용.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // 품목(티켓 분류) 필터 — 4탭 공통 상태. "" = 전체 품목. 마운트 시 1회 로드하는 셀렉트 옵션 소스.
  const [itemId, setItemId] = useState("");
  const [catalogItems, setCatalogItems] = useState<{ id: string; name: string }[]>([]);
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
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (itemId) qs.set("itemId", itemId);
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
  }, [tab, settleSub, search, from, to, itemId, page, pageSize, refreshKey]);

  // 품목 필터 옵션 — 마운트 시 1회 로드(본인 품목 id·이름만). 실패 시 빈 배열 → 셀렉트 미노출.
  useEffect(() => {
    fetch("/api/vendor/catalog-items", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ items: { id: string; name: string }[] }>) : null))
      .then((json) => {
        if (json?.items) setCatalogItems(json.items);
      })
      .catch(() => {
        /* 옵션 로드 실패는 조용히 무시 — 필터만 안 뜰 뿐 목록은 정상 */
      });
  }, []);

  // 품목 필터 변경 — 항상 1페이지로. "" = 전체 품목.
  const onItemChange = useCallback((v: string) => {
    setItemId(v);
    setPage(1);
  }, []);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  // 현재 from/to가 어느 칩과 일치하는지 판정(값 비교) — 수동 날짜 변경 시 칩 자동 해제.
  const activeChip: "today" | "thisWeek" | "all" | null =
    !from && !to
      ? "all"
      : from === chipRange("today").from && to === chipRange("today").to
        ? "today"
        : from === chipRange("thisWeek").from && to === chipRange("thisWeek").to
          ? "thisWeek"
          : null; // 커스텀 범위 — 활성 칩 없음

  // 필터 변경은 항상 1페이지로 리셋. 칩=범위 세팅, 전체=해제.
  const applyChip = useCallback((key: "today" | "thisWeek" | "all") => {
    if (key === "all") {
      setFrom("");
      setTo("");
    } else {
      const r = chipRange(key);
      setFrom(r.from);
      setTo(r.to);
    }
    setPage(1);
  }, []);
  const onFromChange = useCallback((v: string) => {
    setFrom(v);
    setPage(1);
  }, []);
  const onToChange = useCallback((v: string) => {
    setTo(v);
    setPage(1);
  }, []);

  // 시간제안 APPLIED 카드 → 완료보고 동선: 예약현황 탭 + 해당 주문 serviceDate로 단일일 필터.
  //   47페이지 뒤에 묻히지 않고 1페이지에 바로 보이게 한다(계약 배경).
  const goComplete = useCallback((o: VendorOrder) => {
    const d = o.serviceDate ? o.serviceDate.slice(0, 10) : "";
    setTab("schedule");
    setFrom(d);
    setTo(d);
    setPage(1);
  }, []);

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

      {/* 탭 — 일반: 발주함 | 시간제안 | 예약현황 | 정산(4탭).
          티켓 전용 벤더(ticketOnly): 시간 협의가 무의미하므로 시간제안 탭 숨김 → 발주함 | 예약현황 | 정산(3탭).
          Tailwind는 정적 문자열로 분기(동적 조립 금지 — JIT 프리즈). */}
      {/* 코치마크 앵커 — 즉시 렌더되는 탭만(카드는 비동기 fetch라 앵커 금지).
          리터럴 맵: tests/tour-onboarding.test.ts 앵커 실존 검사가 소스 문자열로 찾는다(4개 그대로 유지). */}
      <div
        className={
          ticketOnly
            ? "grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1"
            : "grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1"
        }
      >
        {(ticketOnly
          ? (["inbox", "schedule", "settlement"] as const)
          : (["inbox", "proposal", "schedule", "settlement"] as const)
        ).map((key) => {
          const active = tab === key;
          const count =
            key === "inbox"
              ? data?.inboxCount ?? 0
              : key === "proposal"
                ? data?.proposalPendingCount ?? 0
                : 0;
          const tourAnchor = {
            inbox: "vendor-tab-inbox",
            proposal: "vendor-tab-proposal",
            schedule: "vendor-tab-schedule",
            settlement: "vendor-tab-settlement",
          }[key];
          return (
            <button
              key={key}
              type="button"
              data-tour={tourAnchor}
              onClick={() => {
                setTab(key);
                setPage(1);
              }}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "relative rounded-lg bg-white py-2 text-center text-xs font-bold text-teal-700 shadow-sm"
                  : "relative rounded-lg py-2 text-center text-xs font-medium text-slate-500"
              }
            >
              {t(`tab.${key}`)}
              {(key === "inbox" || key === "proposal") && count > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 날짜 필터 행 — serviceDate 기준(양끝 포함). 4탭 공통·탭 전환 유지.
          ⚠raw input type=date 금지 → DateField(iOS 빈값 공백박스 함정). 원탭 칩 우선(텍스트 입력 최소화). */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <DateField
            value={from}
            max={to || undefined}
            onChange={(e) => onFromChange(e.target.value)}
            aria-label={t("dateFilter.start")}
            placeholder={t("dateFilter.start")}
            wrapperClassName="min-w-0 flex-1"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-neutral-900 focus-within:border-teal-400"
          />
          <span className="shrink-0 text-neutral-400">–</span>
          <DateField
            value={to}
            min={from || undefined}
            onChange={(e) => onToChange(e.target.value)}
            aria-label={t("dateFilter.end")}
            placeholder={t("dateFilter.end")}
            wrapperClassName="min-w-0 flex-1"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-neutral-900 focus-within:border-teal-400"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["today", "thisWeek", "all"] as const).map((key) => {
            const active = activeChip === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => applyChip(key)}
                className={
                  active
                    ? "rounded-full bg-teal-600 px-3.5 py-1.5 text-sm font-bold text-white active:scale-95"
                    : "rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-500 active:scale-95"
                }
              >
                {t(`dateFilter.${key}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* 품목(티켓 분류) 필터 — "빈사파리만" 처럼 분류별 조회. 품목 2종 미만이면 미노출(선택 의미 없음).
          4탭 공통·탭 전환 유지. 변경 시 1페이지로. */}
      {catalogItems.length >= 2 && (
        <select
          value={itemId}
          onChange={(e) => onItemChange(e.target.value)}
          aria-label={t("itemFilter.label")}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-neutral-900 focus-within:border-teal-400"
        >
          <option value="">{t("itemFilter.all")}</option>
          {catalogItems.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
            </option>
          ))}
        </select>
      )}

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
              onChanged={reload}
            />
          )}

          {tab === "proposal" && (
            <ProposalSection
              orders={data.orders}
              total={data.total}
              page={page}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={setPageSizeReset}
              onGoComplete={goComplete}
              t={t}
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
              onChanged={reload}
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

// 이용자 이름 — 응대 대상 식별용(이름만). 있을 때만 person 아이콘과 함께 표시. ★전화 등 다른 PII 없음.
function CustomerName({ name, t }: { name: string | null; t: T }) {
  if (!name) return null;
  return (
    <p className="flex items-center gap-1 text-sm text-neutral-600">
      <span className="material-symbols-outlined text-base text-neutral-400">person</span>
      <span className="font-semibold">{t("customerName")}:</span>
      <span className="min-w-0 truncate">{name}</span>
    </p>
  );
}

// 정원(투숙 인원) — 아이콘만(라벨 불필요). 0/null이면 표시 안 함.
//   ★TICKET 주문은 숨김 — 티켓은 발행 수량(quantity)이 기준이라 투숙 인원이 옆에 있으면
//     "그 수만큼 발행해야 하나"로 오독된다(테오 리포트 2026-07-11).
function GuestCount({ count, orderType }: { count: number | null; orderType: string | null }) {
  if (orderType === "TICKET") return null;
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-sm text-neutral-500">
      <span className="material-symbols-outlined text-base text-neutral-400">group</span>
      {count}
    </span>
  );
}

// 티켓 업로드/삭제 오류 코드 → i18n 라벨
function ticketErrLabel(code: string | undefined, t: T): string {
  switch (code) {
    case "TOO_MANY_TICKETS":
      return t("tickets.errTooMany");
    case "INVALID_TYPE":
      return t("tickets.errType");
    case "FILE_TOO_LARGE":
      return t("tickets.errSize");
    case "NO_FILES":
      return t("tickets.errNoFiles");
    default:
      return t("tickets.uploadError");
  }
}

// 투숙객 여권 정보(이름·생년월일) — 연령 구분(차일드/어덜트/시니어) 티켓 발행용(ADR-0036).
//   원천=체크인 확정본. ★이름·생년월일만 — 여권번호·국적·성별 등은 서버가 내려주지 않음(화이트리스트).
//   체크인 전(guests 빈 배열/undefined)엔 안내 문구. 연령 판단은 업체 몫 — 우리는 표기만.
function GuestPassports({ guests, t }: { guests: VendorOrder["guests"]; t: T }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white/70 p-2.5">
      <p className="flex items-center gap-1 text-xs font-bold text-slate-600">
        <span className="material-symbols-outlined text-sm text-slate-400">badge</span>
        {t("tickets.passportTitle")}
      </p>
      {guests && guests.length > 0 ? (
        <ul className="space-y-0.5">
          {guests.map((g, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-neutral-700">
              <span className="min-w-0 truncate font-medium">{g.name ?? "—"}</span>
              <span className="shrink-0 text-neutral-300">·</span>
              <span className="shrink-0 tabular-nums text-neutral-500">{formatBirthDate(g.birthDate)}</span>
              {/* 신장은 소비자 자가신고(시스템 검증 불가) — "신고" 뉘앙스로 표기, 현장 검표 근거(ADR-0036 개정) */}
              {typeof g.heightCm === "number" && (
                <>
                  <span className="shrink-0 text-neutral-300">·</span>
                  <span className="shrink-0 tabular-nums text-amber-600">{t("tickets.heightDeclared", { cm: g.heightCm })}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">{t("tickets.passportEmpty")}</p>
      )}
    </div>
  );
}

// ── 무료 티켓 안내 (ADR-0034 §3-1) ───────────────────────────────────
//   무료 입장 티켓(판매가 0)은 QR 발행·제시가 불필요하므로 발행 패널(TicketPanel)을 렌더하지 않고,
//   대신 정보성 안내만 보여준다. 발행 버튼·수량 카운터·투숙객 명단 없음.
function FreeEntryNotice({ t }: { t: T }) {
  return (
    <p className="flex items-center gap-1.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-700">
      <span className="material-symbols-outlined text-base">confirmation_number</span>
      {t("tickets.freeEntry")}
    </p>
  );
}

// ── 티켓형(TICKET) QR 티켓 발행 패널 (ADR-0034) ─────────────────────────
//   발행된 티켓 썸네일(탭=원본 새 탭) + "N/quantity장" 카운터(미달 amber 경고) + 발행 버튼 + 삭제(x).
//   PENDING_VENDOR면 "발행 시 수락 처리" 안내. 업로드/삭제 후 onChanged로 목록 재조회.
//   ★ 판매가·마진 없음 — ticketUrls는 발행 이미지 URL일 뿐.
function TicketPanel({
  order,
  pending,
  t,
  onChanged,
}: {
  order: VendorOrder;
  pending: boolean; // vendorStatus === PENDING_VENDOR
  t: T;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const issued = order.ticketUrls.length;
  const needed = order.quantity;
  const short = issued < needed;
  // 이행완료·취소 발주는 발행/삭제 불가(서버 가드와 동일).
  const closed = order.status === "CANCELLED" || order.status === "DELIVERED";

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetch(`/api/vendor/orders/${order.id}/tickets`, { method: "POST", body: fd });
      if (!res.ok) {
        let code: string | undefined;
        try {
          code = (await res.json())?.error;
        } catch {
          /* noop */
        }
        setErr(ticketErrLabel(code, t));
      } else {
        onChanged();
      }
    } catch {
      setErr(t("tickets.uploadError"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (url: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/vendor/orders/${order.id}/tickets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        let code: string | undefined;
        try {
          code = (await res.json())?.error;
        } catch {
          /* noop */
        }
        setErr(ticketErrLabel(code, t));
      } else {
        onChanged();
      }
    } catch {
      setErr(t("tickets.uploadError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-sm font-bold text-indigo-700">
          <span className="material-symbols-outlined text-base">confirmation_number</span>
          {t("tickets.title")}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
            short ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {t("tickets.counter", { issued, needed })}
        </span>
      </div>

      {short && (
        <p className="text-xs font-medium text-amber-600">{t("tickets.shortWarn")}</p>
      )}
      {pending && !closed && (
        <p className="text-xs text-indigo-600">{t("tickets.acceptHint")}</p>
      )}

      {/* 투숙객 여권(이름·생년월일) — 연령 구분 티켓 발행 참고용(ADR-0036) */}
      <GuestPassports guests={order.guests} t={t} />

      {issued > 0 && (
        <div className="flex flex-wrap gap-2">
          {order.ticketUrls.map((url) => (
            <div key={url} className="relative">
              <a href={url} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={t("tickets.title")}
                  className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
                />
              </a>
              {!closed && (
                <button
                  type="button"
                  onClick={() => remove(url)}
                  disabled={busy}
                  aria-label={t("tickets.remove")}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white shadow disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {err && <p className="text-xs font-medium text-rose-600">{err}</p>}

      {!closed && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            aria-label={t("tickets.upload")}
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white active:scale-95 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">upload</span>
            {busy ? t("tickets.uploading") : t("tickets.upload")}
          </button>
        </>
      )}
    </div>
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
  onChanged,
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
  onChanged: () => void;
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
              <CustomerName name={o.customerName} t={t} />
              <p className="flex items-center gap-2 text-sm text-neutral-600">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-base text-neutral-400">
                    event
                  </span>
                  {scheduleLabel(o)}
                </span>
                <GuestCount count={o.guestCount} orderType={o.type} />
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                {t("payLabel")}
              </p>
              <p className="text-lg font-extrabold text-teal-700">{formatVndDot(o.costVnd)}</p>
            </div>
          </div>

          {/* 게스트가 시간 제안을 거절 → 발주함 복귀(ADR-0035). 아직 재응답 전(PENDING_VENDOR)일 때만 안내.
              재수락되면 이 카드는 발주함에서 사라지므로 사실상 미해소 상태에서만 노출되지만, 방어적으로 조건 명시. */}
          {o.vendorProposalOutcome === "DECLINED" && o.vendorStatus === "PENDING_VENDOR" && (
            <p className="flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1.5 text-xs font-bold text-rose-700">
              <span className="material-symbols-outlined text-base text-rose-500">history</span>
              {t("proposalTab.declinedInbox")}
            </p>
          )}

          {/* 게스트 요청사항 — 이행 정보(있을 때만) */}
          <GuestNote note={o.guestNote} t={t} />

          {/* 티켓형(TICKET) — 무료 입장은 발행 불필요 안내, 유료는 발행 패널(발행하면 수락 겸행, ADR-0034) */}
          {o.type === "TICKET" &&
            (o.freeEntry ? (
              <FreeEntryNotice t={t} />
            ) : (
              <TicketPanel order={o} pending={o.vendorStatus === "PENDING_VENDOR"} t={t} onChanged={onChanged} />
            ))}

          {/* 거절 / 제안 / 수락 버튼. 제안=수락하되 대안 시간 협의(propose).
              ★TICKET 주문은 시간 협의가 무의미 → "제안" 버튼 숨김(주문 type 기준, 벤더 종류 무관 —
                혼합 판매 업체의 티켓 주문에도 적용). 서버 respond도 TICKET propose를 400으로 거부(대칭).
              ★TICKET 미수락 발주(ADR-0034 개정: 발행 수량 충족 시 자동 수락)는 발행 0장일 때만 "수락" 버튼을
                숨긴다 — 위 TicketPanel "발행"으로 유도. 발행 ≥1장(주문 수량 미달 포함)이면 수락 버튼 노출:
                확인시트 1장으로 전원 커버하는 현실(ADR-0034 수량 비강제)을 위한 수동 수락 경로.
              → TICKET+PENDING_VENDOR+0장이면 남는 버튼은 거절 1개. 표시 버튼 수에 맞춰 grid-cols 정적 매핑. */}
          {(() => {
            const hidePropose = o.type === "TICKET";
            // ★무료 티켓(freeEntry)은 발행이 없으므로 발행 유도용 숨김을 적용하지 않고 수락 버튼을 일반 노출한다
            //   (게스트 무료 주문은 자동 확정이라 발주함에 안 오지만, 운영자 수동 발주 엣지 대비).
            const hideAccept =
              o.type === "TICKET" &&
              !o.freeEntry &&
              o.vendorStatus === "PENDING_VENDOR" &&
              o.ticketUrls.length === 0;
            // 거절(항상) + 제안(비티켓) + 수락(비TICKET-대기) → 표시 수. 동적 조립 금지(정적 매핑).
            const visibleCount = 1 + (hidePropose ? 0 : 1) + (hideAccept ? 0 : 1);
            const gridCls =
              visibleCount === 1
                ? "grid grid-cols-1 gap-2"
                : visibleCount === 2
                  ? "grid grid-cols-2 gap-2"
                  : "grid grid-cols-3 gap-2";
            return (
              <div className={gridCls}>
                <button
                  type="button"
                  disabled={busyId === o.id}
                  onClick={() => onReject(o)}
                  className="rounded-xl border border-neutral-200 bg-white py-3 text-sm font-bold text-neutral-600 transition active:scale-95 disabled:opacity-50"
                >
                  {t("reject")}
                </button>
                {!hidePropose && (
                  <button
                    type="button"
                    disabled={busyId === o.id}
                    onClick={() => onPropose(o)}
                    className="rounded-xl border border-blue-200 bg-blue-50 py-3 text-sm font-bold text-blue-700 transition active:scale-95 disabled:opacity-50"
                  >
                    {t("propose.button")}
                  </button>
                )}
                {!hideAccept && (
                  <button
                    type="button"
                    disabled={busyId === o.id}
                    onClick={() => onAccept(o)}
                    className="rounded-xl bg-teal-600 py-3 text-sm font-bold text-white transition active:scale-95 disabled:opacity-50"
                  >
                    {busyId === o.id ? t("submitting") : t("accept")}
                  </button>
                )}
              </div>
            );
          })()}
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

// ── 시간 제안 현황(내가 propose한 발주) ─────────────────────────────
//   미해결="고객 응답 대기"(amber) / APPLIED="수락됨"(emerald) / DECLINED="고객 거절"(red) / DISMISSED="미적용"(slate).
//   ★ 판매가·마진 없음 — 일정 협의 현황만(costVnd도 미표기: 이 탭은 정산이 아니라 추적용).
function ProposalStatusBadge({ order, t }: { order: VendorOrder; t: T }) {
  const resolved = order.vendorProposalRespondedAt != null;
  if (!resolved) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
        <span className="material-symbols-outlined text-base">hourglass_top</span>
        {t("proposalTab.pending")}
      </span>
    );
  }
  // ★거절(DECLINED)은 아직 재응답 전(PENDING_VENDOR)일 때만 red "고객 거절". 벤더가 원래 시간으로
  //   재수락하면 vendorStatus가 바뀌므로(PENDING_VENDOR 아님) slate "거절 후 해소"로 톤 다운(경고 아님).
  const declinedResolved =
    order.vendorProposalOutcome === "DECLINED" && order.vendorStatus !== "PENDING_VENDOR";
  const map: Record<string, { cls: string; icon: string; key: string }> = {
    APPLIED: { cls: "bg-emerald-100 text-emerald-700", icon: "check_circle", key: "proposalTab.applied" },
    DECLINED: declinedResolved
      ? { cls: "bg-slate-100 text-slate-500", icon: "history", key: "proposalTab.declinedResolved" }
      : { cls: "bg-rose-100 text-rose-700", icon: "cancel", key: "proposalTab.declined" },
    DISMISSED: { cls: "bg-slate-100 text-slate-500", icon: "block", key: "proposalTab.dismissed" },
  };
  const m = map[order.vendorProposalOutcome ?? ""] ?? map.DISMISSED;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${m.cls}`}>
      <span className="material-symbols-outlined text-base">{m.icon}</span>
      {t(m.key)}
    </span>
  );
}

/** 제안 시각(ISO @db.Date + HH:MM) → "dd/MM HH:MM". 제안 날짜 없으면 "—". */
function proposedLabel(o: VendorOrder): string {
  if (!o.proposedServiceDate) return "—";
  const day = formatDayMonth(o.proposedServiceDate);
  return o.proposedServiceTime ? `${day} ${o.proposedServiceTime}` : day;
}

function ProposalSection({
  orders,
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  onGoComplete,
  t,
}: {
  orders: VendorOrder[];
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
  onGoComplete: (o: VendorOrder) => void;
  t: T;
}) {
  if (orders.length === 0) {
    return <EmptyState icon="update" title={t("empty.proposal")} hint={t("empty.proposalHint")} />;
  }
  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const resolved = o.vendorProposalRespondedAt != null;
        return (
          <div
            key={o.id}
            className={`space-y-2 rounded-2xl border-l-4 bg-white p-4 shadow-sm ${
              resolved ? "border-slate-300" : "border-amber-400"
            }`}
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
              </div>
              <ProposalStatusBadge order={o} t={t} />
            </div>

            {/* 원래 시간 → 제안 시간 비교 */}
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-neutral-400 line-through tabular-nums">{scheduleLabel(o)}</span>
              <span className="material-symbols-outlined text-base text-amber-500">arrow_forward</span>
              <span className="font-bold text-amber-700 tabular-nums">{proposedLabel(o)}</span>
            </div>

            {/* 제안 메모(내 사유) */}
            {o.vendorProposalNote && (
              <p className="flex items-start gap-1 text-xs text-neutral-500">
                <span className="material-symbols-outlined text-sm text-neutral-400">sticky_note_2</span>
                <span className="min-w-0 whitespace-pre-line break-words">{o.vendorProposalNote}</span>
              </p>
            )}

            {/* 수락됨(APPLIED) → 완료보고 동선. 이미 완료보고했으면 표시만, 아니면 예약현황으로 점프 버튼.
                DECLINED/미해결 카드에는 버튼 없음(수락된 건만 이행·완료보고 대상). */}
            {o.vendorProposalOutcome === "APPLIED" &&
              (o.vendorCompletedAt ? (
                <p className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                  <span className="material-symbols-outlined text-base [font-variation-settings:'FILL'_1]">
                    flag_circle
                  </span>
                  {t("complete.done")}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => onGoComplete(o)}
                  className="flex w-full items-center justify-center gap-1 rounded-xl border border-teal-200 bg-teal-50 py-3 text-sm font-bold text-teal-700 transition active:scale-[0.99]"
                >
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                  {t("proposalTab.goComplete")}
                </button>
              ))}
          </div>
        );
      })}
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
  onChanged,
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
  onChanged: () => void;
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
                <GuestCount count={o.guestCount} orderType={o.type} />
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
              <CustomerName name={o.customerName} t={t} />
              <p className="flex items-center gap-2 text-sm font-semibold text-teal-700">
                <span>{scheduleLabel(o)}</span>
                <GuestCount count={o.guestCount} orderType={o.type} />
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

          {/* 티켓형(TICKET) — 무료 입장은 발행 불필요 안내, 유료는 발행 패널(수락 후 발행분 확인·추가·삭제, ADR-0034) */}
          {o.type === "TICKET" &&
            (o.freeEntry ? (
              <FreeEntryNotice t={t} />
            ) : (
              <TicketPanel order={o} pending={false} t={t} onChanged={onChanged} />
            ))}

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
            <DateField
              value={date}
              min={dateMin}
              max={dateMax}
              onChange={(e) => setDate(e.target.value)}
              aria-label={t("propose.dateLabel")}
              placeholder={t("propose.datePlaceholder")}
              placeholderClassName="text-neutral-400"
              wrapperClassName="mt-1 w-full"
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base text-neutral-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
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
