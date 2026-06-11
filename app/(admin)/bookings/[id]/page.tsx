// /bookings/[id] — 예약 상세 (T2.5, Stitch b11-booking-detail 변환)
// RSC: prisma 직접 조회 — (admin) 레이아웃 가드 하. F4 체크인·아웃(Sprint 3)의 진입점.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatThousands } from "@/lib/format";
import { toDateOnlyString } from "@/lib/date-vn";
import { formatRemainingHours } from "@/lib/booking-stats";
import ActionPanel from "./action-panel";
import MemoBox from "./memo-box";

export const metadata: Metadata = {
  title: "예약 상세 — Villa PMS",
};

const STEP_INDEX: Partial<Record<BookingStatus, number>> = {
  [BookingStatus.HOLD]: 0,
  [BookingStatus.CONFIRMED]: 1,
  [BookingStatus.CHECKED_IN]: 2,
  [BookingStatus.CHECKED_OUT]: 3,
};

const HEADER_BADGE: Record<BookingStatus, string> = {
  HOLD: "px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-sm font-bold rounded-md",
  CONFIRMED: "px-3 py-1 bg-admin-primary text-white text-sm font-bold rounded-md",
  CHECKED_IN: "px-3 py-1 bg-indigo-600 text-white text-sm font-bold rounded-md",
  CHECKED_OUT: "px-3 py-1 bg-slate-600 text-white text-sm font-bold rounded-md",
  CANCELLED: "px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold rounded-md",
  EXPIRED: "px-3 py-1 bg-slate-800 border border-slate-700 text-slate-500 text-sm font-bold rounded-md",
  NO_SHOW: "px-3 py-1 bg-slate-800 border border-slate-700 text-slate-400 text-sm font-bold rounded-md",
};

