"use client";

// 지역(단지) 마스터 CRUD 매니저 (ADR-0046, T-complex-area-master).
//   목록 카드 + 생성/수정 모달 + active 토글. /api/complex-areas(POST) + /api/complex-areas/[id](PATCH).
//   ★삭제 없음 — active=false 토글로 은퇴(연결 빌라는 유지). 저장 후 router.refresh().
//   ★rename(name 변경) 경고: 이 단지명을 바꾸면 연결 빌라 complex 캐시 + 업체 담당지역 표기가 함께 rewrite된다.
//     서버가 트랜잭션으로 전파하며, 업체 담당지역 unique 충돌 시 400 REGION_RENAME_CONFLICT → 친화 메시지.
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import PaginationBar from "@/components/pagination-bar";
import ListSearch from "@/components/list-search";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

export interface ComplexAreaRow {
  id: string;
  name: string;
  nameKo: string;
  code: string;
  active: boolean;
  sortOrder: number;
  villaCount: number;
}

interface FormDraft {
  name: string;
  nameKo: string;
  sortOrder: string; // 입력은 문자열, 전송 시 정수 파싱
}

const emptyForm = (): FormDraft => ({ name: "", nameKo: "", sortOrder: "0" });

export default function ComplexAreasManager({
  initialAreas,
}: {
  initialAreas: ComplexAreaRow[];
}) {
  const t = useTranslations("adminComplexAreas");
  const router = useRouter();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ComplexAreaRow | null>(null); // null=생성
  const [draft, setDraft] = useState<FormDraft>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => router.refresh();
  const fail = () => setMessage({ ok: false, text: t("error") });

  // 서버 error 코드 → 친화 메시지 매핑
  function errorText(code?: string): string {
    switch (code) {
      case "DUPLICATE_COMPLEX":
        return t("errorDuplicateName");
      case "DUPLICATE_CODE":
        return t("errorDuplicateCode");
      case "REGION_RENAME_CONFLICT":
        return t("errorRenameConflict");
      default:
        return t("errorValidation");
    }
  }

  function openCreate() {
    setEditing(null);
    setDraft(emptyForm());
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(a: ComplexAreaRow) {
    setEditing(a);
    setDraft({ name: a.name, nameKo: a.nameKo, sortOrder: String(a.sortOrder) });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setFormError(null);
    const name = draft.name.trim();
    if (!name) {
      setFormError(t("errorNameRequired"));
      return;
    }
    const sortOrder = Number.parseInt(draft.sortOrder, 10);
    const isRename = editing != null && name !== editing.name;

    // rename = 연결 빌라·업체 담당지역 표기 일괄 변경 — 사전 확인(파괴적이지 않지만 파급이 큼)
    if (isRename && !confirm(t("renameConfirm", { count: editing!.villaCount }))) {
      return;
    }

    const body: Record<string, unknown> = {
      name,
      nameKo: draft.nameKo.trim() || null,
      ...(Number.isInteger(sortOrder) ? { sortOrder } : {}),
    };

    setBusy(true);
    setMessage(null);
    try {
      const url = editing ? `/api/complex-areas/${editing.id}` : "/api/complex-areas";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(errorText(data.error));
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

  // active 토글 — 카드 우측 스위치. 은퇴(false)=신규 선택 불가, 연결 빌라는 유지.
  async function handleToggle(a: ComplexAreaRow) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/complex-areas/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !a.active }),
      });
      if (!res.ok) throw new Error();
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  // 검색 — 정본명·한국어명·코드 부분일치(대소문자 무시)
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return initialAreas;
    return initialAreas.filter((a) =>
      [a.name, a.nameKo, a.code].some((f) => (f ?? "").toLowerCase().includes(q))
    );
  }, [initialAreas, search]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => setPage(1), [initialAreas, search]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  return (
    <section className="space-y-5">
      {/* 안내 — 마스터 단일 원천 설명 */}
      <p className="text-xs text-slate-400 leading-relaxed bg-admin-card border border-slate-800 rounded-lg p-3">
        {t("intro")}
      </p>

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
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 bg-admin-primary hover:bg-blue-600 text-white text-sm font-bold rounded-lg px-4 py-2 whitespace-nowrap transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          {t("addButton")}
        </button>
      </div>

      <ListSearch
        placeholder={t("searchPlaceholder")}
        value={search}
        onChange={setSearch}
        className="max-w-xs"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500 py-12 text-center">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {paged.map((a) => (
            <div
              key={a.id}
              className={`bg-admin-card rounded-xl border border-slate-800 ${
                a.active ? "" : "opacity-80"
              }`}
            >
              <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4">
                <div className="w-12 h-12 shrink-0 rounded-lg bg-slate-800 flex items-center justify-center text-admin-primary">
                  <span className="material-symbols-outlined">apartment</span>
                </div>
                <div className="min-w-0 flex-1 flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm sm:text-base font-bold text-white truncate">
                        {a.name}
                        {a.nameKo && (
                          <span className="ml-1.5 text-xs text-slate-500 font-medium">
                            {a.nameKo}
                          </span>
                        )}
                      </h3>
                    </div>
                    {!a.active && (
                      <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-slate-600/90 text-white">
                        {t("inactive")}
                      </span>
                    )}
                  </div>
                  {/* 메타 행 — code·정렬·연결 빌라 수 */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span className="flex items-center gap-1 font-mono text-slate-500">
                      <span className="material-symbols-outlined text-[13px]">tag</span>
                      {a.code}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px] text-slate-600">sort</span>
                      {t("sortOrderShort", { n: a.sortOrder })}
                    </span>
                    {a.villaCount > 0 && (
                      <span className="bg-slate-700/60 text-slate-300 text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap">
                        {t("villaBadge", { n: a.villaCount })}
                      </span>
                    )}
                  </div>
                </div>
                {/* 액션 — 수정 + active 토글(삭제 없음) */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(a)}
                    aria-label={t("edit")}
                    disabled={busy}
                    className="text-slate-500 hover:text-admin-primary transition-colors disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-lg">edit</span>
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={a.active}
                    aria-label={t("active")}
                    disabled={busy}
                    onClick={() => handleToggle(a)}
                    className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                      a.active ? "bg-admin-primary" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                        a.active ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          ))}
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
        </div>
      )}

      {modalOpen && (
        <AreaModal
          draft={draft}
          setDraft={setDraft}
          editing={editing}
          busy={busy}
          error={formError}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
          t={t}
        />
      )}
    </section>
  );
}

