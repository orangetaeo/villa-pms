"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import ResponsiveTable, { type ResponsiveColumn } from "@/components/admin/responsive-table";
import { formatVnd } from "@/lib/format";
import PartnerForm, { type PartnerFormValues } from "./partner-form";

export interface SerializedPartnerAggregate {
  partner: {
    id: string;
    type: "TRAVEL_AGENCY" | "LAND_AGENCY";
    name: string;
    nameVi: string | null;
    creditTier: "A" | "B" | "C";
    creditLimitVnd: string;
    depositRatePct: number;
    paymentTermDays: number;
    status: "ACTIVE" | "SUSPENDED" | "BLOCKED";
    contactPhone: string | null;
    approvalStatus: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
    rejectionReason: string | null;
    userId: string | null;
  };
  outstandingVnd: string;
  aging: { "0-7": string; "8-15": string; "16-30": string; "30+": string; total: string };
  overdue: boolean;
  bookingCount: number;
}

const TIER_BADGE: Record<string, string> = {
  A: "bg-slate-700 text-slate-200",
  B: "bg-amber-500/20 text-amber-300",
  C: "bg-purple-500/20 text-purple-300",
};
const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-300",
  SUSPENDED: "bg-amber-500/15 text-amber-300",
  BLOCKED: "bg-red-500/15 text-red-300",
};

type ApprovalStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

const APPROVAL_BADGE: Record<ApprovalStatus, { cls: string; key: string; icon: string }> = {
  PENDING_APPROVAL: {
    cls: "bg-amber-500/90 text-white",
    key: "approvalStatusPending",
    icon: "hourglass_top",
  },
  APPROVED: { cls: "bg-sky-500/90 text-white", key: "approvalStatusApproved", icon: "verified" },
  REJECTED: { cls: "bg-red-500/90 text-white", key: "approvalStatusRejected", icon: "block" },
};

