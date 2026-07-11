"use client";

// 예약 부가옵션 주문 패널 (ADR-0019 S2, Stitch b20) — 주문 목록 + 옵션 추가 + 행별 상태 액션.
//   /api/bookings/[id]/service-orders (POST) + /api/service-orders/[id] (PATCH). 저장 후 router.refresh().
//   ★ 마진 비공개: 원가(costVnd)·확정가 조정칸은 showCost(canViewFinance)일 때만. 서버 페이로드에서도 제외됨.
//   게스트 요청(requestedVia=GUEST·REQUESTED) 행은 amber 강조("요청 대기"). 합계는 resolveOrderPricing 재사용.
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatThousands, formatDateTime } from "@/lib/format";
import { DateField } from "@/components/date-field";
import {
  parseCatalogOptions,
  resolveOrderPricing,
  type CatalogOptions,
} from "@/lib/service-catalog";

// 서버에서 직렬화되어 내려오는 카탈로그 항목(주문 추가용) — 판매가만(원가 없음)
export interface OrderCatalogItem {
  id: string;
  type: string;
  nameKo: string;
  unitLabelKo: string;
  priceVnd: string | null; // 판매가 VND(단일통화) — KRW는 주문 생성 시 환율 스냅샷
  options: unknown;
}

export interface SelectedOptionSnapshot {
  group: "variant" | "addon" | "modifier";
  key: string;
  labelKo: string;
}

export type VendorStatus = "PENDING_VENDOR" | "VENDOR_ACCEPTED" | "VENDOR_REJECTED";
export type VendorSettleMethod = "CASH" | "BANK_TRANSFER" | "OTHER";

export interface OrderRow {
  id: string;
  type: string;
  status: "REQUESTED" | "CONFIRMED" | "DELIVERED" | "CANCELLED";
  serviceDate: string | null; // 희망 날짜 YYYY-MM-DD (투숙기간 내)
  serviceTime: string | null; // 희망 시각 "HH:MM"
  nameKo: string; // 카탈로그명(없으면 type 라벨)
  quantity: number;
  priceKrw: number;
  priceVnd: string | null;
  costVnd?: string | null; // showCost일 때만
  requestedVia: "ADMIN" | "GUEST" | "PARTNER"; // PARTNER = 여행사/랜드사 채널(ADR-0023)
  customerName: string | null; // 이용자 이름 스냅샷 — 예약 대표자와 다를 때만 식별용 표시
  guestNote: string | null;
  selectedOptions: SelectedOptionSnapshot[];
  ticketUrls: string[]; // 티켓형(TICKET) 발행 이미지 URL — 발행 현황·대리 첨부(ADR-0034)
  // ADR-0023 S2 — 원천 공급자 발주 흐름. vendorId=null이면 직접 제공(발주 흐름 없음).
  vendorId: string | null;
  vendorName: string | null;
  vendorStatus: VendorStatus | null; // null + vendorId 있으면 "미발주"
  poSentAt: string | null;
  vendorRespondedAt: string | null;
  vendorRejectReason: string | null;
  vendorSettledAt: string | null; // 정산 완료 시각(null=미정산)
  vendorSettleMethod: VendorSettleMethod | null;
  vendorCompletedAt: string | null; // 공급자 이행 완료 보고 시각(null=미보고, admin-vendor-ops A)
  // 일정 협의(propose, ADR-0023 S2 확장) — 공급자가 수락하되 제안한 대안 시간.
  proposedServiceDate: string | null; // YYYY-MM-DD(@db.Date)
  proposedServiceTime: string | null; // "HH:MM"
  vendorProposalNote: string | null; // 제안 사유 메모
  vendorProposalRespondedAt: string | null; // 운영자 처리(적용/무시) 시각. null=미해결
}

// 대체 벤더 지정 셀렉터 옵션(admin-vendor-ops D) — 승인(APPROVED)된 공급자만 서버에서 내려옴
export interface VendorOption {
  id: string;
  name: string;
  nameKo: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  REQUESTED: "bg-amber-500/15 text-amber-400",
  CONFIRMED: "bg-blue-500/15 text-blue-400",
  DELIVERED: "bg-emerald-500/15 text-emerald-400",
  CANCELLED: "bg-slate-600/30 text-slate-400",
};

// 발주 상태 배지 — 미발주(NONE)/발주대기/수락/거절. ADR-0023 S2.
const VENDOR_BADGE: Record<string, string> = {
  NONE: "bg-slate-600/30 text-slate-400",
  PENDING_VENDOR: "bg-amber-500/15 text-amber-400",
  VENDOR_ACCEPTED: "bg-emerald-500/15 text-emerald-400",
  VENDOR_REJECTED: "bg-red-500/15 text-red-400",
};

