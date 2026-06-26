"use client";

// 서비스 카탈로그 CRUD 매니저 (ADR-0019 v2, Stitch b19) — 카드 그리드 + 생성/수정 모달.
//   /api/services/catalog (GET/POST) + /api/services/catalog/[id] (PATCH·DELETE). 저장 후 router.refresh().
//   ★ 매입원가(costVnd)·마진: showCost(canViewFinance)일 때만 카드·입력칸 렌더. 서버 페이로드에서도 이미 제외됨.
//   ★ 가격은 VND 단일통화(priceVnd 필수). 게스트 KRW는 표시 시점 환율로 파생 — 저장 안 함.
//   ★ 관리자 입력은 한국어만(nameKo/descKo/옵션 labelKo). nameVi/nameEn/descVi·옵션 labelVi는 서버가 Gemini로 자동번역.
//   옵션 빌더: variants(1택·가격대체)/addons(다중·가산)/modifiers(토글·가산).
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatThousands } from "@/lib/format";
import { priceKrwCeil } from "@/lib/service-display";
import { parseCatalogOptions, SERVICE_TYPE_VALUES } from "@/lib/service-catalog";
import { catalogImage } from "@/lib/service-image";

// ADR-0023 — 요청 가능 채널. ADMIN은 항상 포함(운영자 늘 요청 가능 — 잠금).
export type Audience = "ADMIN" | "PARTNER" | "GUEST";
const SELECTABLE_AUDIENCES: Audience[] = ["PARTNER", "GUEST"]; // ADMIN은 잠금(항상 체크)

export interface VendorOption {
  id: string;
  name: string;
}

export interface CatalogRow {
  id: string;
  type: string;
  nameKo: string;
  nameI18n: unknown; // {en,vi,zh,ru} 또는 null — 카드 표시엔 미사용(서버 자동번역 결과)
  descKo: string;
  descI18n: unknown;
  unitLabelKo: string;
  priceVnd: string | null; // VND 동 단위 문자열(필수)
  costVnd?: string | null; // showCost(canViewFinance)일 때만 존재
  photoUrl: string;
  options: unknown; // {variants,addons,modifiers}
  active: boolean;
  sortOrder: number;
  vendorId: string | null; // ADR-0023 원천 공급자(없으면 직접 제공)
  audiences: Audience[]; // ADR-0023 요청 가능 채널(ADMIN 항상 포함)
}

// 타입별 배지 색 (b19) — 디자인 색상 그대로
const TYPE_BADGE: Record<string, string> = {
  BBQ: "bg-orange-500/90",
  TICKET: "bg-sky-500/90",
  GUIDE: "bg-violet-500/90",
  CAR_RENTAL: "bg-emerald-600/90",
  BREAKFAST: "bg-amber-600/90",
  MOTORBIKE_RENTAL: "bg-rose-500/90",
  MASSAGE: "bg-pink-500/90",
  BARBER: "bg-cyan-600/90",
  FRUIT: "bg-lime-600/90",
};

interface OptionDraft {
  key: string;
  labelKo: string; // 한국어 라벨만 입력 — 서버가 자동번역
  priceVnd: string; // 숫자 문자열(VND)
}

interface FormDraft {
  type: string;
  nameKo: string;
  descKo: string;
  unitLabelKo: string;
  priceVnd: string; // 숫자 문자열(VND, 필수)
  costVnd: string;
  photoUrl: string;
  sortOrder: string;
  active: boolean;
  variants: OptionDraft[];
  addons: OptionDraft[];
  modifiers: OptionDraft[];
  vendorId: string; // "" = 없음(직접 제공)
  partner: boolean; // audiences ∋ PARTNER
  guest: boolean; // audiences ∋ GUEST (ADMIN은 항상 포함 — 잠금)
}

const EMPTY_OPTION: OptionDraft = { key: "", labelKo: "", priceVnd: "" };

const emptyForm = (sortOrder: number): FormDraft => ({
  type: "BBQ",
  nameKo: "",
  descKo: "",
  unitLabelKo: "",
  priceVnd: "",
  costVnd: "",
  photoUrl: "",
  sortOrder: String(sortOrder),
  active: true,
  variants: [],
  addons: [],
  modifiers: [],
  vendorId: "",
  partner: false,
  guest: false,
});

const digits = (v: string) => v.replace(/\D/g, "");