function fmtDate(d: Date): string {
  return toDateOnlyString(d).replaceAll("-", ".");
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("adminBookings");
  const { id } = await params;
  const now = new Date();

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      channel: true,
      agencyName: true,
      checkIn: true,
      checkOut: true,
      nights: true,
      guestName: true,
      guestCount: true,
      guestPhone: true,
      holdExpiresAt: true,
      saleCurrency: true,
      totalSaleKrw: true,
      totalSaleVnd: true,
      supplierCostVnd: true,
      breakfastIncluded: true,
      note: true,
      cancelReason: true,
      villa: { select: { id: true, name: true } },
      checkInRecord: { select: { signatureUrl: true } }, // T3.2 — 미서명 배지·사후 서명 진입점
      payments: {
        orderBy: { receivedAt: "asc" },
        select: { id: true, receivedAt: true, method: true, currency: true, amount: true, note: true },
      },
    },
  });
  if (!booking) notFound();

  const auditLogs = await prisma.auditLog.findMany({
    where: { entity: "Booking", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      action: true,
      changes: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });

  const code = booking.id.slice(-8);
  const stepIndex = STEP_INDEX[booking.status];
  const terminal = stepIndex === undefined;
  const steps = ["hold", "confirmed", "checkedin", "checkedout"] as const;
  const countdown =
    booking.status === BookingStatus.HOLD
      ? formatRemainingHours(booking.holdExpiresAt, now)
      : null;

  const totalSale =
    booking.saleCurrency === "KRW"
      ? `${formatThousands(booking.totalSaleKrw ?? 0)}원`
      : `${formatThousands(booking.totalSaleVnd ?? 0n)}₫`;

  const logStatusChange = (changes: unknown): string | null => {
    if (changes && typeof changes === "object" && "status" in changes) {
      const s = (changes as { status?: { new?: unknown } }).status?.new;
      if (typeof s === "string" && s in HEADER_BADGE) {
        return t(`status.${s as BookingStatus}`);
      }
    }
    return null;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* 헤더 (b11) */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <nav className="text-sm font-medium text-admin-muted flex items-center gap-2 whitespace-nowrap">
            <Link href="/bookings" className="hover:text-white transition-colors">
              {t("detail.breadcrumb")}
            </Link>
            <span className="material-symbols-outlined text-xs">chevron_right</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight text-white whitespace-nowrap">
            {t("detail.title", { code })}
          </h1>
          <span className={HEADER_BADGE[booking.status]}>{t(`status.${booking.status}`)}</span>
          {countdown && countdown.kind !== "expired" && (
            <span className="inline-flex items-center gap-1 text-amber-500 text-sm font-bold whitespace-nowrap">
              <span className="material-symbols-outlined text-sm">timer</span>
              {countdown.kind === "hours"
                ? t("countdown.hours", { n: countdown.hours })
                : t("countdown.minutes", { n: countdown.minutes })}
            </span>
          )}
        </div>
      </div>

      {/* 상태 타임라인 스트립 (b11) — 종결 상태는 배너로 대체 (계약 편차 선언) */}
      {terminal ? (
        <div className="bg-admin-card p-4 rounded-xl border border-[#334155] flex items-center gap-3">
          <span className="material-symbols-outlined text-slate-500">block</span>
          <p className="text-sm font-bold text-slate-300">
            {t(`detail.closedBanner.${booking.status}`)}
          </p>
          {booking.cancelReason && (
            <p className="text-sm text-admin-muted">
              {t("detail.closedBanner.reason", { reason: booking.cancelReason })}
            </p>
          )}
        </div>
      ) : (
        <div className="bg-admin-card p-4 rounded-xl flex items-center justify-between relative overflow-hidden border border-[#334155]">
          <div className="absolute top-[50%] left-10 right-10 h-0.5 bg-slate-700 -translate-y-1/2"></div>
          <div
            className="absolute top-[50%] left-10 h-0.5 bg-admin-primary -translate-y-1/2"
            style={{ width: `${(stepIndex / (steps.length - 1)) * 80}%` }}
          ></div>
          {steps.map((step, i) => (
            <div key={step} className="relative z-10 flex flex-col items-center gap-2 px-6">
              {i === stepIndex ? (
                <div className="w-6 h-6 rounded-full bg-admin-primary border-4 border-admin-card ring-2 ring-admin-primary/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[10px] text-white font-bold">check</span>
                </div>
              ) : (
                <div
                  className={`w-4 h-4 rounded-full border-4 border-slate-900 ${
                    i < stepIndex ? "bg-admin-primary" : "bg-slate-700"
                  }`}
                ></div>
              )}
              <span
                className={`text-xs font-bold ${
                  i === stepIndex ? "text-admin-primary" : i < stepIndex ? "text-admin-muted" : "text-[#475569]"
                }`}
              >
                {t(`detail.steps.${step}`)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* 좌측 (66%) */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {/* 예약 정보 */}
          <section className="bg-admin-card rounded-xl overflow-hidden shadow-sm border border-[#334155]">
            <div className="px-6 py-4 border-b border-slate-700">
              <h2 className="font-bold text-sm text-white">{t("detail.info.title")}</h2>
            </div>
            <div className="p-6 grid grid-cols-2 gap-y-6 gap-x-8">
              <div>
                <p className="text-xs text-admin-muted mb-1">{t("detail.info.villa")}</p>
                <Link
                  href={`/villas/${booking.villa.id}`}
                  className="font-semibold text-white hover:text-admin-primary transition-colors"
                >
                  {booking.villa.name}
                </Link>
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">{t("detail.info.channel")}</p>
                <span className="px-2 py-0.5 bg-admin-primary/10 text-admin-primary text-[10px] font-bold rounded-md uppercase whitespace-nowrap">
                  {booking.agencyName
                    ? `${booking.agencyName} (${t(`channels.${booking.channel}`)})`
                    : t(`channels.${booking.channel}`)}
                </span>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-admin-muted mb-1">{t("detail.info.schedule")}</p>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-slate-400">{t("detail.info.checkIn")}</span>
                    <span className="font-semibold text-white tabular-nums">{fmtDate(booking.checkIn)}</span>
                  </div>
                  <div className="px-3 py-1 bg-slate-700 rounded-full text-[10px] font-bold text-white whitespace-nowrap">
                    {t("detail.info.nights", { n: booking.nights })}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-slate-400">{t("detail.info.checkOut")}</span>
                    <span className="font-semibold text-white tabular-nums">{fmtDate(booking.checkOut)}</span>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">{t("detail.info.guests")}</p>
                <p className="font-semibold text-white">
                  {booking.guestCount > 1
                    ? t("detail.info.guestsValue", { name: booking.guestName, n: booking.guestCount - 1 })
                    : booking.guestName}
                </p>
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">{t("detail.info.phone")}</p>
                <p className="font-semibold text-white tabular-nums">
                  {booking.guestPhone ?? t("detail.info.none")}
                </p>
              </div>
            </div>
          </section>

          {/* 가격 스냅샷 — ADMIN 전용 화면 (원가 표시 허용, 레이아웃 가드) */}
          <section className="bg-admin-card rounded-xl overflow-hidden shadow-sm border border-[#334155]">
            <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-2">
              <h2 className="font-bold text-sm text-white">{t("detail.price.title")}</h2>
              <span className="px-2 py-0.5 border border-slate-700 text-admin-muted text-[10px] font-bold rounded uppercase whitespace-nowrap">
                {t("detail.price.currencyBadge", { currency: booking.saleCurrency })}
              </span>
            </div>
            <div className="p-6 grid grid-cols-2 gap-y-6">
              <div>
                <p className="text-xs text-admin-muted mb-1">{t("detail.price.totalSale")}</p>
                <p className="text-xl font-extrabold text-white tabular-nums">{totalSale}</p>
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">{t("detail.price.supplierCost")}</p>
                <p className="text-xl font-extrabold text-admin-muted tabular-nums">
                  {formatThousands(booking.supplierCostVnd)}₫
                </p>
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">{t("detail.price.breakfast")}</p>
                <div className="flex items-center gap-2">
                  <span
                    className={`material-symbols-outlined text-sm ${
                      booking.breakfastIncluded ? "text-green-500" : "text-slate-600"
                    }`}
                  >
                    {booking.breakfastIncluded ? "check_circle" : "cancel"}
                  </span>
                  <span className="font-semibold text-sm text-white">
                    {booking.breakfastIncluded ? t("detail.price.included") : t("detail.price.notIncluded")}
                  </span>
                </div>
              </div>
            </div>
            <div className="px-6 py-3 bg-slate-900/50 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-[#475569]">lock</span>
              <p className="text-[11px] text-[#475569]">{t("detail.price.locked")}</p>
            </div>
          </section>

          {/* 결제 기록 */}
          <section className="bg-admin-card rounded-xl overflow-hidden shadow-sm border border-[#334155]">
            <div className="px-6 py-4 border-b border-slate-700">
              <h2 className="font-bold text-sm text-white">{t("detail.payments.title")}</h2>
            </div>
            {booking.payments.length === 0 ? (
              <p className="p-6 text-sm text-admin-muted">{t("detail.payments.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-900/40 text-admin-muted text-[11px] font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-3">{t("detail.payments.date")}</th>
                      <th className="px-6 py-3">{t("detail.payments.method")}</th>
                      <th className="px-6 py-3 text-right">{t("detail.payments.amount")}</th>
                      <th className="px-6 py-3">{t("detail.payments.note")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {booking.payments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-700/30 transition">
                        <td className="px-6 py-4 text-admin-muted whitespace-nowrap">{formatDateTime(p.receivedAt)}</td>
                        <td className="px-6 py-4 text-white whitespace-nowrap">
                          {t(`detail.payments.methods.${p.method}`)}
                        </td>
                        <td className="px-6 py-4 font-semibold text-white text-right tabular-nums whitespace-nowrap">
                          {formatThousands(p.amount)}
                          {p.currency === "KRW" ? "원" : p.currency === "VND" ? "₫" : " USD"}
                        </td>
                        <td className="px-6 py-4 text-admin-muted">{p.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* 우측 (33%) */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <ActionPanel
            bookingId={booking.id}
            status={booking.status}
            agreementUnsigned={
              booking.status === "CHECKED_IN" &&
              booking.checkInRecord !== null &&
              !booking.checkInRecord.signatureUrl
            }
          />

          {/* 활동 로그 — AuditLog 기반 */}
          <section className="bg-admin-card rounded-xl overflow-hidden shadow-sm border border-[#334155]">
            <div className="px-6 py-4 border-b border-slate-700">
              <h2 className="font-bold text-sm text-white">{t("detail.log.title")}</h2>
            </div>
            <div className="p-6 space-y-4">
              {auditLogs.length === 0 && (
                <p className="text-xs text-admin-muted">{t("detail.log.empty")}</p>
              )}
              {auditLogs.map((log, i) => {
                const statusChange = logStatusChange(log.changes);
                return (
                  <div key={log.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-2 h-2 rounded-full mt-1.5 ${i === 0 ? "bg-admin-primary" : "bg-slate-700"}`}
                      ></div>
                      {i < auditLogs.length - 1 && <div className="w-px h-full bg-slate-700 mt-2"></div>}
                    </div>
                    <div>
                      <p className={`text-xs font-bold ${i === 0 ? "text-white" : "text-admin-muted"}`}>
                        {t(`detail.log.actions.${log.action}`)}
                        {statusChange ? ` → ${statusChange}` : ""}
                      </p>
                      <p className="text-[11px] text-admin-muted mt-0.5">
                        {log.user?.name ?? t("detail.log.system")}
                      </p>
                      <p className="text-[10px] text-[#475569] mt-1 italic">
                        [{formatDateTime(log.createdAt)}]
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <MemoBox bookingId={booking.id} initialNote={booking.note} />
        </div>
      </div>
    </div>
  );
}
