"use client";

// 원천 공급자(ServiceVendor) CRUD 매니저 (ADR-0023 S1) — 목록 카드 + 생성/수정 모달.
//   /api/vendors (GET/POST) + /api/vendors/[id] (PATCH·DELETE). 저장 후 router.refresh().
//   ★ 정산계좌(bankInfo)는 showBank(canViewFinance)일 때만 입력·표시. 서버 페이로드에서도 이미 제외됨.
//   DELETE가 409(VENDOR_IN_USE)면 "사용 중 — 비활성화하세요" 안내(연결 카탈로그 보존).
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import PaginationBar from "@/components/pagination-bar";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

export interface BankInfoDraft {
  bank: string;
  account: string;
  holder: string;
}

export type ApprovalStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export interface VendorRow {
  id: string;
  name: string;
  nameKo: string;
  phone: string;
  zaloUserId: string;
  note: string;
  active: boolean;
  hasAccount: boolean;
  approvalStatus: ApprovalStatus;
  rejectionReason: string;
  catalogCount: number;
  bankInfo?: BankInfoDraft; // showBank(canViewFinance)일 때만 존재
}

interface FormDraft {
  name: string;
  nameKo: string;
  phone: string;
  zaloUserId: string;
  note: string;
  active: boolean;
  bank: string;
  account: string;
  holder: string;
}

const emptyForm = (): FormDraft => ({
  name: "",
  nameKo: "",
  phone: "",
  zaloUserId: "",
  note: "",
  active: true,
  bank: "",
  account: "",
  holder: "",
});

