// /bookings/[id] — 예약 상세 (T2.5, Stitch b11-booking-detail 변환)
// RSC: prisma 직접 조회 — (admin) 레이아웃 가드 하. F4 체크인·아웃(Sprint 3)의 진입점.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatThousands } from "@/lib/format";
import { toDateOnlyString } from "@/lib/date-vn";
import { formatRemainingHours } from "@/lib/booking-stats";
import { stripOptionCosts } from "@/lib/service-catalog";
import ActionPanel from "./action-panel";
import PaperDocsSection from "./paper-docs-section";
import MemoBox from "./memo-box";
import RosterBox from "./roster-box";
import PaymentPanel from "./payment-panel";
import ServiceOrdersPanel, {
  type OrderRow,
  type OrderCatalogItem,
  type SelectedOptionSnapshot,
} from "./service-orders-panel";
import { summarizeCollection } from "@/lib/payment";
import { krwToVndSnapshot, usdToVndSnapshot } from "@/lib/pricing";
import { guestTokenState } from "@/lib/guest-checkin";
import GuestTokenCard, { type GuestTokenState } from "./guest-token-card";
import PartnerAssignCard from "./partner-assign-card";
import BookingModifyPanel, { type VillaOption } from "./booking-modify-panel";
import ChangeRequestPanel from "./change-request-panel";
import { modifiableKind } from "@/lib/booking-modify";

