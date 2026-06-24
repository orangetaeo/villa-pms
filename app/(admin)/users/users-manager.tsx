"use client";

// 사용자 관리 (T1.8 — Stitch b13-users 변환)
// 목록은 RSC props, 활성 토글·Zalo 수동 매칭은 PATCH /api/users/[id] → router.refresh()
// <768px는 ResponsiveTable 카드 전환 (T6.7 패턴)
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Role } from "@/lib/permissions";
import ResponsiveTable, { type ResponsiveColumn } from "@/components/admin/responsive-table";
import PaginationBar from "@/components/pagination-bar";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

// 부여 가능 역할 — OWNER·ADMIN 제외(권한상승 표면 차단, 계약 A1/A2)
const ASSIGNABLE_ROLES = ["MANAGER", "STAFF", "SUPPLIER", "CLEANER"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export interface UserRow {
  id: string;
  role: Role;
  name: string;
  phone: string | null;
  zaloUserId: string | null;
  isActive: boolean;
  /** "YYYY.MM.DD" (RSC에서 직렬화) */
  joinedAt: string;
  villaCount: number;
}

export interface UnlinkedZaloRow {
  id: string;
  zaloUserId: string;
  displayName: string | null;
}

// 역할 뱃지 (DESIGN.md 역할 시맨틱: OWNER=amber, MANAGER=indigo, STAFF=slate,
// SUPPLIER=teal, CLEANER=purple, ADMIN=blue(legacy transition))
const ROLE_BADGE_CLASS: Record<Role, string> = {
  OWNER: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  MANAGER: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
  STAFF: "bg-slate-500/10 text-slate-300 border border-slate-500/20",
  ADMIN: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  SUPPLIER: "bg-teal-500/10 text-teal-400 border border-teal-500/20",
  CLEANER: "bg-purple-500/10 text-purple-400 border border-purple-500/20",
};

// 아바타 색 (역할 시맨틱 컬러와 동일 계열)
const AVATAR_CLASS: Record<Role, string> = {
  OWNER: "bg-amber-500/10 text-amber-500",
  MANAGER: "bg-indigo-500/10 text-indigo-500",
  STAFF: "bg-slate-500/10 text-slate-400",
  ADMIN: "bg-blue-500/10 text-blue-500",
  SUPPLIER: "bg-blue-500/10 text-blue-500",
  CLEANER: "bg-purple-500/10 text-purple-500",
};

/** 이름 → 2글자 이니셜 (b13: "Nguyễn Văn An" → "NA") */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : (words[0][1] ?? "");
  return `${first}${last}`.toUpperCase();
}

type TabKey = "all" | "SUPPLIER" | "CLEANER";
const TABS: { key: TabKey; labelKey: string }[] = [
  { key: "all", labelKey: "tabs.all" },
  { key: "SUPPLIER", labelKey: "tabs.supplier" },
  { key: "CLEANER", labelKey: "tabs.cleaner" },
];