/** 체크된 채널 → audiences 배열. ADMIN은 항상 포함(운영자 늘 요청 가능 — ADR-0023). */
function buildAudiences(partner: boolean, guest: boolean): Audience[] {
  const out: Audience[] = ["ADMIN"];
  if (partner) out.push("PARTNER");
  if (guest) out.push("GUEST");
  return out;
}

/** 마진% = (판매VND − 원가VND) / 판매VND × 100 — 둘 다 있을 때만. 정수 반올림. */
function marginPct(priceVnd: string | null, costVnd: string | null | undefined): number | null {
  if (!priceVnd || !costVnd) return null;
  let p: bigint, c: bigint;
  try {
    p = BigInt(priceVnd);
    c = BigInt(costVnd);
  } catch {
    return null;
  }
  if (p <= 0n) return null;
  return Math.round(Number(((p - c) * 100n) / p));
}

export default function ServiceCatalogManager({
  initialItems,
  vendors,
  showCost,
  canEdit,
  fx,
}: {
  initialItems: CatalogRow[];
  vendors: VendorOption[]; // ADR-0023 활성 원천 공급자 목록(셀렉트용)
  showCost: boolean;
  canEdit: boolean;
  fx: string | null; // 1 KRW당 VND. null이면 KRW 미리보기 생략.
}) {
  const t = useTranslations("adminServices");
  const router = useRouter();

  const [typeFilter, setTypeFilter] = useState<string>("ALL"); // 타입 카테고리 탭
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormDraft>(emptyForm(0));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => router.refresh();
  const fail = () => setMessage({ ok: false, text: t("error") });

  function openCreate() {
    setEditingId(null);
    setDraft(emptyForm(initialItems.length));
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(item: CatalogRow) {
    const opts = parseCatalogOptions(item.options);
    // 옵션은 labelKo/priceVnd만 드래프트로 — labelI18n은 무시(저장 시 서버가 재번역)
    const toDraft = (
      g: ReturnType<typeof parseCatalogOptions>["variants"]
    ): OptionDraft[] =>
      (g ?? []).map((o) => ({
        key: o.key,
        labelKo: o.labelKo,
        priceVnd: o.priceVnd ?? "",
      }));
    setEditingId(item.id);
    setDraft({
      type: item.type,
      nameKo: item.nameKo,
      descKo: item.descKo,
      unitLabelKo: item.unitLabelKo,
      priceVnd: item.priceVnd ?? "",
      costVnd: item.costVnd ?? "",
      photoUrl: item.photoUrl,
      sortOrder: String(item.sortOrder),
      active: item.active,
      variants: toDraft(opts.variants),
      addons: toDraft(opts.addons),
      modifiers: toDraft(opts.modifiers),
      vendorId: item.vendorId ?? "",
      partner: item.audiences.includes("PARTNER"),
      guest: item.audiences.includes("GUEST"),
    });
    setFormError(null);
    setModalOpen(true);
  }

  /** 옵션 드래프트 → API 옵션 그룹(빈 행 제외). labelKo + priceVnd만(서버가 자동번역). */
  function buildOptionGroup(rows: OptionDraft[]) {
    return rows
      .filter((r) => r.key.trim() && r.labelKo.trim())
      .map((r) => ({
        key: r.key.trim(),
        labelKo: r.labelKo.trim(),
        priceVnd: r.priceVnd || null,
      }));
  }

  async function handleSave() {
    setFormError(null);
    const hasVnd = draft.priceVnd.trim() !== "";
    // 판매가는 VND 필수(게스트 KRW는 환율 파생). 이름·VND 누락 시 검증 에러.
    if (!draft.nameKo.trim() || !hasVnd) {
      setFormError(t("form.priceRequired"));
      return;
    }
    const variants = buildOptionGroup(draft.variants);
    const addons = buildOptionGroup(draft.addons);
    const modifiers = buildOptionGroup(draft.modifiers);
    const options =
      variants.length || addons.length || modifiers.length
        ? { variants, addons, modifiers }
        : undefined;

    // ★ 한국어만 전송 — nameVi/nameEn/descVi·priceKrw·옵션 labelVi/priceKrw는 보내지 않음(서버 자동번역·VND 단일통화)
    const body: Record<string, unknown> = {
      type: draft.type,
      nameKo: draft.nameKo.trim(),
      descKo: draft.descKo.trim() || null,
      unitLabelKo: draft.unitLabelKo.trim() || null,
      priceVnd: draft.priceVnd,
      photoUrl: draft.photoUrl.trim() || null,
      options,
      active: draft.active,
      sortOrder: Number.parseInt(draft.sortOrder, 10) || 0,
      // ADR-0023 — 원천 공급자(빈값=직접 제공) + 요청 가능 채널(ADMIN 항상 포함)
      vendorId: draft.vendorId || null,
      audiences: buildAudiences(draft.partner, draft.guest),
    };
    // 원가는 canViewFinance만 전송(STAFF는 입력칸 자체가 없음). 서버도 이중 방어.
    if (showCost) body.costVnd = draft.costVnd ? draft.costVnd : null;

    setBusy(true);
    setMessage(null);
    try {
      const url = editingId ? `/api/services/catalog/${editingId}` : "/api/services/catalog";
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

  async function handleToggle(item: CatalogRow) {
    // PATCH는 전체 객체 검증(type·nameKo 필수) — 토글도 현재 값을 그대로 보내고 active만 반전.
    const opts = parseCatalogOptions(item.options);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/services/catalog/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // ★ 한국어만 전송(서버 자동번역) — nameVi/nameEn/descVi·priceKrw 미전송
          type: item.type,
          nameKo: item.nameKo,
          descKo: item.descKo || null,
          unitLabelKo: item.unitLabelKo || null,
          priceVnd: item.priceVnd,
          photoUrl: item.photoUrl || null,
          // 옵션도 labelKo/priceVnd만(서버가 재번역) — parseCatalogOptions가 labelI18n을 패스스루하나 추가 키는 서버 무시
          options:
            opts.variants?.length || opts.addons?.length || opts.modifiers?.length
              ? {
                  variants: (opts.variants ?? []).map((o) => ({ key: o.key, labelKo: o.labelKo, priceVnd: o.priceVnd ?? null })),
                  addons: (opts.addons ?? []).map((o) => ({ key: o.key, labelKo: o.labelKo, priceVnd: o.priceVnd ?? null })),
                  modifiers: (opts.modifiers ?? []).map((o) => ({ key: o.key, labelKo: o.labelKo, priceVnd: o.priceVnd ?? null })),
                }
              : undefined,
          active: !item.active,
          sortOrder: item.sortOrder,
          // ADR-0023 — 공급자·채널 기존값 보존(토글은 active만 변경)
          vendorId: item.vendorId,
          audiences: item.audiences,
          // costVnd는 보내지 않음 — canViewFinance 미권한자는 기존값 보존(서버 정책)
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

  async function handleDelete(id: string) {
    if (!confirm(t("deleteConfirm"))) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/services/catalog/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setMessage({ ok: true, text: t("deleted") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  // 타입 카테고리 탭 — 등장하는 타입만 노출(+ 전체). 빌라관리 상태 탭 패턴.
  const typeTabs = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of initialItems) counts[it.type] = (counts[it.type] ?? 0) + 1;
    const present = SERVICE_TYPE_VALUES.filter((tp) => counts[tp] > 0);
    return [
      { key: "ALL", label: t("filters.allTypes"), count: initialItems.length },
      ...present.map((tp) => ({ key: tp, label: t(`types.${tp}`), count: counts[tp] })),
    ];
  }, [initialItems, t]);

  const visibleItems = useMemo(
    () => (typeFilter === "ALL" ? initialItems : initialItems.filter((it) => it.type === typeFilter)),
    [initialItems, typeFilter]
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

      {/* 타입 카테고리 탭 (빌라관리 상태 탭 스타일) */}
      {initialItems.length > 0 && (
        <div className="flex items-center gap-2 border-b border-admin-card overflow-x-auto">
          {typeTabs.map(({ key, label, count }) => {
            const active = typeFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(key)}
                className={
                  active
                    ? "px-4 py-3 text-sm font-bold text-admin-primary border-b-2 border-admin-primary flex items-center gap-2 whitespace-nowrap"
                    : "px-4 py-3 text-sm font-medium text-admin-muted hover:text-white transition-colors flex items-center gap-2 whitespace-nowrap"
                }
              >
                {label}
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] bg-admin-card ${
                    active ? "text-admin-primary" : "text-admin-muted"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 리스트 — 빌라관리형 행(썸네일·이름·타입배지·판매가·원가/마진·active·수정/삭제) */}
      {initialItems.length === 0 ? (
        <p className="text-sm text-slate-500 py-12 text-center">{t("empty")}</p>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-slate-500 py-12 text-center">{t("emptyFiltered")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleItems.map((item) => {
            const pct = showCost ? marginPct(item.priceVnd, item.costVnd) : null;
            const opts = parseCatalogOptions(item.options);
            const chips = [
              ...(opts.variants ?? []),
              ...(opts.addons ?? []),
              ...(opts.modifiers ?? []),
            ].slice(0, 4);
            return (
              <div
                key={item.id}
                className={`bg-admin-card rounded-xl border border-slate-800 overflow-hidden ${
                  item.active ? "" : "opacity-80"
                }`}
              >
                <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4">
                  {/* 썸네일 */}
                  <div
                    className={`relative w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-lg overflow-hidden bg-slate-800 ${
                      item.active ? "" : "grayscale"
                    }`}
                  >
                    {catalogImage(item.type, item.photoUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="w-full h-full object-cover"
                        alt={item.nameKo}
                        src={catalogImage(item.type, item.photoUrl)!}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        <span className="material-symbols-outlined">restaurant</span>
                      </div>
                    )}
                  </div>
                  {/* 본문 */}
                  <div className="min-w-0 flex-1 flex flex-col gap-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span
                          className={`inline-block text-white text-[10px] font-bold px-2 py-0.5 rounded-full mb-1 ${
                            TYPE_BADGE[item.type] ?? "bg-slate-600/90"
                          }`}
                        >
                          {t(`types.${item.type}`)}
                        </span>
                        <h3 className="text-sm sm:text-base font-bold text-white truncate">
                          {item.nameKo}
                          {item.unitLabelKo && (
                            <span className="ml-1.5 text-xs text-slate-500 font-medium">
                              / {item.unitLabelKo}
                            </span>
                          )}
                        </h3>
                      </div>
                      <span
                        className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                          item.active ? "bg-emerald-500/90 text-white" : "bg-slate-600/90 text-white"
                        }`}
                      >
                        {item.active ? t("active") : t("inactive")}
                      </span>
                    </div>
                    {/* 가격 행 */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      {item.priceVnd != null && (
                        <span className="text-slate-300">
                          {t("salePrice")}{" "}
                          <span className="font-bold text-white tabular-nums">
                            {formatThousands(item.priceVnd)}₫
                          </span>
                        </span>
                      )}
                      {/* 매입원가 — showCost(canViewFinance)만. STAFF엔 데이터 없음 */}
                      {showCost && item.costVnd != null && (
                        <span className="text-slate-500 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px] text-slate-600">
                            visibility
                          </span>
                          {t("cost")}{" "}
                          <span className="tabular-nums">{formatThousands(item.costVnd)}₫</span>
                        </span>
                      )}
                      {pct != null && (
                        <span className="bg-emerald-500/15 text-emerald-400 text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                          {t("margin", { pct })}
                        </span>
                      )}
                    </div>
                    {chips.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {chips.map((c) => (
                          <span
                            key={c.key}
                            className="bg-slate-700/60 text-slate-300 text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                          >
                            {c.labelKo}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* 액션 */}
                  {canEdit && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        aria-label={t("edit")}
                        disabled={busy}
                        className="text-slate-500 hover:text-admin-primary transition-colors disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-lg">edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        aria-label={t("delete")}
                        disabled={busy}
                        className="text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-lg">delete</span>
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.active}
                        aria-label={t("active")}
                        disabled={busy}
                        onClick={() => handleToggle(item)}
                        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                          item.active ? "bg-admin-primary" : "bg-slate-700"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                            item.active ? "translate-x-4" : ""
                          }`}
                        />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && canEdit && (
        <CatalogModal
          draft={draft}
          setDraft={setDraft}
          vendors={vendors}
          showCost={showCost}
          editing={editingId != null}
          busy={busy}
          error={formError}
          fx={fx}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
          t={t}
        />
      )}
    </section>
  );
}

// ── 생성/수정 모달 (b19 편집 카드) ─────────────────────────────────────────────
function CatalogModal({
  draft,
  setDraft,
  vendors,
  showCost,
  editing,
  busy,
  error,
  fx,
  onSave,
  onClose,
  t,
}: {
  draft: FormDraft;
  setDraft: (updater: (d: FormDraft) => FormDraft) => void;
  vendors: VendorOption[];
  showCost: boolean;
  editing: boolean;
  busy: boolean;
  error: string | null;
  fx: string | null;
  onSave: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const inputCls =
    "mt-1 w-full bg-admin-bg border border-slate-700 rounded px-2.5 py-1.5 text-sm text-white focus:border-admin-primary focus:outline-none";
  const numCls = `${inputCls} tabular-nums text-right`;
  const labelCls = "text-xs text-slate-500";

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // 사진 파일 업로드 → POST /api/uploads({url}) → photoUrl 세팅
  async function handleUpload(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("NO_URL");
      setDraft((d) => ({ ...d, photoUrl: data.url as string }));
    } catch {
      setUploadError(t("form.uploadError"));
    } finally {
      setUploading(false);
    }
  }

  // KRW 미리보기 — fx 있고 priceVnd 유효할 때만. priceKrwCeil(1000원 올림).
  const krwPreview =
    fx && draft.priceVnd
      ? (() => {
          try {
            const krw = priceKrwCeil(BigInt(draft.priceVnd), fx);
            return krw > 0 ? formatThousands(krw) : null;
          } catch {
            return null;
          }
        })()
      : null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-admin-card border-2 border-admin-primary/40 rounded-xl w-full max-w-2xl my-8 p-5 space-y-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-admin-primary">
              {editing ? "edit" : "add"}
            </span>
            {editing ? t("form.editTitle", { name: draft.nameKo }) : t("form.createTitle")}
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

        {/* 유형 + 이름(한국어만 — 서버 자동번역) */}
        <div>
          <label className={labelCls}>{t("form.type")}</label>
          <select
            value={draft.type}
            onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
            aria-label={t("form.type")}
            className={inputCls}
          >
            {SERVICE_TYPE_VALUES.map((tp) => (
              <option key={tp} value={tp}>
                {t(`types.${tp}`)}
              </option>
            ))}
          </select>
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
        <p className="text-[11px] text-slate-500 -mt-1.5">{t("form.autoTranslateHint")}</p>

        {/* 가격 VND(필수) + 원가(showCost) */}
        <div className={`grid grid-cols-1 gap-2 ${showCost ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
          <div>
            <label className={labelCls}>{t("form.priceVnd")}</label>
            <input
              inputMode="numeric"
              value={draft.priceVnd ? formatThousands(draft.priceVnd) : ""}
              onChange={(e) => setDraft((d) => ({ ...d, priceVnd: digits(e.target.value) }))}
              className={numCls}
            />
            {/* KRW 미리보기 — 환율 자동, 저장 안 함(참고용). fx 미설정이면 생략. */}
            {krwPreview && (
              <p className="text-[11px] text-slate-500 mt-1 text-right">
                {t("form.krwPreview", { krw: krwPreview })}
              </p>
            )}
          </div>
          {showCost && (
            <div>
              <label className={labelCls}>{t("form.costVnd")}</label>
              <input
                inputMode="numeric"
                value={draft.costVnd ? formatThousands(draft.costVnd) : ""}
                onChange={(e) => setDraft((d) => ({ ...d, costVnd: digits(e.target.value) }))}
                className={`mt-1 w-full bg-admin-bg border border-slate-700 rounded px-2.5 py-1.5 text-sm text-amber-300 tabular-nums text-right focus:border-admin-primary focus:outline-none`}
              />
            </div>
          )}
        </div>

        {/* 단위 + 사진 URL */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>{t("form.unitLabel")}</label>
            <input
              value={draft.unitLabelKo}
              onChange={(e) => setDraft((d) => ({ ...d, unitLabelKo: e.target.value }))}
              placeholder={t("form.unitPlaceholder")}
              maxLength={40}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>{t("form.photo")}</label>
            <div className="mt-1 flex items-center gap-3">
              {/* 썸네일 미리보기 */}
              <div className="relative w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-admin-bg border border-slate-700">
                {draft.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="w-full h-full object-cover" alt="" src={draft.photoUrl} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-700">
                    <span className="material-symbols-outlined">image</span>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  aria-label={t("form.photoUpload")}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    e.target.value = ""; // 같은 파일 재선택 허용
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 bg-admin-bg border border-slate-700 hover:border-admin-primary text-slate-200 text-xs font-bold rounded px-3 py-1.5 disabled:opacity-50 whitespace-nowrap transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">upload</span>
                  {uploading ? t("form.uploading") : draft.photoUrl ? t("form.photoReplace") : t("form.photoUpload")}
                </button>
                {draft.photoUrl && !uploading && (
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, photoUrl: "" }))}
                    className="text-[11px] text-slate-500 hover:text-red-400 text-left whitespace-nowrap"
                  >
                    {t("form.photoRemove")}
                  </button>
                )}
                {uploadError && <p className="text-[11px] text-red-400">{uploadError}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* 설명 (한국어만 — 서버 자동번역) */}
        <div>
          <label className={labelCls}>{t("form.descKo")}</label>
          <textarea
            value={draft.descKo}
            onChange={(e) => setDraft((d) => ({ ...d, descKo: e.target.value }))}
            placeholder={t("form.descPlaceholder")}
            maxLength={1000}
            rows={2}
            className={inputCls}
          />
        </div>

        {/* ADR-0023 — 원천 공급자 + 요청 가능 채널 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className={labelCls}>{t("form.vendor")}</label>
            <select
              value={draft.vendorId}
              onChange={(e) => setDraft((d) => ({ ...d, vendorId: e.target.value }))}
              aria-label={t("form.vendor")}
              className={inputCls}
            >
              <option value="">{t("form.vendorNone")}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">{t("form.vendorHint")}</p>
          </div>
          <div>
            <span className={labelCls}>{t("form.audiences")}</span>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {/* ADMIN — 항상 체크·잠금(운영자는 늘 요청 가능) */}
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked disabled className="accent-admin-primary opacity-60" />
                {t("form.audienceAdmin")}
                <span className="text-[10px] text-slate-600">{t("form.audienceAdminLocked")}</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.partner}
                  onChange={(e) => setDraft((d) => ({ ...d, partner: e.target.checked }))}
                  className="accent-admin-primary"
                />
                {t("form.audiencePartner")}
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.guest}
                  onChange={(e) => setDraft((d) => ({ ...d, guest: e.target.checked }))}
                  className="accent-admin-primary"
                />
                {t("form.audienceGuest")}
              </label>
            </div>
          </div>
        </div>

        {/* 옵션 빌더 */}
        <div className="space-y-3 pt-1">
          <div>
            <p className="text-xs font-bold text-slate-300">{t("form.optionsTitle")}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("form.optionsHint")}</p>
          </div>
          <OptionGroup
            title={t("form.variants")}
            rows={draft.variants}
            onChange={(rows) => setDraft((d) => ({ ...d, variants: rows }))}
            t={t}
          />
          <OptionGroup
            title={t("form.addons")}
            rows={draft.addons}
            onChange={(rows) => setDraft((d) => ({ ...d, addons: rows }))}
            t={t}
          />
          <OptionGroup
            title={t("form.modifiers")}
            rows={draft.modifiers}
            onChange={(rows) => setDraft((d) => ({ ...d, modifiers: rows }))}
            t={t}
          />
        </div>

        {/* 정렬 + active */}
        <div className="flex items-center justify-between gap-4 pt-1">
          <div className="flex items-center gap-2">
            <label className={labelCls}>{t("form.sortOrder")}</label>
            <input
              inputMode="numeric"
              value={draft.sortOrder}
              onChange={(e) => setDraft((d) => ({ ...d, sortOrder: digits(e.target.value) }))}
              className="w-16 bg-admin-bg border border-slate-700 rounded px-2 py-1 text-sm text-white tabular-nums text-right focus:border-admin-primary focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
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

// ── 옵션 그룹 행 편집기 (variants/addons/modifiers 공통) ────────────────────────
function OptionGroup({
  title,
  rows,
  onChange,
  t,
}: {
  title: string;
  rows: OptionDraft[];
  onChange: (rows: OptionDraft[]) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const update = (i: number, patch: Partial<OptionDraft>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { ...EMPTY_OPTION }]);

  const cell =
    "bg-admin-bg border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-admin-primary focus:outline-none";

  return (
    <div className="rounded-lg border border-slate-800 bg-admin-bg/40 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-400">{title}</span>
        <button
          type="button"
          onClick={add}
          className="text-[11px] font-bold text-admin-primary hover:underline flex items-center gap-0.5 whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          {t("form.addOption")}
        </button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
          <input
            value={r.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder={t("form.optKeyPlaceholder")}
            aria-label={t("form.optKey")}
            maxLength={40}
            className={`${cell} col-span-4`}
          />
          <input
            value={r.labelKo}
            onChange={(e) => update(i, { labelKo: e.target.value })}
            placeholder={t("form.optLabelKo")}
            maxLength={80}
            className={`${cell} col-span-4`}
          />
          <input
            inputMode="numeric"
            value={r.priceVnd ? formatThousands(r.priceVnd) : ""}
            onChange={(e) => update(i, { priceVnd: e.target.value.replace(/\D/g, "") })}
            placeholder={t("form.optPriceVnd")}
            className={`${cell} col-span-3 tabular-nums text-right`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={t("form.removeOption")}
            className="col-span-1 text-slate-500 hover:text-red-400 flex justify-center"
          >
            <span className="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      ))}
    </div>
  );
}