export default function ServiceOrdersPanel({
  bookingId,
  catalog,
  orders,
  showCost,
  dateMin,
  dateMax,
  vendorOptions = [],
  representativeName = null,
}: {
  bookingId: string;
  catalog: OrderCatalogItem[];
  orders: OrderRow[];
  showCost: boolean;
  dateMin: string; // 희망 날짜 입력 범위(YYYY-MM-DD) — 투숙 체크인
  dateMax: string; // 〃 체크아웃
  vendorOptions?: VendorOption[]; // 대체 벤더 지정용(승인 벤더만, admin-vendor-ops D)
  representativeName?: string | null; // 예약 대표자 이름 — 주문 이용자 이름이 다를 때만 강조 표시용
}) {
  const t = useTranslations("adminServiceOrders");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // tone: "ok" 성공 / "warn" 경고 / "error" 실패
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(
    null
  );
  const [adding, setAdding] = useState(false);
  // 확정가 입력(행별, VND) — showCost만
  const [confirmPrice, setConfirmPrice] = useState<Record<string, string>>({});

  const pendingGuest = orders.filter(
    (o) => o.requestedVia === "GUEST" && o.status === "REQUESTED"
  ).length;

  const refresh = () => router.refresh();
  const fail = () => setMessage({ tone: "error", text: t("error") });

  async function patchStatus(orderId: string, status: OrderRow["status"], extra?: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/service-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      if (!res.ok) {
        // 409 VENDOR_NOT_ACCEPTED — 공급자 미수락 상태로 고객확정 시도.
        // 409 PROPOSAL_UNRESOLVED — 수락했지만 시간 제안이 미처리(적용/무시 필요) — 문구 분기.
        const code = await res.json().then((d) => d?.error).catch(() => null);
        if (res.status === 409 && code === "VENDOR_NOT_ACCEPTED") {
          setMessage({ tone: "warn", text: t("vendor.notAcceptedWarn") });
          return;
        }
        if (res.status === 409 && code === "PROPOSAL_UNRESOLVED") {
          setMessage({ tone: "warn", text: t("vendor.proposal.unresolvedWarn") });
          return;
        }
        throw new Error();
      }
      setMessage({ tone: "ok", text: t("saved") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  // 발주 발송 요청 (POST /dispatch) — 결과만 반환(메시지 처리는 호출부).
  //   단독 발주 버튼(dispatchOrder)과 업체 변경 시 자동 재발주(changeVendor)가 공유한다.
  //   busy/메시지 상태는 호출부가 관리하므로 여기서 건드리지 않는다.
  async function requestDispatch(
    orderId: string
  ): Promise<{ ok: true; warning?: string } | { ok: false; status: number; code: string | null }> {
    const res = await fetch(`/api/service-orders/${orderId}/dispatch`, { method: "POST" });
    if (!res.ok) {
      const code = await res.json().then((d) => d?.error).catch(() => null);
      return { ok: false, status: res.status, code };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, warning: data?.warning };
  }

  // ADR-0023 S2 — 발주 발송 (POST /dispatch). 성공 후 새로고침. Zalo 미설정 시 경고.
  async function dispatchOrder(orderId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await requestDispatch(orderId);
      if (!r.ok) {
        if (r.status === 400 && r.code === "NO_VENDOR") {
          setMessage({ tone: "error", text: t("vendor.noVendor") });
        } else if (r.status === 409 && r.code === "CANNOT_DISPATCH") {
          setMessage({ tone: "error", text: t("vendor.cannotDispatch") });
        } else {
          fail();
        }
        return;
      }
      if (r.warning === "NO_VENDOR_ZALO") {
        setMessage({ tone: "warn", text: t("vendor.noZaloWarn") });
      } else {
        setMessage({ tone: "ok", text: t("vendor.dispatched") });
      }
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  // ADR-0023 S2 — 건별 발주 정산(완료/해제). 재무권한자만. PATCH {markSettled, vendorSettleMethod?}.
  async function settleVendor(
    orderId: string,
    markSettled: boolean,
    vendorSettleMethod?: VendorSettleMethod
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = { markSettled };
      if (markSettled && vendorSettleMethod) body.vendorSettleMethod = vendorSettleMethod;
      const res = await fetch(`/api/service-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setMessage({ tone: "ok", text: t("saved") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  // 대체 벤더 지정(admin-vendor-ops D) — REQUESTED + 발주 전/거절만. PATCH {vendorId}(null=직접 제공).
  //   서버가 발주 사이클 리셋(vendorStatus 등 null) 후 재발주 가능. 409 VENDOR_LOCKED는 상태 안내.
  //   ★업체 변경(vendorId!=null) 성공 시 곧바로 재발주를 체이닝한다 — 벤더 발주함은 PENDING_VENDOR만
  //     조회하므로, 발주를 자동 발송하지 않으면 새 업체 페이지에 아무것도 안 뜬다(테오 요청).
  //     직접 제공 전환(vendorId=null)은 발주 흐름이 없으므로 dispatch 호출하지 않는다.
  async function changeVendor(orderId: string, vendorId: string | null) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/service-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      });
      if (!res.ok) {
        const code = await res.json().then((d) => d?.error).catch(() => null);
        if (res.status === 409 && code === "VENDOR_LOCKED") {
          setMessage({ tone: "warn", text: t("vendor.changeLocked") });
        } else {
          fail();
        }
        return;
      }
      // 직접 제공 전환 — 발주 없음. 기존대로 저장 메시지만.
      if (vendorId === null) {
        setMessage({ tone: "ok", text: t("saved") });
        return;
      }
      // 업체 변경 성공 → 자동 재발주. 통합 메시지로 결과 안내.
      const r = await requestDispatch(orderId);
      if (!r.ok) {
        // 변경은 됐으나 발주 실패(409 CANNOT_DISPATCH 등) — 수동 재시도 유도.
        setMessage({ tone: "warn", text: t("vendor.changeDispatchFailed") });
      } else if (r.warning === "NO_VENDOR_ZALO") {
        // 변경·발주는 됐으나 새 업체 Zalo 미연결 — 수동 연락 필요.
        setMessage({ tone: "warn", text: t("vendor.changeDispatchedNoZalo") });
      } else {
        setMessage({ tone: "ok", text: t("vendor.changeDispatched") });
      }
    } catch {
      fail();
    } finally {
      // 성공·실패 어느 경로든 최신 상태 반영.
      refresh();
      setBusy(false);
    }
  }

  // ADR-0023 S2 — 공급자 일정 제안 적용/무시 (POST /apply-proposal {apply}).
  //   적용=true: serviceDate/serviceTime←제안값. 무시=false: 제안 보존·해결 표시만.
  //   어느 쪽이든 미해결 게이트가 풀려 고객확정 가능. 409(ALREADY_RESOLVED)는 최신화 후 무시.
  async function applyProposal(orderId: string, apply: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/service-orders/${orderId}/apply-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      if (!res.ok && res.status !== 409) throw new Error();
      setMessage({ tone: "ok", text: t("saved") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  function handleConfirm(order: OrderRow) {
    // showCost면 입력한 확정가(VND)를 함께 보냄(미입력 시 가격 미변경, 상태만 확정)
    const extra: Record<string, unknown> = {};
    if (showCost) {
      const p = confirmPrice[order.id];
      if (p && /^\d{1,15}$/.test(p)) extra.priceVnd = p;
    }
    patchStatus(order.id, "CONFIRMED", extra);
  }

  function handleCancel(order: OrderRow) {
    if (!confirm(t("cancelConfirm"))) return;
    patchStatus(order.id, "CANCELLED");
  }

  return (
    <section className="bg-admin-card border border-[#334155] rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 gap-3">
        <h2 className="font-bold text-sm text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">restaurant</span>
          {t("title")}
        </h2>
        <div className="flex items-center gap-3">
          {message && (
            <span
              role="status"
              className={`text-xs font-medium ${
                message.tone === "ok"
                  ? "text-emerald-500"
                  : message.tone === "warn"
                    ? "text-amber-400"
                    : "text-red-400"
              }`}
            >
              {message.text}
            </span>
          )}
          {pendingGuest > 0 && (
            <span className="bg-amber-500/15 text-amber-400 text-[11px] font-bold px-3 py-1 rounded-full flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
              {t("guestPending", { n: pendingGuest })}
            </span>
          )}
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="p-6 text-sm text-admin-muted">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-admin-muted text-[11px] font-bold uppercase tracking-wider border-b border-slate-700 bg-slate-900/40">
              <tr>
                <th className="text-left px-6 py-3">{t("colMenu")}</th>
                <th className="text-center px-2 py-3">{t("colQty")}</th>
                <th className="text-center px-2 py-3">{t("colVia")}</th>
                <th className="text-left px-3 py-3">{t("colWhen")}</th>
                <th className="text-right px-3 py-3">{t("colSale")}</th>
                {showCost && <th className="text-right px-3 py-3">{t("colCost")}</th>}
                <th className="text-left px-3 py-3">{t("colVendor")}</th>
                <th className="text-center px-3 py-3">{t("colStatus")}</th>
                <th className="text-right px-6 py-3">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {orders.map((o) => {
                const isPendingGuest = o.requestedVia === "GUEST" && o.status === "REQUESTED";
                const terminal = o.status === "CANCELLED";
                const optSummary = o.selectedOptions.map((s) => s.labelKo).join(", ");
                return (
                  <tr
                    key={o.id}
                    className={
                      isPendingGuest
                        ? "bg-amber-500/5"
                        : terminal
                          ? "opacity-60"
                          : "hover:bg-slate-700/30 transition"
                    }
                  >
                    <td className="px-6 py-3">
                      <p
                        className={`font-medium ${terminal ? "text-slate-300 line-through" : "text-white"}`}
                      >
                        {o.nameKo}
                      </p>
                      {optSummary && (
                        <p className="text-[11px] text-slate-500 mt-0.5">{optSummary}</p>
                      )}
                      {o.guestNote && (
                        <p className="text-[11px] text-amber-400/80 mt-0.5 italic">“{o.guestNote}”</p>
                      )}
                      {/* 이용자 이름 — 예약 대표자와 다를 때만 식별용 표시(이름만) */}
                      {o.customerName && o.customerName !== representativeName && (
                        <p className="text-[11px] text-teal-300/90 mt-0.5 flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[13px]">person</span>
                          {t("customerName")}: {o.customerName}
                        </p>
                      )}
                      {/* 티켓형(TICKET) 발행 현황 + 대리 첨부/삭제(ADR-0034) — 발주 상태 불변 */}
                      {o.type === "TICKET" && (
                        <AdminTicketCell order={o} t={t} onChanged={refresh} />
                      )}
                    </td>
                    <td className="px-2 py-3 text-center tabular-nums text-slate-300">{o.quantity}</td>
                    <td className="px-2 py-3 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                          o.requestedVia === "GUEST"
                            ? "bg-teal-500/15 text-teal-300"
                            : "bg-slate-600/40 text-slate-300"
                        }`}
                      >
                        {o.requestedVia === "GUEST" ? t("viaGuest") : t("viaAdmin")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-left whitespace-nowrap">
                      {o.serviceDate || o.serviceTime ? (
                        <span className="text-xs text-slate-300 tabular-nums">
                          {o.serviceDate ?? ""}
                          {o.serviceDate && o.serviceTime ? " " : ""}
                          {o.serviceTime ?? ""}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-white font-semibold whitespace-nowrap">
                      {o.priceKrw > 0 ? `${formatThousands(o.priceKrw)}원` : ""}
                      {o.priceKrw > 0 && o.priceVnd ? <br /> : null}
                      {o.priceVnd ? (
                        <span className="text-slate-300 font-normal">
                          {formatThousands(o.priceVnd)}₫
                        </span>
                      ) : o.priceKrw > 0 ? null : (
                        "—"
                      )}
                    </td>
                    {showCost && (
                      <td className="px-3 py-3 text-right tabular-nums text-slate-400 whitespace-nowrap">
                        {o.costVnd && o.costVnd !== "0" ? `${formatThousands(o.costVnd)}₫` : "—"}
                      </td>
                    )}
                    <td className="px-3 py-3 text-left align-top">
                      <VendorCell
                        order={o}
                        showCost={showCost}
                        busy={busy}
                        vendorOptions={vendorOptions}
                        onApplyProposal={applyProposal}
                        onChangeVendor={changeVendor}
                        t={t}
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                          STATUS_BADGE[o.status]
                        }`}
                      >
                        {t(`status.${o.status}`)}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <RowActions
                        order={o}
                        showCost={showCost}
                        busy={busy}
                        confirmPrice={confirmPrice[o.id] ?? ""}
                        setConfirmPrice={(v) =>
                          setConfirmPrice((s) => ({ ...s, [o.id]: v.replace(/\D/g, "") }))
                        }
                        onConfirm={() => handleConfirm(o)}
                        onDeliver={() => patchStatus(o.id, "DELIVERED")}
                        onCancel={() => handleCancel(o)}
                        onDispatch={() => dispatchOrder(o.id)}
                        onSettle={settleVendor}
                        t={t}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 옵션 추가 */}
      <div className="px-6 py-4 border-t border-slate-700 bg-slate-900/30">
        {adding ? (
          <AddOrderForm
            bookingId={bookingId}
            catalog={catalog}
            busy={busy}
            setBusy={setBusy}
            dateMin={dateMin}
            dateMax={dateMax}
            onDone={() => {
              setAdding(false);
              setMessage({ tone: "ok", text: t("saved") });
              refresh();
            }}
            onFail={fail}
            onClose={() => setAdding(false)}
            t={t}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={catalog.length === 0}
            className="flex items-center gap-2 bg-admin-primary hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-bold rounded-lg px-4 py-2 whitespace-nowrap transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {t("addTitle")}
          </button>
        )}
      </div>
    </section>
  );
}

// 티켓 업로드/삭제 오류 코드 → i18n 라벨(adminServiceOrders.tickets.*)
function adminTicketErr(code: string | undefined, t: ReturnType<typeof useTranslations>): string {
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

// ── 티켓형(TICKET) 발행 현황 + 대리 첨부/삭제 (ADR-0034) ─────────────────────────
//   운영자가 벤더 Zalo로 받은 QR 티켓을 대신 첨부하는 관행. /api/service-orders/[id]/tickets 사용.
//   ★발주 상태 전이 없음 — 단순 첨부. 썸네일(원본 새 탭)+카운터(미달 amber)+첨부+삭제.
function AdminTicketCell({
  order,
  t,
  onChanged,
}: {
  order: OrderRow;
  t: ReturnType<typeof useTranslations>;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const issued = order.ticketUrls.length;
  const short = issued < order.quantity;
  const closed = order.status === "CANCELLED" || order.status === "DELIVERED";

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetch(`/api/service-orders/${order.id}/tickets`, { method: "POST", body: fd });
      if (!res.ok) {
        let code: string | undefined;
        try {
          code = (await res.json())?.error;
        } catch {
          /* noop */
        }
        setErr(adminTicketErr(code, t));
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
      const res = await fetch(`/api/service-orders/${order.id}/tickets`, {
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
        setErr(adminTicketErr(code, t));
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
    <div className="mt-1.5 space-y-1.5 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[15px] text-indigo-300">confirmation_number</span>
        <span className="text-[11px] font-bold text-slate-300">{t("tickets.title")}</span>
        <span
          className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
            short ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"
          }`}
        >
          {t("tickets.counter", { issued, needed: order.quantity })}
        </span>
      </div>

      {issued === 0 ? (
        <p className="text-[11px] text-slate-500">{t("tickets.none")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {order.ticketUrls.map((url) => (
            <div key={url} className="relative">
              <a href={url} target="_blank" rel="noreferrer" title={t("tickets.view")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-12 w-12 rounded border border-slate-600 object-cover" />
              </a>
              {!closed && (
                <button
                  type="button"
                  onClick={() => remove(url)}
                  disabled={busy}
                  aria-label={t("tickets.remove")}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {err && <p className="text-[11px] font-medium text-red-400">{err}</p>}

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
            className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-[11px] font-bold text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[14px]">upload</span>
            {busy ? t("tickets.uploading") : t("tickets.upload")}
          </button>
        </>
      )}
    </div>
  );
}

// ── 원천 공급자 표시 셀 (ADR-0023 S2) ─────────────────────────────────────────
//   vendorId 없으면 "직접 제공". 있으면 공급자명 + 발주상태 배지. 거절 사유는 표시.
//   정산완료(vendorSettledAt) 시각·결제수단은 재무권한자만(showCost).
//   대체 벤더 지정(admin-vendor-ops D) — REQUESTED + 발주 전(null)/거절만 셀렉터 노출.
function VendorCell({
  order,
  showCost,
  busy,
  vendorOptions,
  onApplyProposal,
  onChangeVendor,
  t,
}: {
  order: OrderRow;
  showCost: boolean;
  busy: boolean;
  vendorOptions: VendorOption[];
  onApplyProposal: (orderId: string, apply: boolean) => void;
  onChangeVendor: (orderId: string, vendorId: string | null) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  // 대체 벤더 지정 가능 — 서버 가드(VENDOR_LOCKED)와 동일 조건(REQUESTED + 발주 전/거절)
  const canChangeVendor =
    order.status === "REQUESTED" &&
    (order.vendorStatus === null || order.vendorStatus === "VENDOR_REJECTED");
  const vendorSelect = canChangeVendor && vendorOptions.length > 0 && (
    <select
      value={order.vendorId ?? ""}
      onChange={(e) => onChangeVendor(order.id, e.target.value || null)}
      disabled={busy}
      aria-label={t("vendor.change")}
      title={t("vendor.change")}
      className="mt-1 block w-full max-w-[160px] bg-admin-bg border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-300 focus:border-admin-primary focus:outline-none disabled:opacity-50"
    >
      {/* 없음 = 직접 제공(발주 흐름 없음) */}
      <option value="">{t("vendor.changeNone")}</option>
      {vendorOptions.map((v) => (
        <option key={v.id} value={v.id}>
          {v.nameKo || v.name}
        </option>
      ))}
    </select>
  );

  if (!order.vendorId) {
    return (
      <div className="space-y-1">
        <span className="text-[11px] text-slate-500">{t("vendor.direct")}</span>
        {vendorSelect}
      </div>
    );
  }
  const vs = order.vendorStatus ?? "NONE"; // null + vendorId → 미발주(NONE)
  // 일정 협의 미해결 — 수락(VENDOR_ACCEPTED)했고 대안 시간 제안 있고 운영자 미처리.
  const hasUnresolvedProposal =
    vs === "VENDOR_ACCEPTED" &&
    !!order.proposedServiceDate &&
    !order.vendorProposalRespondedAt;
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-300 whitespace-nowrap">{order.vendorName ?? "—"}</p>
      <span
        className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
          VENDOR_BADGE[vs] ?? VENDOR_BADGE.NONE
        }`}
      >
        {t(`vendor.status.${vs}`)}
      </span>
      {vs === "VENDOR_REJECTED" && order.vendorRejectReason && (
        <p
          className="text-[10px] text-red-400/80 italic max-w-[160px] truncate"
          title={order.vendorRejectReason}
        >
          “{order.vendorRejectReason}”
        </p>
      )}
      {/* 대체 벤더 지정(admin-vendor-ops D) — 거절/미발주 상태에서 다른 승인 벤더로 교체(또는 직접 제공) */}
      {vendorSelect}
      {/* 일정 협의 — 공급자가 제안한 대안 시간(미해결). 적용/무시로 일정 확정. */}
      {hasUnresolvedProposal && (
        <div className="mt-1 space-y-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-2 max-w-[220px]">
          <p className="text-[10px] font-bold text-blue-300 flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px]">schedule</span>
            {t("vendor.proposal.title")}
          </p>
          <p className="text-[11px] font-semibold text-blue-100 tabular-nums">
            {formatProposalWhen(order.proposedServiceDate, order.proposedServiceTime)}
          </p>
          {order.vendorProposalNote && (
            <p className="text-[10px] text-blue-200/80 italic whitespace-pre-line break-words">
              “{order.vendorProposalNote}”
            </p>
          )}
          <div className="flex gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => onApplyProposal(order.id, true)}
              disabled={busy}
              className="text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white rounded px-2 py-1 whitespace-nowrap disabled:opacity-50"
            >
              {t("vendor.proposal.apply")}
            </button>
            <button
              type="button"
              onClick={() => onApplyProposal(order.id, false)}
              disabled={busy}
              className="text-[10px] font-bold border border-slate-600 hover:bg-slate-700 text-slate-300 rounded px-2 py-1 whitespace-nowrap disabled:opacity-50"
            >
              {t("vendor.proposal.ignore")}
            </button>
          </div>
        </div>
      )}
      {/* 이행 완료 보고(vendorCompletedAt) — 공급자가 서비스 이행을 보고한 시각(전 운영자 표시) */}
      {order.vendorCompletedAt && (
        <p className="text-[10px] text-emerald-400/80 whitespace-nowrap">
          {t("vendor.completedAt", { date: formatDateTime(new Date(order.vendorCompletedAt)) })}
        </p>
      )}
      {/* 정산 상태(재무권한자만) */}
      {showCost && order.vendorSettledAt && (
        <p className="text-[10px] text-emerald-400/80 whitespace-nowrap">
          {t("vendor.settledAt", { date: formatDateTime(new Date(order.vendorSettledAt)) })}
        </p>
      )}
    </div>
  );
}

/** 제안 일정 "dd/MM HH:MM" — date는 YYYY-MM-DD(@db.Date), time은 선택 */
function formatProposalWhen(date: string | null, time: string | null): string {
  if (!date) return "—";
  const [, mm, dd] = date.split("-");
  const day = dd && mm ? `${dd}/${mm}` : date;
  return time ? `${day} ${time}` : day;
}

// ── 행별 상태 액션 ─────────────────────────────────────────────────────────────
function RowActions({
  order,
  showCost,
  busy,
  confirmPrice,
  setConfirmPrice,
  onConfirm,
  onDeliver,
  onCancel,
  onDispatch,
  onSettle,
  t,
}: {
  order: OrderRow;
  showCost: boolean;
  busy: boolean;
  confirmPrice: string;
  setConfirmPrice: (v: string) => void;
  onConfirm: () => void;
  onDeliver: () => void;
  onCancel: () => void;
  onDispatch: () => void;
  onSettle: (
    orderId: string,
    markSettled: boolean,
    method?: VendorSettleMethod
  ) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const btnGhost =
    "text-xs font-bold border border-slate-700 hover:bg-slate-800 text-slate-400 rounded-lg px-2.5 py-1.5 whitespace-nowrap disabled:opacity-50";

  // 발주 게이트: vendorId 있으면 VENDOR_ACCEPTED여야 고객확정 가능
  const hasVendor = !!order.vendorId;
  const vendorAccepted = order.vendorStatus === "VENDOR_ACCEPTED";
  // 발주 보내기 노출: REQUESTED + vendorId + (미발주 || 거절)
  const canDispatch =
    order.status === "REQUESTED" &&
    hasVendor &&
    (order.vendorStatus === null || order.vendorStatus === "VENDOR_REJECTED");
  // 일정 협의 미해결 — 수락했어도 제안이 미처리면 고객확정 차단(운영자 적용/무시 후 가능).
  const unresolvedProposal =
    vendorAccepted && !!order.proposedServiceDate && !order.vendorProposalRespondedAt;
  const confirmBlocked = hasVendor && (!vendorAccepted || unresolvedProposal);

  if (order.status === "REQUESTED") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center justify-end gap-2">
          {canDispatch && (
            <button
              type="button"
              onClick={onDispatch}
              disabled={busy}
              className="text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white rounded-lg px-2.5 py-1.5 whitespace-nowrap disabled:opacity-50 flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[15px]">send</span>
              {t("vendor.dispatch")}
            </button>
          )}
          {showCost && (
            <input
              inputMode="numeric"
              value={confirmPrice ? formatThousands(confirmPrice) : ""}
              onChange={(e) => setConfirmPrice(e.target.value)}
              placeholder={t("confirmPricePlaceholder")}
              aria-label={t("confirmPricePlaceholder")}
              className="w-28 bg-admin-bg border border-slate-700 rounded px-2 py-1 text-xs text-white tabular-nums text-right focus:border-admin-primary focus:outline-none"
            />
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmBlocked}
            title={
              confirmBlocked
                ? unresolvedProposal
                  ? t("vendor.proposal.confirmGate")
                  : t("vendor.confirmGate")
                : undefined
            }
            className="text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2.5 py-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("actions.confirm")}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className={btnGhost}>
            {t("actions.cancel")}
          </button>
        </div>
        {confirmBlocked && (
          <p className="text-[10px] text-amber-400/80 whitespace-nowrap">
            {unresolvedProposal ? t("vendor.proposal.confirmGate") : t("vendor.confirmGate")}
          </p>
        )}
      </div>
    );
  }
  if (order.status === "CONFIRMED" || order.status === "DELIVERED") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center justify-end gap-2">
          {order.status === "CONFIRMED" && (
            <button
              type="button"
              onClick={onDeliver}
              disabled={busy}
              className="text-xs font-bold bg-admin-primary hover:bg-blue-600 text-white rounded-lg px-2.5 py-1.5 whitespace-nowrap disabled:opacity-50"
            >
              {t("actions.deliver")}
            </button>
          )}
          {order.status === "CONFIRMED" && (
            <button type="button" onClick={onCancel} disabled={busy} className={btnGhost}>
              {t("actions.cancel")}
            </button>
          )}
        </div>
        {/* 건별 발주 정산 (재무권한자만, 공급자 수락·배송된 주문) */}
        {showCost && hasVendor && vendorAccepted && (
          <VendorSettle order={order} busy={busy} onSettle={onSettle} t={t} />
        )}
      </div>
    );
  }
  return <div className="text-right text-slate-600 text-xs">—</div>;
}

// ── 건별 발주 정산 컨트롤 (재무권한자) ───────────────────────────────────────────
function VendorSettle({
  order,
  busy,
  onSettle,
  t,
}: {
  order: OrderRow;
  busy: boolean;
  onSettle: (orderId: string, markSettled: boolean, method?: VendorSettleMethod) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [method, setMethod] = useState<VendorSettleMethod>("CASH");

  if (order.vendorSettledAt) {
    return (
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">paid</span>
          {t("vendor.settled")}
          {order.vendorSettleMethod && ` · ${t(`vendor.method.${order.vendorSettleMethod}`)}`}
        </span>
        <button
          type="button"
          onClick={() => onSettle(order.id, false)}
          disabled={busy}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-300 underline disabled:opacity-50"
        >
          {t("vendor.unsettle")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as VendorSettleMethod)}
        aria-label={t("vendor.settleMethod")}
        className="bg-admin-bg border border-slate-700 rounded px-1.5 py-1 text-[11px] text-white focus:border-admin-primary focus:outline-none"
      >
        <option value="CASH">{t("vendor.method.CASH")}</option>
        <option value="BANK_TRANSFER">{t("vendor.method.BANK_TRANSFER")}</option>
        <option value="OTHER">{t("vendor.method.OTHER")}</option>
      </select>
      <button
        type="button"
        onClick={() => onSettle(order.id, true, method)}
        disabled={busy}
        className="text-[11px] font-bold bg-teal-700 hover:bg-teal-600 text-white rounded-lg px-2 py-1 whitespace-nowrap disabled:opacity-50 flex items-center gap-1"
      >
        <span className="material-symbols-outlined text-[14px]">paid</span>
        {t("vendor.markSettled")}
      </button>
    </div>
  );
}

// ── 옵션 추가 폼 (카탈로그 선택 → variant/addon/modifier → 수량 → 합계 미리보기) ──────
function AddOrderForm({
  bookingId,
  catalog,
  busy,
  setBusy,
  dateMin,
  dateMax,
  onDone,
  onFail,
  onClose,
  t,
}: {
  bookingId: string;
  catalog: OrderCatalogItem[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  dateMin: string;
  dateMax: string;
  onDone: () => void;
  onFail: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [itemId, setItemId] = useState<string>(catalog[0]?.id ?? "");
  const [variantKey, setVariantKey] = useState<string>("");
  const [addonKeys, setAddonKeys] = useState<string[]>([]);
  const [modifierKeys, setModifierKeys] = useState<string[]>([]);
  const [quantity, setQuantity] = useState<string>("1");
  const [serviceDate, setServiceDate] = useState<string>("");
  const [serviceTime, setServiceTime] = useState<string>("");
  const [guestNote, setGuestNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const item = catalog.find((c) => c.id === itemId);
  const options: CatalogOptions = useMemo(
    () => (item ? parseCatalogOptions(item.options) : {}),
    [item]
  );

  // 항목 전환 시 옵션 선택 초기화 (첫 variant 자동선택)
  function selectItem(id: string) {
    setItemId(id);
    const next = catalog.find((c) => c.id === id);
    const opts = next ? parseCatalogOptions(next.options) : {};
    setVariantKey(opts.variants && opts.variants.length > 0 ? opts.variants[0].key : "");
    setAddonKeys([]);
    setModifierKeys([]);
    setError(null);
  }

  const qty = Math.max(1, Number.parseInt(quantity, 10) || 1);

  // 합계 미리보기 — 서버와 동일 로직(resolveOrderPricing). 선택 오류는 미리보기 미표시.
  const preview = useMemo(() => {
    if (!item) return null;
    try {
      return resolveOrderPricing(
        { priceVnd: item.priceVnd ? BigInt(item.priceVnd) : null },
        options,
        { variantKey: variantKey || null, addonKeys, modifierKeys, quantity: qty }
      );
    } catch {
      return null;
    }
  }, [item, options, variantKey, addonKeys, modifierKeys, qty]);

  function toggleAddon(key: string) {
    setAddonKeys((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }
  function toggleModifier(key: string) {
    setModifierKeys((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }

  async function handleAdd() {
    if (!item) return;
    if ((options.variants?.length ?? 0) > 0 && !variantKey) {
      setError(t("variantRequired"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/service-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogItemId: item.id,
          variantKey: variantKey || null,
          addonKeys,
          modifierKeys,
          quantity: qty,
          serviceDate: serviceDate || null,
          serviceTime: serviceTime || null,
          guestNote: guestNote.trim() || null,
          status: "REQUESTED",
        }),
      });
      if (!res.ok) throw new Error();
      onDone();
    } catch {
      onFail();
    } finally {
      setBusy(false);
    }
  }

  const selCls =
    "w-full bg-admin-bg border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-admin-primary focus:outline-none";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-300 uppercase tracking-wide">{t("addTitle")}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-white"
          aria-label={t("cancelAdd")}
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="sm:col-span-2">
          <label className="text-xs text-slate-500">{t("selectMenu")}</label>
          <select
            value={itemId}
            onChange={(e) => selectItem(e.target.value)}
            aria-label={t("selectMenu")}
            className={`mt-1 ${selCls}`}
          >
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameKo}
                {c.unitLabelKo ? ` / ${c.unitLabelKo}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("quantity")}</label>
          <input
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))}
            aria-label={t("quantity")}
            className="mt-1 w-full bg-admin-bg border border-slate-700 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:border-admin-primary focus:outline-none"
          />
        </div>
      </div>

      {/* variants — 1택 */}
      {(options.variants?.length ?? 0) > 0 && (
        <div>
          <label className="text-xs text-slate-500">{t("variant")}</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {options.variants!.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setVariantKey(v.key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                  variantKey === v.key
                    ? "bg-admin-primary text-white border-admin-primary"
                    : "bg-admin-bg text-slate-300 border-slate-700 hover:border-slate-500"
                }`}
              >
                {v.labelKo}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* addons — 다중 */}
      {(options.addons?.length ?? 0) > 0 && (
        <div>
          <label className="text-xs text-slate-500">{t("addons")}</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {options.addons!.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => toggleAddon(a.key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                  addonKeys.includes(a.key)
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-admin-bg text-slate-300 border-slate-700 hover:border-slate-500"
                }`}
              >
                {a.labelKo}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* modifiers — 토글 */}
      {(options.modifiers?.length ?? 0) > 0 && (
        <div>
          <label className="text-xs text-slate-500">{t("modifiers")}</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {options.modifiers!.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => toggleModifier(m.key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                  modifierKeys.includes(m.key)
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-admin-bg text-slate-300 border-slate-700 hover:border-slate-500"
                }`}
              >
                {m.labelKo}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 희망 날짜·시각 (#3) — 고객이 채팅·전화로 요청한 일시 */}
      <div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-500">{t("serviceDate")}</label>
            <DateField
              min={dateMin}
              max={dateMax}
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              aria-label={t("serviceDate")}
              placeholder={t("datePlaceholder")}
              className={`mt-1 ${selCls}`}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">{t("serviceTime")}</label>
            <input
              type="time"
              value={serviceTime}
              onChange={(e) => setServiceTime(e.target.value)}
              aria-label={t("serviceTime")}
              className={`mt-1 ${selCls}`}
            />
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">{t("serviceWhenHint")}</p>
      </div>

      <div>
        <label className="text-xs text-slate-500">{t("guestNote")}</label>
        <input
          value={guestNote}
          onChange={(e) => setGuestNote(e.target.value)}
          placeholder={t("guestNotePlaceholder")}
          maxLength={500}
          className={`mt-1 ${selCls}`}
        />
      </div>

      {/* 합계 미리보기 (resolveOrderPricing 재사용) */}
      {preview && (
        <div className="flex items-center justify-between bg-admin-bg border border-slate-700 rounded-lg px-4 py-2.5">
          <span className="text-sm text-slate-400">{t("total")}</span>
          <div className="text-right tabular-nums">
            <p className="text-white font-bold">
              {formatThousands(preview.totalPriceVnd.toString())}₫
            </p>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white disabled:opacity-50"
        >
          {t("cancelAdd")}
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !item}
          className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-1.5 whitespace-nowrap transition-all"
        >
          <span className="material-symbols-outlined text-base">add</span>
          {busy ? t("adding") : t("add")}
        </button>
      </div>
    </div>
  );
}