export default function VendorsManager({
  initialVendors,
  showBank,
  canEdit,
}: {
  initialVendors: VendorRow[];
  showBank: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("adminVendors");
  const router = useRouter();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormDraft>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // 로그인 계정 생성 모달 — 대상 공급자 + 입력값
  const [accountVendor, setAccountVendor] = useState<VendorRow | null>(null);
  const [accountPhone, setAccountPhone] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  // 자가가입 거절 사유 입력 모달 — 대상 공급자(null=닫힘)
  const [rejectVendor, setRejectVendor] = useState<VendorRow | null>(null);

  const refresh = () => router.refresh();
  const fail = () => setMessage({ ok: false, text: t("error") });

  function openCreate() {
    setEditingId(null);
    setDraft(emptyForm());
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(v: VendorRow) {
    setEditingId(v.id);
    setDraft({
      name: v.name,
      nameKo: v.nameKo,
      phone: v.phone,
      zaloUserId: v.zaloUserId,
      note: v.note,
      active: v.active,
      bank: v.bankInfo?.bank ?? "",
      account: v.bankInfo?.account ?? "",
      holder: v.bankInfo?.holder ?? "",
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setFormError(null);
    if (!draft.name.trim()) {
      setFormError(t("form.nameRequired"));
      return;
    }
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      nameKo: draft.nameKo.trim() || null,
      phone: draft.phone.trim() || null,
      zaloUserId: draft.zaloUserId.trim() || null,
      note: draft.note.trim() || null,
      active: draft.active,
    };
    // 정산계좌는 canViewFinance만 전송(STAFF는 입력칸 자체 없음). 서버도 이중 방어.
    if (showBank) {
      const hasBank = draft.bank.trim() || draft.account.trim() || draft.holder.trim();
      body.bankInfo = hasBank
        ? { bank: draft.bank.trim(), account: draft.account.trim(), holder: draft.holder.trim() }
        : null;
    }

    setBusy(true);
    setMessage(null);
    try {
      const url = editingId ? `/api/vendors/${editingId}` : "/api/vendors";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setFormError(t("form.validationFailed"));
        return;
      }
      setModalOpen(false);
      setMessage({ ok: true, text: t("saved") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(v: VendorRow) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/vendors/${v.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: v.name,
          nameKo: v.nameKo || null,
          phone: v.phone || null,
          zaloUserId: v.zaloUserId || null,
          note: v.note || null,
          active: !v.active,
          // bankInfo는 보내지 않음 — 기존값 보존(서버 정책, 미권한자도 안전)
        }),
      });
      if (!res.ok) throw new Error();
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(v: VendorRow) {
    if (!confirm(t("deleteConfirm"))) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/vendors/${v.id}`, { method: "DELETE" });
      if (res.status === 409) {
        // 연결 카탈로그·발주가 있어 삭제 불가 — 비활성화 안내
        setMessage({ ok: false, text: t("inUseWarning") });
        return;
      }
      if (!res.ok) throw new Error();
      setMessage({ ok: true, text: t("deleted") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  function openAccount(v: VendorRow) {
    setAccountVendor(v);
    setAccountPhone(v.phone || "");
    setAccountPassword("");
    setAccountError(null);
  }

  async function handleCreateAccount() {
    if (!accountVendor) return;
    setAccountError(null);
    if (accountPassword.trim().length < 8) {
      setAccountError(t("form.validationFailed"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/vendors/${accountVendor.id}/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: accountPhone.trim(),
          password: accountPassword,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "PHONE_TAKEN") setAccountError(t("accountPhoneTaken"));
        else if (data.error === "ACCOUNT_EXISTS") setAccountError(t("accountExists"));
        else setAccountError(t("accountError"));
        return;
      }
      setAccountVendor(null);
      setMessage({ ok: true, text: t("accountCreated") });
      refresh();
    } catch {
      setAccountError(t("accountError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlinkAccount(v: VendorRow) {
    if (!confirm(t("accountUnlinkConfirm"))) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/vendors/${v.id}/account`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setMessage({ ok: true, text: t("accountUnlinked") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  // ── 자가가입 승인/거절 (ADR-0023 S5) — PATCH /api/vendors/[id]/approval ──────
  async function handleApproval(
    v: VendorRow,
    action: "APPROVE" | "REJECT",
    rejectionReason?: string
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/vendors/${v.id}/approval`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "REJECT" ? { rejectionReason: rejectionReason || null } : {}),
        }),
      });
      if (!res.ok) {
        setMessage({ ok: false, text: t("approvalError") });
        return;
      }
      setRejectVendor(null);
      setMessage({ ok: true, text: action === "APPROVE" ? t("approved") : t("rejected") });
      refresh();
    } catch {
      setMessage({ ok: false, text: t("approvalError") });
    } finally {
      setBusy(false);
    }
  }

  function handleApprove(v: VendorRow) {
    if (!confirm(t("approveConfirm"))) return;
    void handleApproval(v, "APPROVE");
  }

  // 클라 페이지네이션 — 목록 데이터가 바뀌면 1페이지로 (전체 로드 후 메모리 슬라이스)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => setPage(1), [initialVendors]);
  const pagedVendors = useMemo(
    () => initialVendors.slice((page - 1) * pageSize, page * pageSize),
    [initialVendors, page, pageSize]
  );

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        {message && (
          <span
            role="status"
            className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}
          >
            {message.text}
          </span>
        )}
        <span className="flex-1" />
        {canEdit && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 bg-admin-primary hover:bg-blue-600 text-white text-sm font-bold rounded-lg px-4 py-2 whitespace-nowrap transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {t("addButton")}
          </button>
        )}
      </div>

      {initialVendors.length === 0 ? (
        <p className="text-sm text-slate-500 py-12 text-center">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {pagedVendors.map((v) => (
            <div
              key={v.id}
              className={`bg-admin-card rounded-xl border border-slate-800 overflow-hidden ${
                v.active ? "" : "opacity-80"
              }`}
            >
              <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4">
                {/* 아이콘 */}
                <div className="w-12 h-12 shrink-0 rounded-lg bg-slate-800 flex items-center justify-center text-admin-primary">
                  <span className="material-symbols-outlined">storefront</span>
                </div>
                {/* 본문 */}
                <div className="min-w-0 flex-1 flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm sm:text-base font-bold text-white truncate">
                        {v.name}
                        {v.nameKo && (
                          <span className="ml-1.5 text-xs text-slate-500 font-medium">
                            {v.nameKo}
                          </span>
                        )}
                      </h3>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <ApprovalBadge status={v.approvalStatus} t={t} />
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                          v.active ? "bg-emerald-500/90 text-white" : "bg-slate-600/90 text-white"
                        }`}
                      >
                        {v.active ? t("active") : t("inactive")}
                      </span>
                    </div>
                  </div>
                  {/* 연락 행 */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                    {v.phone && (
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px] text-slate-600">call</span>
                        {v.phone}
                      </span>
                    )}
                    {v.zaloUserId ? (
                      <span className="flex items-center gap-1 text-slate-400">
                        <span className="material-symbols-outlined text-[13px] text-slate-600">forum</span>
                        Zalo
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-400">
                        <span className="material-symbols-outlined text-[13px]">warning</span>
                        {t("noZalo")}
                      </span>
                    )}
                  </div>
                  {/* 뱃지 행 */}
                  <div className="flex flex-wrap gap-1.5">
                    {v.catalogCount > 0 && (
                      <span className="bg-slate-700/60 text-slate-300 text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap">
                        {t("catalogBadge", { n: v.catalogCount })}
                      </span>
                    )}
                    {v.hasAccount ? (
                      <span className="flex items-center gap-1.5">
                        <span className="bg-sky-500/15 text-sky-400 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                          {t("accountBadge")}
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => handleUnlinkAccount(v)}
                            disabled={busy}
                            className="text-[10px] font-medium text-slate-500 hover:text-red-400 underline underline-offset-2 disabled:opacity-50 whitespace-nowrap"
                          >
                            {t("accountUnlink")}
                          </button>
                        )}
                      </span>
                    ) : (
                      canEdit && (
                        <button
                          type="button"
                          onClick={() => openAccount(v)}
                          disabled={busy}
                          className="flex items-center gap-1 bg-slate-700/60 hover:bg-slate-600/60 text-slate-200 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap disabled:opacity-50 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[12px]">person_add</span>
                          {t("createAccountButton")}
                        </button>
                      )
                    )}
                    {showBank && v.bankInfo && (v.bankInfo.bank || v.bankInfo.account) && (
                      <span className="bg-emerald-500/15 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">account_balance</span>
                        {t("bankBadge")}
                      </span>
                    )}
                  </div>
                </div>
                {/* 액션 */}
                {canEdit && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(v)}
                      aria-label={t("edit")}
                      disabled={busy}
                      className="text-slate-500 hover:text-admin-primary transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(v)}
                      aria-label={t("delete")}
                      disabled={busy}
                      className="text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-lg">delete</span>
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={v.active}
                      aria-label={t("active")}
                      disabled={busy}
                      onClick={() => handleToggle(v)}
                      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                        v.active ? "bg-admin-primary" : "bg-slate-700"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                          v.active ? "translate-x-4" : ""
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>

              {/* 자가가입 승인 대기 — 승인/거절 액션 바 (canEdit만) */}
              {canEdit && v.approvalStatus === "PENDING_APPROVAL" && (
                <div className="flex items-center gap-2 border-t border-slate-800 bg-amber-500/5 px-3 py-2.5 sm:px-4">
                  <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400">
                    <span className="material-symbols-outlined text-[15px]">hourglass_top</span>
                    {t("statusPending")}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setRejectVendor(v)}
                    disabled={busy}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-red-400 hover:text-red-400 disabled:opacity-50 transition-colors"
                  >
                    {t("reject")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApprove(v)}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[15px]">check</span>
                    {t("approve")}
                  </button>
                </div>
              )}

              {/* 거절됨 — 사유 표시 (있을 때) */}
              {v.approvalStatus === "REJECTED" && v.rejectionReason && (
                <div className="border-t border-slate-800 bg-red-500/5 px-3 py-2 sm:px-4">
                  <p className="text-[11px] text-red-300">
                    <span className="font-bold">{t("rejectReasonLabel")}:</span>{" "}
                    {v.rejectionReason}
                  </p>
                </div>
              )}
            </div>
          ))}
          {/* 페이지네이션 — total===0이면 PaginationBar가 자체적으로 null 반환 */}
          <PaginationBar
            total={initialVendors.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        </div>
      )}

      {rejectVendor && canEdit && (
        <RejectModal
          vendorName={rejectVendor.name}
          busy={busy}
          onReject={(reason) => handleApproval(rejectVendor, "REJECT", reason)}
          onClose={() => setRejectVendor(null)}
          t={t}
        />
      )}

      {modalOpen && canEdit && (
        <VendorModal
          draft={draft}
          setDraft={setDraft}
          showBank={showBank}
          editing={editingId != null}
          busy={busy}
          error={formError}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
          t={t}
        />
      )}

      {accountVendor && canEdit && (
        <AccountModal
          vendorName={accountVendor.name}
          phone={accountPhone}
          setPhone={setAccountPhone}
          password={accountPassword}
          setPassword={setAccountPassword}
          busy={busy}
          error={accountError}
          onCreate={handleCreateAccount}
          onClose={() => setAccountVendor(null)}
          t={t}
        />
      )}
    </section>
  );
}