export default function PartnersManager({
  partners,
  canApprove,
}: {
  partners: SerializedPartnerAggregate[];
  canApprove: boolean;
}) {
  const t = useTranslations("adminPartners");
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 자가가입 승인/거절 상태 (ADR-0028 PP4 — vendors approval 미러)
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalMsg, setApprovalMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 거절 사유 입력 모달 대상 파트너(null=닫힘)
  const [rejectTarget, setRejectTarget] = useState<SerializedPartnerAggregate | null>(null);

  // ── 승인/거절 (ADR-0028 PP4) — PATCH /api/partners/[id]/approval ────────────
  const handleApproval = async (
    r: SerializedPartnerAggregate,
    action: "APPROVE" | "REJECT",
    rejectionReason?: string
  ) => {
    setApprovalBusy(true);
    setApprovalMsg(null);
    try {
      const res = await fetch(`/api/partners/${r.partner.id}/approval`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "REJECT" ? { rejectionReason: rejectionReason || null } : {}),
        }),
      });
      if (!res.ok) {
        setApprovalMsg({ ok: false, text: t("approvalError") });
        return;
      }
      setRejectTarget(null);
      setApprovalMsg({ ok: true, text: action === "APPROVE" ? t("approved") : t("rejected") });
      router.refresh();
    } catch {
      setApprovalMsg({ ok: false, text: t("approvalError") });
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleApprove = (r: SerializedPartnerAggregate) => {
    if (!window.confirm(t("approveConfirm"))) return;
    void handleApproval(r, "APPROVE");
  };

  const create = async (values: PartnerFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          billingCycle: values.billingCycle || null,
        }),
      });
      if (!res.ok) {
        setError(t("saveFailed"));
        setSubmitting(false);
        return;
      }
      setShowCreate(false);
      setSubmitting(false);
      router.refresh();
    } catch {
      setError(t("saveFailed"));
      setSubmitting(false);
    }
  };

  const columns: ResponsiveColumn<SerializedPartnerAggregate>[] = [
    {
      key: "name",
      header: t("col.name"),
      cell: (r) => {
        const ab = APPROVAL_BADGE[r.partner.approvalStatus];
        return (
          <div className="flex flex-col gap-1">
            <Link
              href={`/partners/${r.partner.id}`}
              className="font-bold text-white hover:text-admin-primary"
            >
              {r.partner.name}
              {r.partner.nameVi && (
                <span className="block text-[11px] font-normal text-slate-500">
                  {r.partner.nameVi}
                </span>
              )}
            </Link>
            <div className="flex flex-wrap items-center gap-1">
              {/* 승인 상태 배지 — APPROVED가 아니면(대기·거절) 표시 */}
              {r.partner.approvalStatus !== "APPROVED" && (
                <span
                  className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ab.cls}`}
                >
                  <span className="material-symbols-outlined text-[12px]">{ab.icon}</span>
                  {t(ab.key)}
                </span>
              )}
              {/* 로그인 계정 연결 여부 (간단 표시) */}
              {r.partner.userId && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-400">
                  <span className="material-symbols-outlined text-[12px]">badge</span>
                  {t("hasAccountBadge")}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "type",
      header: t("col.type"),
      cell: (r) => (
        <span className="text-slate-300">{t(`types.${r.partner.type}`)}</span>
      ),
    },
    {
      key: "tier",
      header: t("col.tier"),
      cell: (r) => (
        <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${TIER_BADGE[r.partner.creditTier]}`}>
          {t(`tierShort.${r.partner.creditTier}`)}
        </span>
      ),
    },
    {
      key: "outstanding",
      header: t("col.outstanding"),
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (r) => (
        <span className={r.overdue ? "font-bold text-red-400" : "text-slate-200"}>
          {formatVnd(r.outstandingVnd)}
          {r.overdue && (
            <span className="ml-1 align-middle text-[10px] font-bold text-red-400">● {t("overdue")}</span>
          )}
        </span>
      ),
    },
    {
      key: "limit",
      header: t("col.creditLimit"),
      className: "text-right tabular-nums text-slate-400",
      headerClassName: "text-right",
      cell: (r) =>
        r.partner.creditTier === "A" ? (
          <span className="text-slate-600">—</span>
        ) : (
          formatVnd(r.partner.creditLimitVnd)
        ),
    },
    {
      key: "status",
      header: t("col.status"),
      cell: (r) => (
        <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[r.partner.status]}`}>
          {t(`statuses.${r.partner.status}`)}
        </span>
      ),
    },
    // 자가가입 승인/거절 (ADR-0028 PP4) — PENDING_APPROVAL일 때만 액션 노출(canApprove 한정)
    {
      key: "approval",
      header: t("approve"),
      cell: (r) =>
        canApprove && r.partner.approvalStatus === "PENDING_APPROVAL" ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={approvalBusy}
              onClick={() => setRejectTarget(r)}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-bold text-slate-300 transition-colors hover:border-red-400 hover:text-red-400 disabled:opacity-50"
            >
              {t("reject")}
            </button>
            <button
              type="button"
              disabled={approvalBusy}
              onClick={() => handleApprove(r)}
              className="inline-flex items-center gap-0.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[14px]">check</span>
              {t("approve")}
            </button>
          </div>
        ) : r.partner.approvalStatus === "REJECTED" && r.partner.rejectionReason ? (
          <span
            title={r.partner.rejectionReason}
            className="text-[11px] text-red-300/90 line-clamp-1 max-w-[180px]"
          >
            {r.partner.rejectionReason}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">{t("title")}</h1>
          <p className="text-sm text-admin-muted mt-1">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setShowCreate(true);
          }}
          className="shrink-0 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white"
        >
          + {t("new")}
        </button>
      </div>

      {approvalMsg && (
        <p
          role="status"
          className={`text-xs font-medium ${approvalMsg.ok ? "text-emerald-500" : "text-red-400"}`}
        >
          {approvalMsg.text}
        </p>
      )}

      <ResponsiveTable
        columns={columns}
        rows={partners}
        rowKey={(r) => r.partner.id}
        emptyMessage={t("empty")}
        cardSummary={(r) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-white">{r.partner.name}</span>
            <span className="text-xs text-slate-400">
              {t(`types.${r.partner.type}`)} · {t(`tierShort.${r.partner.creditTier}`)} ·{" "}
              <span className={r.overdue ? "text-red-400 font-bold" : ""}>{formatVnd(r.outstandingVnd)}</span>
            </span>
          </div>
        )}
        cardFooter={(r) => (
          <Link
            href={`/partners/${r.partner.id}`}
            className="mt-1 inline-block text-xs font-bold text-admin-primary"
          >
            {t("viewDetail")} →
          </Link>
        )}
      />

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
          onClick={() => !submitting && setShowCreate(false)}
        >
          <div
            className="my-8 w-full max-w-2xl rounded-2xl border border-slate-800 bg-admin-bg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-bold text-white">{t("createTitle")}</h2>
            <PartnerForm
              mode="create"
              submitting={submitting}
              error={error}
              onSubmit={create}
              onCancel={() => !submitting && setShowCreate(false)}
            />
          </div>
        </div>
      )}

      {rejectTarget && canApprove && (
        <RejectModal
          partnerName={rejectTarget.partner.name}
          busy={approvalBusy}
          onReject={(reason) => handleApproval(rejectTarget, "REJECT", reason)}
          onClose={() => setRejectTarget(null)}
          t={t}
        />
      )}
    </div>
  );
}

// ── 자가가입 거절 사유 입력 모달 (ADR-0028 PP4 — vendors RejectModal 미러) ──────
function RejectModal({
  partnerName,
  busy,
  onReject,
  onClose,
  t,
}: {
  partnerName: string;
  busy: boolean;
  onReject: (reason: string) => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [reason, setReason] = useState("");
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-md space-y-3.5 rounded-xl border-2 border-red-500/30 bg-admin-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <span className="material-symbols-outlined text-red-400">block</span>
            {t("rejectModalTitle")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("rejectCancel")}
            className="text-slate-500 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="text-xs text-slate-400">
          <span className="font-bold text-slate-300">{partnerName}</span>
        </p>

        <div>
          <label className="text-xs text-slate-500">{t("rejectReasonLabel")}</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("rejectReasonPlaceholder")}
            maxLength={500}
            rows={3}
            className="mt-1 w-full rounded border border-slate-700 bg-admin-bg px-2.5 py-2 text-sm text-white focus:border-red-400 focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-bold text-slate-400 hover:text-white disabled:opacity-50"
          >
            {t("rejectCancel")}
          </button>
          <button
            type="button"
            onClick={() => onReject(reason.trim())}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-6 py-2 text-sm font-bold text-white transition-all hover:bg-red-500 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">block</span>
            {t("rejectConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
