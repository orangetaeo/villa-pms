// app/partner/bookings/[id]/page.tsx — 파트너 예약 상세 + 투숙객 명단 사전 제출 (여행사 포털 E)
//   Role=PARTNER 전용(layout 가드). 본인 partnerId 예약만(loadPartnerBookingDetail, IDOR 차단).
//   + T-partner-workflow-gaps: ② 취소·변경·홀드연장 요청 ③ HOLD 만료시각·입금계좌 ⑤ 연장 묶음.
//   ★ 누수: totalSaleKrw·원가·마진·미니바·서비스 비조회. 빌라명은 비운영자 병기.
//     입금계좌는 공개 /p 페이지와 동일 소스(getPublicBankInfo — 고객 입금처, 누수 무관).
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPartnerForUser } from "@/lib/partner-auth";
import { loadPartnerBookingDetail } from "@/lib/partner-portal";
import { formatVillaName } from "@/lib/villa-name";
import { getPublicBankInfo } from "@/app/p/_components/public-bank";
import { formatVndDot, formatDate, formatDayMonth } from "../../_format";
import PartnerRosterForm from "@/components/partner/partner-roster-form";
import PartnerChangeRequestPanel from "@/components/partner/partner-change-request-panel";

/** UTC 타임스탬프 → "dd/MM/yyyy HH:mm" — VN 현지시각(UTC+7, DST 없음) */
function formatVnDateTime(d: Date): string {
  const v = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const dd = String(v.getUTCDate()).padStart(2, "0");
  const mm = String(v.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(v.getUTCHours()).padStart(2, "0");
  const mi = String(v.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${v.getUTCFullYear()} ${hh}:${mi}`;
}

export const metadata: Metadata = {
  title: "예약 상세 — Villa Go",
};

const STATUS_STYLE: Record<string, string> = {
  HOLD: "bg-amber-100 text-amber-700",
  CONFIRMED: "bg-teal-100 text-teal-700",
  CHECKED_IN: "bg-blue-100 text-blue-700",
  CHECKED_OUT: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-neutral-100 text-neutral-500",
  EXPIRED: "bg-neutral-100 text-neutral-500",
  NO_SHOW: "bg-rose-100 text-rose-700",
};

export default async function PartnerBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARTNER") redirect("/login");

  const partner = await getPartnerForUser(session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") redirect("/partner");

  const { id } = await params;
  const booking = await loadPartnerBookingDetail(partner.id, id);
  if (!booking) notFound(); // 미소유/미존재(IDOR 차단)

  const t = await getTranslations("partner");
  const statusStyle = STATUS_STYLE[booking.status] ?? "bg-neutral-100 text-neutral-500";

  // ③ 입금계좌 — HOLD(확정 대기 입금) 또는 미납 잔액이 있을 때만. 파트너 채권은 VND 고정.
  const outstanding =
    booking.outstandingVnd !== null ? BigInt(booking.outstandingVnd) : null;
  const showBank =
    booking.status === "HOLD" || (booking.status === "CONFIRMED" && (outstanding ?? 0n) > 0n);
  const bank = showBank ? await getPublicBankInfo("VND") : null;

  // ③ HOLD 만료 임박(6시간 이내) 강조
  const holdMsLeft = booking.holdExpiresAt
    ? booking.holdExpiresAt.getTime() - Date.now()
    : null;
  const holdUrgent = holdMsLeft !== null && holdMsLeft < 6 * 60 * 60 * 1000;

  const linkedRows = [
    ...(booking.parentBooking
      ? [{ row: booking.parentBooking, isParent: true }]
      : []),
    ...booking.extensions.map((row) => ({ row, isParent: false })),
  ];

  return (
    <div className="space-y-5">
      <Link
        href="/partner"
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-800"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        {t("bookingDetail.back")}
      </Link>

      {/* 예약 요약 카드 */}
      <section className="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-lg font-bold text-neutral-900">
              {formatVillaName({ name: booking.villaName, nameVi: booking.villaNameVi })}
            </h1>
            {booking.villaComplex && (
              <p className="truncate text-xs text-neutral-400">{booking.villaComplex}</p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${statusStyle}`}
          >
            {t(`status.${booking.status}`)}
          </span>
        </div>

        <dl className="mt-4 space-y-2.5 border-t border-neutral-100 pt-4 text-sm">
          <Row label={t("bookingDetail.stay")}>
            {formatDate(booking.checkIn)} – {formatDate(booking.checkOut)} ·{" "}
            {t("bookings.nights", { count: booking.nights })}
          </Row>
          <Row label={t("bookingDetail.guest")}>{booking.guestName}</Row>
          <Row label={t("bookingDetail.guestCount")}>
            {t("bookings.guests", { count: booking.guestCount })}
          </Row>
          {booking.roomChargeVnd && (
            <Row label={t("bookings.roomCharge")}>
              <span className="font-bold text-teal-700">
                {formatVndDot(booking.roomChargeVnd)}
              </span>
            </Row>
          )}
          {/* ③ HOLD 만료 시각 — 언제까지 확정(입금)해야 하는지. 임박(6h)이면 강조 */}
          {booking.holdExpiresAt && (
            <Row label={t("bookingDetail.holdUntil")}>
              <span
                className={`font-bold ${holdUrgent ? "text-rose-600" : "text-amber-700"}`}
              >
                {formatVnDateTime(booking.holdExpiresAt)}
              </span>
            </Row>
          )}
          {outstanding !== null && outstanding > 0n && booking.status !== "HOLD" && (
            <Row label={t("bookingDetail.outstanding")}>
              <span className="font-bold text-rose-600">
                {formatVndDot(booking.outstandingVnd)}
              </span>
            </Row>
          )}
        </dl>
        {booking.holdExpiresAt && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
              holdUrgent ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {t("bookingDetail.holdHint")}
          </p>
        )}
      </section>

      {/* ⑤ 연장(분할숙박) 묶음 — 부모/자식 상호 링크 + 묶음 합계 */}
      {linkedRows.length > 0 && (
        <section className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
          <h2 className="mb-1 flex items-center gap-1.5 text-base font-bold text-neutral-900">
            <span className="material-symbols-outlined text-lg text-indigo-500">link</span>
            {t("bookingDetail.linkedTitle")}
          </h2>
          <p className="mb-3 text-sm text-neutral-500">{t("bookingDetail.linkedSubtitle")}</p>
          <ul className="space-y-2">
            {linkedRows.map(({ row, isParent }) => (
              <li key={row.id}>
                <Link
                  href={`/partner/bookings/${row.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-neutral-100 p-3 transition-transform active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-800">
                      {formatVillaName({ name: row.villaName, nameVi: row.villaNameVi })}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatDayMonth(row.checkIn)} – {formatDayMonth(row.checkOut)} ·{" "}
                      {t(`status.${row.status}`)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-bold uppercase text-indigo-500">
                      {isParent
                        ? t("bookingDetail.linkedParent")
                        : t("bookingDetail.linkedChild")}
                    </p>
                    {row.roomChargeVnd && (
                      <p className="text-sm font-bold text-teal-700">
                        {formatVndDot(row.roomChargeVnd)}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {booking.groupTotalVnd && (
            <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
              <span className="text-xs font-medium text-neutral-400">
                {t("bookingDetail.groupTotal")}
              </span>
              <span className="text-base font-bold text-indigo-700">
                {formatVndDot(booking.groupTotalVnd)}
              </span>
            </div>
          )}
        </section>
      )}

      {/* ③ 입금 계좌 안내 — 공개 /p 페이지와 동일 소스(운영 계좌). HOLD·미납 CONFIRMED만 */}
      {bank && (
        <section className="rounded-2xl border border-teal-100 bg-teal-50/50 p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-600">
            {t("bookingDetail.bankLabel")}
          </p>
          <h2 className="mt-0.5 text-base font-bold text-neutral-900">
            {t("bookingDetail.bankTitle")}
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label={t("bookingDetail.bankName")}>
              <span className="font-semibold">{bank.name}</span>
            </Row>
            <Row label={t("bookingDetail.bankNumber")}>
              <span className="font-semibold tracking-wide">{bank.number}</span>
            </Row>
            {bank.holder && (
              <Row label={t("bookingDetail.bankHolder")}>
                <span className="font-semibold">{bank.holder}</span>
              </Row>
            )}
            {booking.status === "HOLD" && booking.holdDepositVnd ? (
              <>
                {/* HOLD 확정 = 선금 입금 — 선금(강조)+총액 2행. 선금율 숫자는 비노출(금액만) */}
                <Row label={t("bookingDetail.bankDeposit")}>
                  <span className="text-base font-bold text-teal-700">
                    {formatVndDot(booking.holdDepositVnd)}
                  </span>
                </Row>
                <Row label={t("bookingDetail.bankTotal")}>
                  <span className="font-semibold text-neutral-600">
                    {formatVndDot(booking.roomChargeVnd)}
                  </span>
                </Row>
              </>
            ) : (
              <Row label={t("bookingDetail.bankAmount")}>
                <span className="font-bold text-teal-700">
                  {formatVndDot(
                    outstanding !== null && outstanding > 0n
                      ? booking.outstandingVnd
                      : booking.roomChargeVnd
                  )}
                </span>
              </Row>
            )}
          </dl>
          <p className="mt-3 text-xs text-neutral-500">
            {booking.status === "HOLD" && booking.holdDepositVnd
              ? t("bookingDetail.bankDepositHint")
              : t("bookingDetail.bankHint")}
          </p>
        </section>
      )}

      {/* ② 취소·변경·홀드연장 요청 (운영자 승인형) */}
      <PartnerChangeRequestPanel
        bookingId={booking.id}
        bookingStatus={booking.status}
        requests={booking.changeRequests.map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          note: r.note,
          resolutionNote: r.resolutionNote,
          createdAt: r.createdAt.toISOString(),
          resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        }))}
      />

      {/* 투숙객 명단 사전 제출 */}
      <section className="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-base font-bold text-neutral-900">{t("roster.title")}</h2>
        <p className="mb-4 text-sm text-neutral-500">{t("roster.subtitle")}</p>
        <PartnerRosterForm
          bookingId={booking.id}
          initialRoster={booking.guestRoster}
          canEdit={booking.canEditRoster}
        />
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 font-medium text-neutral-400">{label}</dt>
      <dd className="text-right text-neutral-800">{children}</dd>
    </div>
  );
}