// ── 승인 상태 배지 (ADR-0023 S5) ───────────────────────────────────────────────
function ApprovalBadge({
  status,
  t,
}: {
  status: ApprovalStatus;
  t: ReturnType<typeof useTranslations>;
}) {
  const map: Record<ApprovalStatus, { cls: string; key: string; icon: string }> = {
    PENDING_APPROVAL: {
      cls: "bg-amber-500/90 text-white",
      key: "statusPending",
      icon: "hourglass_top",
    },
    APPROVED: { cls: "bg-sky-500/90 text-white", key: "statusApproved", icon: "verified" },
    REJECTED: { cls: "bg-red-500/90 text-white", key: "statusRejected", icon: "block" },
  };
  const m = map[status];
  return (
    <span
      className={`flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${m.cls}`}
    >
      <span className="material-symbols-outlined text-[12px]">{m.icon}</span>
      {t(m.key)}
    </span>
  );
}

// ── 자가가입 거절 사유 입력 모달 (ADR-0023 S5) ─────────────────────────────────
function RejectModal({
  vendorName,
  busy,
  onReject,
  onClose,
  t,
}: {
  vendorName: string;
  busy: boolean;
  onReject: (reason: string) => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [reason, setReason] = useState("");
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-admin-card border-2 border-red-500/30 rounded-xl w-full max-w-md my-8 p-5 space-y-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
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
          <span className="font-bold text-slate-300">{vendorName}</span>
        </p>

        <div>
          <label className="text-xs text-slate-500">{t("rejectReasonLabel")}</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("rejectReasonPlaceholder")}
            maxLength={500}
            rows={3}
            className="mt-1 w-full bg-admin-bg border border-slate-700 rounded px-2.5 py-2 text-sm text-white focus:border-red-400 focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white disabled:opacity-50"
          >
            {t("rejectCancel")}
          </button>
          <button
            type="button"
            onClick={() => onReject(reason.trim())}
            disabled={busy}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-1.5 transition-all"
          >
            <span className="material-symbols-outlined text-base">block</span>
            {t("rejectConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 로그인 계정 생성 모달 (ADR-0023 §6) ────────────────────────────────────────
// 전화·임시비번 입력 → POST /api/vendors/[id]/account. 생성 후 공급자에게 전달 안내.
function AccountModal({
  vendorName,
  phone,
  setPhone,
  password,
  setPassword,
  busy,
  error,
  onCreate,
  onClose,
  t,
}: {
  vendorName: string;
  phone: string;
  setPhone: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const inputCls =
    "mt-1 w-full bg-admin-bg border border-slate-700 rounded px-2.5 py-1.5 text-sm text-white focus:border-admin-primary focus:outline-none";
  const labelCls = "text-xs text-slate-500";

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-admin-card border-2 border-admin-primary/40 rounded-xl w-full max-w-md my-8 p-5 space-y-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-admin-primary">person_add</span>
            {t("accountModalTitle")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("accountCancel")}
            className="text-slate-500 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="font-bold text-slate-300">{vendorName}</span>
          {" — "}
          {t("accountModalDesc")}
        </p>

        <div>
          <label className={labelCls}>{t("accountPhone")}</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("accountPhonePlaceholder")}
            maxLength={40}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>{t("accountPassword")}</label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("accountPasswordPlaceholder")}
            maxLength={100}
            className={inputCls}
          />
        </div>

        {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white disabled:opacity-50 whitespace-nowrap"
          >
            {t("accountCancel")}
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-1.5 whitespace-nowrap transition-all"
          >
            <span className="material-symbols-outlined text-base">person_add</span>
            {busy ? t("accountCreating") : t("accountCreate")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 생성/수정 모달 ─────────────────────────────────────────────────────────────
function VendorModal({
  draft,
  setDraft,
  showBank,
  editing,
  busy,
  error,
  onSave,
  onClose,
  t,
}: {
  draft: FormDraft;
  setDraft: (updater: (d: FormDraft) => FormDraft) => void;
  showBank: boolean;
  editing: boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const inputCls =
    "mt-1 w-full bg-admin-bg border border-slate-700 rounded px-2.5 py-1.5 text-sm text-white focus:border-admin-primary focus:outline-none";
  const labelCls = "text-xs text-slate-500";

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-admin-card border-2 border-admin-primary/40 rounded-xl w-full max-w-lg my-8 p-5 space-y-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-admin-primary">
              {editing ? "edit" : "add"}
            </span>
            {editing ? t("form.editTitle", { name: draft.name }) : t("form.createTitle")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("form.cancel")}
            className="text-slate-500 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* 거래처명(필수) + 한국어명 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>{t("form.name")}</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={t("form.namePlaceholder")}
              maxLength={120}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>{t("form.nameKo")}</label>
            <input
              value={draft.nameKo}
              onChange={(e) => setDraft((d) => ({ ...d, nameKo: e.target.value }))}
              placeholder={t("form.nameKoPlaceholder")}
              maxLength={120}
              className={inputCls}
            />
          </div>
        </div>

        {/* 전화 + Zalo ID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>{t("form.phone")}</label>
            <input
              value={draft.phone}
              onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
              placeholder={t("form.phonePlaceholder")}
              maxLength={40}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>{t("form.zaloUserId")}</label>
            <input
              value={draft.zaloUserId}
              onChange={(e) => setDraft((d) => ({ ...d, zaloUserId: e.target.value }))}
              placeholder={t("form.zaloPlaceholder")}
              maxLength={80}
              className={inputCls}
            />
            <p className="text-[11px] text-slate-500 mt-1">{t("form.zaloHint")}</p>
          </div>
        </div>

        {/* 정산계좌 — showBank(canViewFinance)만 */}
        {showBank && (
          <div className="rounded-lg border border-slate-800 bg-admin-bg/40 p-3 space-y-2">
            <p className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px] text-slate-500">account_balance</span>
              {t("form.bankTitle")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>{t("form.bank")}</label>
                <input
                  value={draft.bank}
                  onChange={(e) => setDraft((d) => ({ ...d, bank: e.target.value }))}
                  placeholder={t("form.bankPlaceholder")}
                  maxLength={80}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>{t("form.account")}</label>
                <input
                  value={draft.account}
                  onChange={(e) => setDraft((d) => ({ ...d, account: e.target.value }))}
                  placeholder={t("form.accountPlaceholder")}
                  maxLength={60}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>{t("form.holder")}</label>
                <input
                  value={draft.holder}
                  onChange={(e) => setDraft((d) => ({ ...d, holder: e.target.value }))}
                  placeholder={t("form.holderPlaceholder")}
                  maxLength={80}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        )}

        {/* 메모 */}
        <div>
          <label className={labelCls}>{t("form.note")}</label>
          <textarea
            value={draft.note}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            placeholder={t("form.notePlaceholder")}
            maxLength={500}
            rows={2}
            className={inputCls}
          />
        </div>

        {/* active */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <span className="text-sm text-slate-400">{t("form.active")}</span>
          <button
            type="button"
            role="switch"
            aria-checked={draft.active}
            aria-label={t("form.active")}
            onClick={() => setDraft((d) => ({ ...d, active: !d.active }))}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              draft.active ? "bg-admin-primary" : "bg-slate-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                draft.active ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>

        {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white disabled:opacity-50 whitespace-nowrap"
          >
            {t("form.cancel")}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-1.5 whitespace-nowrap transition-all"
          >
            <span className="material-symbols-outlined text-base">save</span>
            {busy ? t("form.saving") : t("form.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