export default function UsersManager({
  users,
  unlinkedZalo,
  selfId,
}: {
  users: UserRow[];
  unlinkedZalo: UnlinkedZaloRow[];
  selfId: string;
}) {
  const t = useTranslations("adminUsers");
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Zalo 매칭 패널이 열린 사용자 id + 선택한 zaloUserId
  const [pickerId, setPickerId] = useState<string | null>(null);
  const [pickerValue, setPickerValue] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // 계정 생성 모달 (B2)
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<{
    name: string;
    phone: string;
    password: string;
    role: AssignableRole;
  }>({ name: "", phone: "", password: "", role: "SUPPLIER" });
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // 역할 변경 진입 행 id (B3)
  const [roleEditId, setRoleEditId] = useState<string | null>(null);
  // 비번 초기화 결과 — 임시 비밀번호 1회 표시 모달 (닫으면 다시 못 봄)
  const [resetResult, setResetResult] = useState<{ name: string; password: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (tab !== "all" && u.role !== tab) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || (u.phone ?? "").toLowerCase().includes(q);
    });
  }, [users, tab, query]);

  // 클라 페이지네이션 — 검색/탭 변경 시 1페이지로 (전체 props 로드 후 메모리 슬라이스)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => setPage(1), [tab, query]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  /** PATCH 공통 — 409=Zalo 중복, 400(DEACTIVATE)=본인 비활성화 */
  const patchUser = async (
    id: string,
    body: { action: string; zaloUserId?: string; role?: string },
    okText: string
  ): Promise<boolean> => {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let errKey = "errors.generic";
        if (body.action === "CHANGE_ROLE") {
          errKey =
            res.status === 409
              ? "errors.hasVillas"
              : res.status === 400
                ? "errors.cannotChangeOwnRole"
                : "errors.generic";
        } else if (res.status === 409) {
          errKey = "errors.zaloConflict";
        } else if (res.status === 400 && body.action === "DEACTIVATE") {
          errKey = "errors.selfDeactivate";
        }
        setMessage({ tone: "error", text: t(errKey) });
        return false;
      }
      setMessage({ tone: "ok", text: okText });
      router.refresh();
      return true;
    } catch {
      setMessage({ tone: "error", text: t("errors.generic") });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const onToggle = (user: UserRow) => {
    void patchUser(
      user.id,
      { action: user.isActive ? "DEACTIVATE" : "ACTIVATE" },
      t("toggle.updated")
    );
  };

  const onLink = async (user: UserRow) => {
    if (!pickerValue) return;
    const ok = await patchUser(
      user.id,
      { action: "LINK_ZALO", zaloUserId: pickerValue },
      t("zalo.linked")
    );
    if (ok) {
      setPickerId(null);
      setPickerValue("");
    }
  };

  const onUnlink = (user: UserRow) => {
    if (!window.confirm(t("zalo.unlinkConfirm"))) return;
    void patchUser(user.id, { action: "UNLINK_ZALO" }, t("zalo.unlinked"));
  };

  const openPicker = (userId: string) => {
    setPickerId(userId);
    setPickerValue(unlinkedZalo[0]?.zaloUserId ?? "");
  };

  // 계정 생성 (B2) — POST /api/users → refresh
  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const errKey =
          res.status === 409
            ? "errors.phoneTaken"
            : res.status === 400
              ? "errors.passwordTooShort"
              : "errors.generic";
        setAddError(t(errKey));
        return;
      }
      setAddOpen(false);
      setAddForm({ name: "", phone: "", password: "", role: "SUPPLIER" });
      setMessage({ tone: "ok", text: t("addUser.success") });
      router.refresh();
    } catch {
      setAddError(t("errors.generic"));
    } finally {
      setAddBusy(false);
    }
  };

  // 역할 변경 (B3) — PATCH CHANGE_ROLE → refresh
  const onChangeRole = async (user: UserRow, role: AssignableRole) => {
    if (role === user.role) {
      setRoleEditId(null);
      return;
    }
    const ok = await patchUser(
      user.id,
      { action: "CHANGE_ROLE", role },
      t("roleChange.success")
    );
    if (ok) setRoleEditId(null);
  };

  // 비번 초기화 (RESET_PASSWORD) — 임시 비밀번호를 받아 1회 모달 표시.
  // patchUser는 본문을 반환하지 않으므로(refresh만) 별도 fetch로 tempPassword 수신.
  const onResetPassword = async (user: UserRow) => {
    if (!window.confirm(t("resetPassword.confirm", { name: user.name }))) return;
    setBusyId(user.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESET_PASSWORD" }),
      });
      const data = (await res.json().catch(() => null)) as { tempPassword?: string } | null;
      if (!res.ok || !data?.tempPassword) {
        setMessage({ tone: "error", text: t("errors.generic") });
        return;
      }
      setCopied(false);
      setResetResult({ name: user.name, password: data.tempPassword });
    } catch {
      setMessage({ tone: "error", text: t("errors.generic") });
    } finally {
      setBusyId(null);
    }
  };

  const onCopyTempPassword = async () => {
    if (!resetResult) return;
    try {
      await navigator.clipboard.writeText(resetResult.password);
      setCopied(true);
    } catch {
      // 클립보드 차단 환경 — 사용자가 직접 선택해 복사
    }
  };

  // Zalo 연결 셀 (b13: 점 + 연결됨/미연결 + 수동 연결 링크)
  const zaloCell = (user: UserRow) => {
    if (user.zaloUserId) {
      return (
        <div className="flex flex-col gap-0.5 items-end md:items-start">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${user.isActive ? "bg-green-500" : "bg-green-500/50"}`}
            />
            <span
              className={`text-xs font-medium ${user.isActive ? "text-green-500" : "text-green-500/70"}`}
            >
              {t("zalo.connected")}
            </span>
          </div>
          <button
            type="button"
            disabled={busyId === user.id}
            onClick={() => onUnlink(user)}
            className="text-[10px] text-slate-500 hover:text-red-400 hover:underline disabled:opacity-50 whitespace-nowrap"
          >
            {t("zalo.unlink")}
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-0.5 items-end md:items-start">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
          <span className="text-xs font-medium text-slate-500">{t("zalo.notConnected")}</span>
        </div>
        {pickerId === user.id ? (
          <div className="mt-1 w-56 bg-slate-900 border border-slate-700 rounded-lg p-3 flex flex-col gap-2 text-left">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
              {t("zalo.pickerTitle")}
            </span>
            {unlinkedZalo.length === 0 ? (
              // 미가입 팔로워 없음 — 웹훅(T3.7) 연동 전 빈 상태
              <p className="text-[11px] text-slate-400 leading-relaxed">{t("zalo.pickerEmpty")}</p>
            ) : (
              <select
                value={pickerValue}
                onChange={(e) => setPickerValue(e.target.value)}
                className="h-9 w-full bg-slate-800 border border-slate-700 rounded-lg px-2 text-xs text-slate-100"
              >
                {unlinkedZalo.map((c) => (
                  <option key={c.id} value={c.zaloUserId}>
                    {c.displayName ?? t("zalo.noName")}
                  </option>
                ))}
              </select>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPickerId(null);
                  setPickerValue("");
                }}
                className="px-2.5 py-1.5 rounded text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                {t("zalo.cancel")}
              </button>
              {unlinkedZalo.length > 0 && (
                <button
                  type="button"
                  disabled={busyId === user.id || !pickerValue}
                  onClick={() => void onLink(user)}
                  className="px-2.5 py-1.5 rounded text-[11px] font-bold bg-admin-primary hover:bg-admin-primary-dark text-white disabled:opacity-50 transition-colors"
                >
                  {t("zalo.connect")}
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openPicker(user.id)}
            className="text-[10px] text-admin-primary hover:underline whitespace-nowrap"
          >
            {t("zalo.link")}
          </button>
        )}
      </div>
    );
  };

  // 활성 토글 셀 (b13 스위치 — 본인 행은 비활성화 금지로 disabled, API도 400 방어)
  const statusCell = (user: UserRow) => {
    const isSelf = user.id === selfId;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={user.isActive}
        aria-label={user.isActive ? t("toggle.deactivate") : t("toggle.activate")}
        title={isSelf ? t("toggle.selfHint") : undefined}
        disabled={isSelf || busyId === user.id}
        onClick={() => onToggle(user)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed ${
          user.isActive ? "bg-blue-600" : "bg-slate-700"
        } ${isSelf ? "opacity-40" : ""}`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            user.isActive ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
    );
  };

  const nameBlock = (user: UserRow) => (
    <div className="flex items-center gap-3">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${AVATAR_CLASS[user.role]} ${user.isActive ? "" : "opacity-70"}`}
      >
        {initials(user.name)}
      </div>
      <span
        className={`text-sm font-semibold ${user.isActive ? "text-white" : "text-[#9CA3AF]"}`}
      >
        {user.name}
      </span>
    </div>
  );

  const columns: ResponsiveColumn<UserRow>[] = [
    {
      key: "name",
      header: t("columns.name"),
      cell: nameBlock,
      hideOnCard: true, // 모바일 카드는 cardHeader로 표시
    },
    {
      key: "phone",
      header: t("columns.phone"),
      cell: (u) => (
        <span
          className={`text-sm font-mono whitespace-nowrap ${u.isActive ? "text-slate-300" : "text-[#9CA3AF]"}`}
        >
          {u.phone ?? "-"}
        </span>
      ),
      hideOnCard: true, // 모바일은 cardSummary로 표시
    },
    {
      key: "role",
      header: t("columns.role"),
      cell: (u) => {
        const isSelf = u.id === selfId;
        return (
          <div className="flex items-center gap-2 justify-end md:justify-start">
            {roleEditId === u.id ? (
              // 역할 변경 select (B3) — 부여 가능 역할만
              <select
                autoFocus
                aria-label={t("roleChange.label")}
                disabled={busyId === u.id}
                defaultValue={ASSIGNABLE_ROLES.includes(u.role as AssignableRole) ? u.role : ""}
                onChange={(e) => {
                  const v = e.target.value as AssignableRole;
                  if (v) void onChangeRole(u, v);
                }}
                onBlur={() => setRoleEditId(null)}
                className="h-8 bg-slate-800 border border-slate-700 rounded-lg px-2 text-xs text-slate-100"
              >
                <option value="" disabled>
                  {t("roleChange.placeholder")}
                </option>
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                disabled={isSelf}
                title={isSelf ? t("roleChange.selfHint") : t("roleChange.edit")}
                onClick={() => !isSelf && setRoleEditId(u.id)}
                className={`px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap ${ROLE_BADGE_CLASS[u.role]} ${u.isActive ? "" : "opacity-70"} ${isSelf ? "cursor-default" : "hover:ring-1 hover:ring-admin-primary/50 cursor-pointer"}`}
              >
                {t(`roles.${u.role}`)}
              </button>
            )}
            {!u.isActive && (
              <span className="px-1.5 py-0.5 rounded bg-slate-700 text-[#9CA3AF] text-[9px] font-bold whitespace-nowrap">
                {t("inactiveBadge")}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "zalo",
      header: t("columns.zalo"),
      cell: zaloCell,
    },
    {
      key: "villas",
      header: t("columns.villas"),
      cell: (u) =>
        u.role === "SUPPLIER" ? (
          <span
            className={`text-sm font-bold tabular-nums ${u.isActive ? "text-slate-300" : "text-[#9CA3AF]"}`}
          >
            {u.villaCount}
          </span>
        ) : (
          <span className="text-sm text-slate-500">-</span>
        ),
    },
    {
      key: "joined",
      header: t("columns.joined"),
      cell: (u) => (
        <span
          className={`text-xs tabular-nums whitespace-nowrap ${u.isActive ? "text-slate-400" : "text-[#9CA3AF]/80"}`}
        >
          {u.joinedAt}
        </span>
      ),
    },
    {
      key: "status",
      header: t("columns.status"),
      cell: statusCell,
      className: "text-center",
      headerClassName: "text-center",
    },
    {
      key: "actions",
      header: t("columns.actions"),
      cell: (u) => (
        <button
          type="button"
          disabled={busyId === u.id}
          onClick={() => void onResetPassword(u)}
          title={t("resetPassword.action")}
          className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-admin-primary disabled:opacity-50 whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-sm">lock_reset</span>
          {t("resetPassword.action")}
        </button>
      ),
      className: "text-center",
      headerClassName: "text-center",
    },
  ];

  return (
    <div>
      {/* 페이지 헤더 (b13) — 사용자 추가 (S-RBAC-4 B2) */}
      <section className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight mb-1">{t("title")}</h1>
          <p className="text-admin-muted text-sm">
            {t("subtitle")}{" "}
            <span className="text-admin-primary font-semibold ml-2 whitespace-nowrap">
              {t("totalCount", { count: users.length })}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAddError(null);
            setAddOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-admin-primary hover:bg-admin-primary-dark text-white text-sm font-bold transition-colors whitespace-nowrap self-start md:self-auto"
        >
          <span className="material-symbols-outlined text-base">person_add</span>
          {t("addUser.button")}
        </button>
      </section>

      {/* 필터 바 (b13 — 검색 + 역할 탭) */}
      <section className="bg-slate-800/50 border border-slate-800 p-4 rounded-xl mb-6 flex flex-wrap items-center gap-4">
        <div className="relative w-full sm:w-64">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-slate-500 text-sm">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full bg-slate-900/50 border border-slate-700 text-sm rounded-lg pl-9 pr-3 py-2 focus:border-admin-primary focus:ring-1 focus:ring-admin-primary outline-none text-slate-200 placeholder:text-slate-500"
          />
        </div>
        <div className="flex gap-2 p-1 bg-slate-900/50 rounded-lg border border-slate-800">
          {TABS.map(({ key, labelKey }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap ${
                tab === key
                  ? "bg-slate-700 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </section>

      {/* 결과 메시지 (토글·매칭 성공/409·400 에러) */}
      {message && (
        <p
          role="status"
          className={`mb-4 text-xs font-medium ${
            message.tone === "ok" ? "text-emerald-500" : "text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* 사용자 테이블 (b13) — <768px 카드 전환 (T6.7) */}
      <ResponsiveTable
        columns={columns}
        rows={paged}
        rowKey={(u) => u.id}
        emptyMessage={t("empty")}
        rowClassName={(u) => (u.isActive ? undefined : "bg-slate-900/40")}
        cardSummary={(u) => (
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
              {nameBlock(u)}
              <span
                className={`px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap shrink-0 ${ROLE_BADGE_CLASS[u.role]} ${u.isActive ? "" : "opacity-70"}`}
              >
                {t(`roles.${u.role}`)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 pl-11">
              <span className="font-mono">{u.phone ?? "-"}</span>
              {!u.isActive && (
                <span className="px-1.5 py-0.5 rounded bg-slate-700 text-[#9CA3AF] text-[9px] font-bold">
                  {t("inactiveBadge")}
                </span>
              )}
            </div>
          </div>
        )}
      />

      {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(10/20/30/50/100) */}
      <PaginationBar
        total={filtered.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />

      {/* 계정 생성 모달 (B2) */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-1">{t("addUser.title")}</h2>
            <p className="text-xs text-slate-400 mb-5">{t("addUser.subtitle")}</p>
            <form onSubmit={onCreate} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-400">{t("addUser.name")}</span>
                <input
                  type="text"
                  required
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-10 bg-slate-800 border border-slate-700 rounded-lg px-3 text-sm text-slate-100 focus:border-admin-primary focus:ring-1 focus:ring-admin-primary outline-none"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-400">{t("addUser.phone")}</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                  className="h-10 bg-slate-800 border border-slate-700 rounded-lg px-3 text-sm text-slate-100 font-mono focus:border-admin-primary focus:ring-1 focus:ring-admin-primary outline-none"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-400">{t("addUser.password")}</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={addForm.password}
                  onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                  className="h-10 bg-slate-800 border border-slate-700 rounded-lg px-3 text-sm text-slate-100 focus:border-admin-primary focus:ring-1 focus:ring-admin-primary outline-none"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-400">{t("addUser.role")}</span>
                <select
                  value={addForm.role}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, role: e.target.value as AssignableRole }))
                  }
                  className="h-10 bg-slate-800 border border-slate-700 rounded-lg px-3 text-sm text-slate-100 focus:border-admin-primary focus:ring-1 focus:ring-admin-primary outline-none"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </select>
              </label>

              {addError && (
                <p role="alert" className="text-xs font-medium text-red-400">
                  {addError}
                </p>
              )}

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  {t("addUser.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={addBusy}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-admin-primary hover:bg-admin-primary-dark text-white disabled:opacity-50 transition-colors"
                >
                  {t("addUser.submit")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 비번 초기화 결과 — 임시 비밀번호 1회 표시 (닫으면 다시 못 봄) */}
      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-emerald-400">lock_reset</span>
              <h2 className="text-lg font-bold text-white">{t("resetPassword.title")}</h2>
            </div>
            <p className="text-xs text-slate-400 mb-5">
              {t("resetPassword.subtitle", { name: resetResult.name })}
            </p>

            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-base font-mono font-bold text-emerald-300 tracking-wider text-center select-all">
                {resetResult.password}
              </code>
              <button
                type="button"
                onClick={() => void onCopyTempPassword()}
                className="inline-flex items-center gap-1 px-3 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition-colors whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-sm">
                  {copied ? "check" : "content_copy"}
                </span>
                {copied ? t("resetPassword.copied") : t("resetPassword.copy")}
              </button>
            </div>

            <p className="text-[11px] text-amber-400/90 leading-relaxed mb-5">
              {t("resetPassword.warning")}
            </p>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setResetResult(null)}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-admin-primary hover:bg-admin-primary-dark text-white transition-colors"
              >
                {t("resetPassword.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