// ── 생성/수정 모달 ─────────────────────────────────────────────────────────────
function AreaModal({
  draft,
  setDraft,
  editing,
  busy,
  error,
  onSave,
  onClose,
  t,
}: {
  draft: FormDraft;
  setDraft: (updater: (d: FormDraft) => FormDraft) => void;
  editing: ComplexAreaRow | null;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const inputCls =
    "mt-1 w-full bg-admin-bg border border-slate-700 rounded px-2.5 py-1.5 text-sm text-white focus:border-admin-primary focus:outline-none";
  const labelCls = "text-xs text-slate-500";

  // rename 경고 — 편집 중 name이 원본과 다를 때만 노출
  const isRename = editing != null && draft.name.trim() !== "" && draft.name.trim() !== editing.name;

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
            {editing ? t("form.editTitle", { name: editing.name }) : t("form.createTitle")}
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

        {/* 정본명(필수, 라틴) + 한국어 병기 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>{t("form.name")}</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={t("form.namePlaceholder")}
              maxLength={100}
              className={inputCls}
            />
            <p className="text-[11px] text-slate-500 mt-1">{t("form.nameHint")}</p>
          </div>
          <div>
            <label className={labelCls}>{t("form.nameKo")}</label>
            <input
              value={draft.nameKo}
              onChange={(e) => setDraft((d) => ({ ...d, nameKo: e.target.value }))}
              placeholder={t("form.nameKoPlaceholder")}
              maxLength={100}
              className={inputCls}
            />
            <p className="text-[11px] text-slate-500 mt-1">{t("form.nameKoHint")}</p>
          </div>
        </div>

        {/* 정렬순서 */}
        <div className="max-w-[8rem]">
          <label className={labelCls}>{t("form.sortOrder")}</label>
          <input
            type="number"
            min={0}
            max={9999}
            value={draft.sortOrder}
            onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
            className={inputCls}
          />
        </div>

        {/* rename 경고 — 연결 빌라 + 업체 담당지역 표기 일괄 변경 고지 */}
        {isRename && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2">
            <span className="material-symbols-outlined text-amber-400 text-[18px] shrink-0">warning</span>
            <p className="text-xs text-amber-200 leading-relaxed">
              {t("form.renameWarning", { count: editing!.villaCount })}
            </p>
          </div>
        )}

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