/** 연결된 연장(분할 숙박) 예약 요약 — 부모 상세의 읽기전용 목록용. saleLabel은 canViewFinance만 채움 */
type ExtensionItem = {
  id: string;
  villaName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: string;
  saleLabel: string | null;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("bookingDetail")} — Villa Go` };
}

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

  // S-RBAC-3: STAFF는 재무(판매가·결제 금액) 비공개 — select·렌더 모두에서 제외 (1차 서버 방어)
  const session = await auth();
  const showFinance = canViewFinance(session?.user?.role);

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
      guestRoster: true,
      holdExpiresAt: true,
      saleCurrency: true,
      // 판매가(KRW·VND)·환율 스냅샷은 canViewFinance만 — STAFF면 select 자체에서 제외
      ...(showFinance
        ? {
            totalSaleKrw: true,
            totalSaleVnd: true,
            totalSaleUsd: true,
            fxVndPerKrw: true,
            fxVndPerUsd: true,
            // 파트너 지정·미수(ADR-0022 PARTNER-2c) — 재무 전용
            partnerId: true,
            partner: { select: { id: true, name: true } },
            receivable: {
              select: {
                status: true,
                totalVnd: true,
                depositPaidVnd: true,
                balancePaidVnd: true,
              },
            },
          }
        : {}),
      supplierCostVnd: true, // 원가는 STAFF도 OK (SUPPLIER 동일 가시성)
      breakfastIncluded: true,
      note: true,
      cancelReason: true,
      villa: { select: { id: true, name: true } },
      // 분할 숙박(ADR-0030 T-E/T-G) — 이 예약이 다른 예약의 연장이면 원 예약 역링크(금액 아님)
      parentBookingId: true,
      parentBooking: { select: { id: true, villa: { select: { name: true } } } },
      // T3.2 — 미서명 배지·사후 서명 진입점 / T3.6 — 여권 전달 가능 여부·전달 시각
      checkInRecord: {
        select: {
          signatureUrl: true,
          tamTruSentAt: true,
          passportPhotoUrls: true,
          paperDocUrls: true, // #1 체크인 종이서류(비공개 증빙)
        },
      },
      payments: {
        orderBy: { receivedAt: "asc" },
        // STAFF: 결제 금액(currency·amount)도 재무 → 상태(날짜·수단·메모)만. canViewFinance만 금액 select.
        select: {
          id: true,
          receivedAt: true,
          method: true,
          note: true,
          ...(showFinance
            ? { currency: true, amount: true, vndEquivalent: true }
            : {}),
        },
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

  // 게스트 입금통보 (B1) — 가장 최근 1건. 게스트가 계좌이체 후 보낸 "입금했어요" 신호.
  // 운영자가 입금 확정 전 은행 대조 시 참고. depositorName·notedAt은 changes JSON에서 추출.
  const paymentNoticeLog = await prisma.auditLog.findFirst({
    where: { entity: "Booking", entityId: id, action: "GUEST_PAYMENT_NOTICE" },
    orderBy: { createdAt: "desc" },
    select: { changes: true, createdAt: true },
  });
  const paymentNotice = paymentNoticeLog
    ? (() => {
        const c = paymentNoticeLog.changes as
          | { depositorName?: { new?: unknown } }
          | null;
        const name =
          c && typeof c.depositorName?.new === "string" ? c.depositorName.new : null;
        return { depositorName: name, notedAt: paymentNoticeLog.createdAt };
      })()
    : null;

  // ── 부가서비스 주문 패널 (ADR-0019 S2) ──
  // 원가(costVnd)는 showFinance(canViewFinance)만 select·직렬화. 카탈로그명은 주문에 연결해 표시.
  const tServices = await getTranslations("adminServices");
  const [serviceOrdersRaw, activeCatalog] = await Promise.all([
    prisma.serviceOrder.findMany({
      where: { bookingId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        status: true,
        serviceDate: true,
        serviceTime: true,
        quantity: true,
        priceKrw: true,
        priceVnd: true,
        requestedVia: true,
        guestNote: true,
        selectedOptions: true,
        catalogItemId: true,
        // ADR-0023 S2 — 원천 공급자 발주 흐름(발주·수락·정산)
        vendorId: true,
        vendorStatus: true,
        poSentAt: true,
        vendorRespondedAt: true,
        vendorRejectReason: true,
        vendorSettledAt: true,
        vendorSettleMethod: true,
        // 일정 협의(propose) — 공급자 대안 시간 제안·운영자 처리 시각
        proposedServiceDate: true,
        proposedServiceTime: true,
        vendorProposalNote: true,
        vendorProposalRespondedAt: true,
        vendor: { select: { name: true } },
        ...(showFinance ? { costVnd: true } : {}),
      },
    }),
    prisma.serviceCatalogItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      // 판매가만 — 원가는 주문 추가 UI에 불필요하므로 select 자체에서 제외
      select: {
        id: true,
        type: true,
        nameKo: true,
        unitLabelKo: true,
        priceVnd: true,
        options: true,
      },
    }),
  ]);

  // 주문에 연결된 카탈로그명 조회(삭제됐을 수 있으니 type 라벨로 폴백)
  const catalogNameById = new Map(activeCatalog.map((c) => [c.id, c.nameKo]));
  const missingIds = serviceOrdersRaw
    .map((o) => o.catalogItemId)
    .filter((cid): cid is string => !!cid && !catalogNameById.has(cid));
  if (missingIds.length > 0) {
    const extras = await prisma.serviceCatalogItem.findMany({
      where: { id: { in: missingIds } },
      select: { id: true, nameKo: true },
    });
    for (const e of extras) catalogNameById.set(e.id, e.nameKo);
  }

  const parseSnapshot = (raw: unknown): SelectedOptionSnapshot[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is { group: string; key: string; labelKo: string } =>
        !!s && typeof s === "object" && typeof (s as { labelKo?: unknown }).labelKo === "string"
      )
      .map((s) => ({
        group: (s.group === "addon" || s.group === "modifier" ? s.group : "variant") as
          | "variant"
          | "addon"
          | "modifier",
        key: String(s.key ?? ""),
        labelKo: s.labelKo,
      }));
  };

  const serviceOrders: OrderRow[] = serviceOrdersRaw.map((o) => ({
    id: o.id,
    type: o.type,
    status: o.status,
    serviceDate: o.serviceDate ? o.serviceDate.toISOString().slice(0, 10) : null,
    serviceTime: o.serviceTime,
    nameKo:
      (o.catalogItemId && catalogNameById.get(o.catalogItemId)) ||
      tServices(`types.${o.type}`),
    quantity: o.quantity,
    priceKrw: o.priceKrw,
    priceVnd: o.priceVnd?.toString() ?? null,
    requestedVia: o.requestedVia,
    guestNote: o.guestNote,
    selectedOptions: parseSnapshot(o.selectedOptions),
    // ADR-0023 S2 — 원천 공급자 발주 흐름
    vendorId: o.vendorId,
    vendorName: o.vendor?.name ?? null,
    vendorStatus: o.vendorStatus,
    poSentAt: o.poSentAt?.toISOString() ?? null,
    vendorRespondedAt: o.vendorRespondedAt?.toISOString() ?? null,
    vendorRejectReason: o.vendorRejectReason,
    vendorSettledAt: o.vendorSettledAt?.toISOString() ?? null,
    vendorSettleMethod: o.vendorSettleMethod,
    // 일정 협의(propose) — 제안 날짜는 @db.Date(YYYY-MM-DD), 처리 시각은 ISO 타임스탬프
    proposedServiceDate: o.proposedServiceDate
      ? o.proposedServiceDate.toISOString().slice(0, 10)
      : null,
    proposedServiceTime: o.proposedServiceTime,
    vendorProposalNote: o.vendorProposalNote,
    vendorProposalRespondedAt: o.vendorProposalRespondedAt?.toISOString() ?? null,
    ...(showFinance && "costVnd" in o
      ? { costVnd: (o as { costVnd: bigint }).costVnd.toString() }
      : {}),
  }));

  const serviceCatalog: OrderCatalogItem[] = activeCatalog.map((c) => ({
    id: c.id,
    type: c.type,
    nameKo: c.nameKo,
    unitLabelKo: c.unitLabelKo ?? "",
    priceVnd: c.priceVnd?.toString() ?? null,
    // 주문 패널은 옵션 원가를 쓰지 않음 — 클라 노출 차단 위해 항상 제거(원칙2)
    options: stripOptionCosts(c.options ?? null),
  }));

  const code = booking.id.slice(-8);
  const stepIndex = STEP_INDEX[booking.status];
  const terminal = stepIndex === undefined;
  const steps = ["hold", "confirmed", "checkedin", "checkedout"] as const;
  const countdown =
    booking.status === BookingStatus.HOLD
      ? formatRemainingHours(booking.holdExpiresAt, now)
      : null;

  // 판매가 표시 문자열 — showFinance일 때만 (STAFF는 select에서 빠져 undefined)
  const totalSale =
    showFinance && "totalSaleKrw" in booking
      ? booking.saleCurrency === "KRW"
        ? `${formatThousands(booking.totalSaleKrw ?? 0)}원`
        : booking.saleCurrency === "USD"
          ? `${formatThousands(
              (booking as { totalSaleUsd?: number | null }).totalSaleUsd ?? 0
            )}$`
          : `${formatThousands(booking.totalSaleVnd ?? 0n)}₫`
      : null;

  // 수납 요약 (정산 2차 P2-1) — showFinance만. 견적 판매가 VND환산 대비 실수납.
  // ★ 공급자 비노출: showFinance=false면 paymentPanel 자체를 렌더하지 않는다.
  const paymentPanel =
    showFinance && "totalSaleKrw" in booking
      ? (() => {
          const b = booking as typeof booking & {
            totalSaleKrw: number | null;
            totalSaleVnd: bigint | null;
            totalSaleUsd: number | null;
            fxVndPerKrw: { toString(): string } | null;
            fxVndPerUsd: { toString(): string } | null;
          };
          // 견적 VND 환산 — VND 그대로, KRW·USD는 예약 시점 스냅샷 환율(없으면 null=미수 산출 불가)
          const expected =
            b.saleCurrency === "VND"
              ? (b.totalSaleVnd ?? 0n)
              : b.saleCurrency === "USD"
                ? b.fxVndPerUsd
                  ? usdToVndSnapshot(b.totalSaleUsd ?? 0, b.fxVndPerUsd.toString())
                  : null
                : b.fxVndPerKrw
                  ? krwToVndSnapshot(b.totalSaleKrw ?? 0, b.fxVndPerKrw.toString())
                  : null;
          const likes = b.payments.map((p) => ({
            currency: (p as { currency: "KRW" | "VND" | "USD" }).currency,
            amount: (p as { amount: bigint }).amount,
            vndEquivalent: (p as { vndEquivalent: bigint | null }).vndEquivalent,
          }));
          const s =
            expected != null
              ? summarizeCollection(likes, expected)
              : null;
          const collected = likes.reduce(
            (sum, p) => sum + (p.vndEquivalent ?? 0n),
            0n
          );
          return {
            saleCurrency: b.saleCurrency as "KRW" | "VND" | "USD",
            defaultFx:
              b.saleCurrency === "USD"
                ? (b.fxVndPerUsd ? b.fxVndPerUsd.toString() : null)
                : (b.fxVndPerKrw ? b.fxVndPerKrw.toString() : null),
            payments: b.payments.map((p) => ({
              id: p.id,
              receivedAt: p.receivedAt.toISOString(),
              method: p.method,
              currency: (p as { currency?: string }).currency,
              amount: (p as { amount?: bigint }).amount?.toString(),
              note: p.note,
            })),
            summary: {
              collectedVndEquivalent: (s?.collectedVndEquivalent ?? collected).toString(),
              expectedVndEquivalent:
                s != null ? s.expectedVndEquivalent.toString() : null,
              outstandingVnd: s != null ? s.outstandingVnd.toString() : null,
              status: (s?.status ?? "FX_UNKNOWN") as
                | "UNPAID"
                | "PARTIAL"
                | "PAID"
                | "OVERPAID"
                | "FX_UNKNOWN",
              paymentCount: b.payments.length,
            },
          };
        })()
      : null;

  // 파트너 지정 카드 props (ADR-0022 PARTNER-2c) — 재무 + 여행사/랜드사 채널만.
  const partnerCard =
    showFinance &&
    (booking.channel === "TRAVEL_AGENCY" || booking.channel === "LAND_AGENCY") &&
    "partnerId" in booking
      ? (() => {
          const b = booking as typeof booking & {
            partner: { id: string; name: string } | null;
            receivable: {
              status: string;
              totalVnd: bigint;
              depositPaidVnd: bigint;
              balancePaidVnd: bigint;
            } | null;
          };
          const rcv = b.receivable
            ? {
                status: b.receivable.status,
                totalVnd: b.receivable.totalVnd.toString(),
                outstandingVnd: (() => {
                  const o =
                    b.receivable.totalVnd -
                    b.receivable.depositPaidVnd -
                    b.receivable.balancePaidVnd;
                  return (o > 0n ? o : 0n).toString();
                })(),
              }
            : null;
          return { current: b.partner, receivable: rcv };
        })()
      : null;

  // 게스트 셀프 체크인 토큰 카드 props (ADR-0019 S3) — GuestCheckinToken은 Booking 역관계가 없어 별도 조회.
  //   절대 URL용 origin 산출(프록시 헤더).
  const tokenRow = await prisma.guestCheckinToken.findUnique({
    where: { bookingId: id },
    select: { token: true, expiresAt: true, revokedAt: true, agreementSignedAt: true },
  });
  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "";
  const origin = host ? `${proto}://${host}` : "";
  const guestToken: GuestTokenState | null = tokenRow
    ? {
        token: tokenRow.token,
        url: `/g/${tokenRow.token}`,
        expiresAt: tokenRow.expiresAt.toISOString(),
        revoked: guestTokenState(tokenRow, now) === "REVOKED",
        signedAt: tokenRow.agreementSignedAt?.toISOString() ?? null,
      }
    : null;

  // 파트너 취소·변경·홀드연장 요청 (T-partner-workflow-gaps ②) — 대기 요청은 우측 상단에서 처리
  const changeRequestsRaw = await prisma.bookingChangeRequest.findMany({
    where: { bookingId: booking.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      kind: true,
      status: true,
      note: true,
      resolutionNote: true,
      createdAt: true,
      resolvedAt: true,
      partner: { select: { name: true } },
    },
  });
  const changeRequests = changeRequestsRaw.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    note: r.note,
    resolutionNote: r.resolutionNote,
    partnerName: r.partner.name,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  }));

  // 예약 변경 패널 (F-booking-modify) — 변경 가능 상태에서만. 빌라 셀렉트 후보(현재 빌라 포함).
  const modKind = modifiableKind(booking.status);
  let villaOptions: VillaOption[] = [];
  if (modKind !== "NONE") {
    const villas = await prisma.villa.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    villaOptions = villas;
    // 현재 빌라가 후보에 없으면(예: DRAFT 등) 앞에 추가해 셀렉트 표시 유지
    if (!villaOptions.some((v) => v.id === booking.villa.id)) {
      villaOptions = [{ id: booking.villa.id, name: booking.villa.name }, ...villaOptions];
    }
  }

  // 분할 숙박(ADR-0030 T-E) — 연결된 연장 예약. 확장 가능(CONFIRMED·CHECKED_IN)일 때만.
  const extendable =
    booking.status === BookingStatus.CONFIRMED || booking.status === BookingStatus.CHECKED_IN;
  let extensions: ExtensionItem[] = [];
  if (extendable) {
    const kids = await prisma.booking.findMany({
      where: { parentBookingId: booking.id },
      orderBy: { checkIn: "asc" },
      select: {
        id: true,
        status: true,
        checkIn: true,
        checkOut: true,
        nights: true,
        villa: { select: { name: true } },
        // 판매가는 canViewFinance만 select (원칙2)
        ...(showFinance ? { saleCurrency: true, totalSaleKrw: true, totalSaleVnd: true } : {}),
      },
    });
    extensions = kids.map((k) => {
      const kf = k as {
        saleCurrency?: string;
        totalSaleKrw?: number | null;
        totalSaleVnd?: bigint | null;
      };
      let saleLabel: string | null = null;
      if (showFinance) {
        if (kf.saleCurrency === "VND" && kf.totalSaleVnd != null) {
          saleLabel = `${new Intl.NumberFormat("vi-VN").format(Number(kf.totalSaleVnd))}₫`;
        } else if (kf.saleCurrency === "KRW" && kf.totalSaleKrw != null) {
          saleLabel = `${new Intl.NumberFormat("ko-KR").format(kf.totalSaleKrw)}₩`;
        }
      }
      return {
        id: k.id,
        villaName: k.villa.name,
        checkIn: toDateOnlyString(k.checkIn),
        checkOut: toDateOnlyString(k.checkOut),
        nights: k.nights,
        status: k.status,
        saleLabel,
      };
    });
  }

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

      {/* 분할 숙박(ADR-0030 T-G) — 이 예약이 연장 예약이면 원 예약으로 역링크 */}
      {booking.parentBookingId && (
        <Link
          href={`/bookings/${booking.parentBookingId}`}
          className="flex items-center gap-2 bg-admin-card px-4 py-3 rounded-xl border border-admin-primary/40 text-sm text-admin-primary hover:bg-admin-primary/10 transition-colors"
        >
          <span className="material-symbols-outlined text-base">link</span>
          {t("detail.extendedFrom", { villa: booking.parentBooking?.villa.name ?? "" })}
        </Link>
      )}

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
      ) : null}
      {/* 취소됐지만 수납이 남은 예약 — 환불 확인 필요 배너 (A4).
          환불 처리 후 결제 행 삭제(Xóa)로 해소한다(삭제는 AuditLog에 남음). */}
      {booking.status === "CANCELLED" && booking.payments.length > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-5 py-3 flex items-center gap-3">
          <span className="material-symbols-outlined text-rose-400 shrink-0">currency_exchange</span>
          <p className="text-sm font-bold text-rose-200 [word-break:keep-all]">
            {t("detail.refundNeeded.body", { count: booking.payments.length })}
            <span className="font-medium text-rose-300/80"> {t("detail.refundNeeded.hint")}</span>
          </p>
        </div>
      )}
      {!terminal && (
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
              {/* 판매가(총액) — canViewFinance만. STAFF는 행 자체 비표시(원가만) */}
              {showFinance && totalSale && (
                <div>
                  <p className="text-xs text-admin-muted mb-1">{t("detail.price.totalSale")}</p>
                  <p className="text-xl font-extrabold text-white tabular-nums">{totalSale}</p>
                </div>
              )}
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

          {/* 게스트 입금통보 (B1) — 게스트가 done 화면에서 "입금했습니다" 신호를 보낸 경우 알림.
              운영자가 은행 대조 후 입금 확정하는 데 참고. 상태는 자동 변경되지 않음. */}
          {paymentNotice && (
            <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-4 flex items-start gap-3">
              <span className="material-symbols-outlined text-teal-400 mt-0.5">receipt_long</span>
              <div className="space-y-0.5">
                <p className="text-sm font-bold text-teal-300">{t("detail.paymentNotice.title")}</p>
                <p className="text-xs text-admin-muted">
                  {paymentNotice.depositorName
                    ? t("detail.paymentNotice.withName", {
                        name: paymentNotice.depositorName,
                        at: formatDateTime(paymentNotice.notedAt),
                      })
                    : t("detail.paymentNotice.noName", {
                        at: formatDateTime(paymentNotice.notedAt),
                      })}
                </p>
              </div>
            </div>
          )}

          {/* 결제 기록 — ADMIN(canViewFinance)은 실수납 패널(요약·추가·삭제), STAFF는 읽기전용(금액 비표시) */}
          {paymentPanel ? (
            <PaymentPanel
              bookingId={booking.id}
              saleCurrency={paymentPanel.saleCurrency}
              defaultFx={paymentPanel.defaultFx}
              payments={paymentPanel.payments}
              summary={paymentPanel.summary}
            />
          ) : (
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
                      {/* 결제 금액 열 — canViewFinance만 (STAFF는 입금 상태만, 금액 비표시) */}
                      {showFinance && (
                        <th className="px-6 py-3 text-right">{t("detail.payments.amount")}</th>
                      )}
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
                        {showFinance && "amount" in p && (
                          <td className="px-6 py-4 font-semibold text-white text-right tabular-nums whitespace-nowrap">
                            {formatThousands(p.amount)}
                            {p.currency === "KRW" ? "원" : p.currency === "VND" ? "₫" : " USD"}
                          </td>
                        )}
                        <td className="px-6 py-4 text-admin-muted">{p.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          )}

          {/* 부가서비스 주문 패널 (ADR-0019 S2, b20) — 종결(취소·만료·노쇼) 예약엔 비표시 */}
          {!terminal && (
            <ServiceOrdersPanel
              bookingId={booking.id}
              catalog={serviceCatalog}
              orders={serviceOrders}
              showCost={showFinance}
              dateMin={booking.checkIn.toISOString().slice(0, 10)}
              dateMax={booking.checkOut.toISOString().slice(0, 10)}
            />
          )}
        </div>

        {/* 우측 (33%) */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* 파트너 요청 처리 (T-partner-workflow-gaps ②) — 대기 요청이 있으면 최상단 강조 */}
          <ChangeRequestPanel requests={changeRequests} />

          <ActionPanel
            bookingId={booking.id}
            status={booking.status}
            agreementUnsigned={
              booking.status === "CHECKED_IN" &&
              booking.checkInRecord !== null &&
              !booking.checkInRecord.signatureUrl
            }
            hasPassport={(booking.checkInRecord?.passportPhotoUrls.length ?? 0) > 0}
            tamTruSentAt={booking.checkInRecord?.tamTruSentAt?.toISOString() ?? null}
          />

          {/* 예약 변경 (F-booking-modify) — 변경 가능 상태에서만. CHECKED_IN은 체크아웃일만 활성 */}
          {modKind !== "NONE" && (
            <BookingModifyPanel
              bookingId={booking.id}
              status={booking.status}
              villaOptions={villaOptions}
              initial={{
                villaId: booking.villa.id,
                checkIn: toDateOnlyString(booking.checkIn),
                checkOut: toDateOnlyString(booking.checkOut),
                guestName: booking.guestName,
                guestCount: booking.guestCount,
                guestPhone: booking.guestPhone ?? "",
                breakfastIncluded: booking.breakfastIncluded,
              }}
            />
          )}

          {/* 연결된 연장(분할 숙박) 예약 — 읽기전용 목록. 생성은 예약변경 패널의 분할 흐름에서 (ADR-0030) */}
          {extendable && extensions.length > 0 && (
            <section className="bg-admin-card rounded-xl border border-[#334155] overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-700">
                <h2 className="font-bold text-sm text-white">{t("detail.extend.linkedTitle")}</h2>
              </div>
              <ul className="px-6 py-3 space-y-2">
                {extensions.map((e) => (
                  <li key={e.id} className="text-xs flex items-center justify-between gap-2">
                    <span className="text-white">
                      {e.villaName}{" "}
                      <span className="text-admin-muted">
                        {e.checkIn} → {e.checkOut} ({t("detail.extend.nights", { n: e.nights })})
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {e.saleLabel && <span className="text-admin-muted">{e.saleLabel}</span>}
                      <Link href={`/bookings/${e.id}`} className="text-admin-primary hover:underline">
                        {t("detail.extend.view")}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 파트너 지정·미수 (ADR-0022 PARTNER-2c) — 재무 + 여행사/랜드사 채널만 */}
          {partnerCard && (
            <PartnerAssignCard
              bookingId={booking.id}
              channel={booking.channel as "TRAVEL_AGENCY" | "LAND_AGENCY"}
              saleCurrency={booking.saleCurrency as "KRW" | "VND" | "USD"}
              current={partnerCard.current}
              receivable={partnerCard.receivable}
            />
          )}

          {/* #1 체크인 종이서류 사진 — 체크인 기록이 있을 때(post-checkin)만. 비공개 증빙 */}
          {booking.checkInRecord !== null && (
            <PaperDocsSection
              bookingId={booking.id}
              initialUrls={booking.checkInRecord.paperDocUrls}
            />
          )}

          {/* 실제 투숙객 명단 (T-guest-roster) — 확정~체크인 전날 입력. 종결 상태는 비표시 */}
          {!terminal && (
            <RosterBox
              bookingId={booking.id}
              initialRoster={booking.guestRoster}
              showReminder={booking.status === BookingStatus.CONFIRMED && !booking.guestRoster}
            />
          )}

          {/* 게스트 셀프 체크인 링크 (ADR-0019 S3) — 종결 상태는 비표시 */}
          {!terminal && (
            <GuestTokenCard bookingId={booking.id} initial={guestToken} origin={origin} />
          )}

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
