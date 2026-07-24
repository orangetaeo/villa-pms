// /marketing/seo/places — 푸꾸옥 장소(맛집·카페·쇼핑) 등록 (운영자 다크, ko) — T-seo-place-article
//
// 여기 등록된 장소만 블로그 글에 등장할 수 있다. 남의 가게는 우리 DB가 사실 원천이 아니라
// AI에게 맡기면 없는 가게를 지어낸다 — **사실은 사람이 넣고 문장만 AI가 쓴다.**
//
// T-seo-ux-fix 반영:
//  · 사진은 **전부** 보여주고 장수를 표시한다(지적 2 — 잘라 보여줘서 등록 여부를 알 수 없었다)
//  · 사진은 여러 장 한 번에 올린다(지적 1)
//  · 상단 링크 나열 → 공통 탭(지적 5)
//  · "지금 글 만들기" — 3곳이 안 모여도 운영자가 원하면 즉시 초안 1편
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { PLACE_CATEGORIES, MIN_PLACES_PER_ARTICLE, MEDIA_KINDS } from "@/lib/seo/place-article";
import SeoNav from "../seo-nav";
import MediaUploader from "../media/media-uploader";
import {
  createPlace,
  updatePlace,
  togglePlaceActive,
  addPlacePhoto,
  togglePlacePhoto,
  updatePlacePhotoKind,
  draftPlaceArticleNow,
} from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketingSeoPlaces");
  return { title: `${t("title")} — Villa Go` };
}

const ERROR_KEYS: Record<string, string> = {
  NAME_REQUIRED: "errorName",
  CATEGORY_REQUIRED: "errorCategory",
  ONELINER_REQUIRED: "errorOneLiner",
  URL_REQUIRED: "errorNoFile",
  ALT_REQUIRED: "errorNoAlt",
  PLACE_NOT_AVAILABLE: "errorNotAvailable",
  DRAFT_FAILED: "errorDraftFailed",
};

export default async function SeoPlacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user?.id || !role || !isOperator(role)) redirect("/login");

  const t = await getTranslations("marketingSeoPlaces");
  const tn = await getTranslations("marketingSeoNav");
  const errorKey = ERROR_KEYS[(await searchParams).error ?? ""];

  const rows = await prisma.seoPlace.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      nameLocal: true,
      category: true,
      area: true,
      oneLiner: true,
      tips: true,
      active: true,
      usedInArticleId: true,
      // ★ 자르지 않는다 — 몇 장이 실제로 등록됐는지 보이는 것이 목적(지적 2)
      photos: { orderBy: { createdAt: "asc" }, select: { id: true, url: true, alt: true, active: true, kind: true } },
    },
  });

  const pendingByCat = new Map<string, number>();
  for (const r of rows) {
    if (!r.active || r.usedInArticleId) continue;
    pendingByCat.set(r.category, (pendingByCat.get(r.category) ?? 0) + 1);
  }

  const catLabel = (key: string) => PLACE_CATEGORIES.find((c) => c.key === key)?.label ?? key;
  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600";

  return (
    <div className="p-6 text-slate-100">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-1 text-sm text-slate-400">{t("subtitle", { n: MIN_PLACES_PER_ARTICLE })}</p>
      <div className="mt-4">
        <SeoNav current="places" labels={{ queue: tn("queue"), places: tn("places"), media: tn("media") }} />
      </div>

      {/* 카테고리별 진행도 — 3/3이면 다음 초안에 나간다 */}
      <ul className="mt-4 flex flex-wrap gap-1.5">
        {PLACE_CATEGORIES.map((c) => {
          const n = pendingByCat.get(c.key) ?? 0;
          const ready = n >= MIN_PLACES_PER_ARTICLE;
          return (
            <li
              key={c.key}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                ready ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"
              }`}
            >
              {c.label} {n}/{MIN_PLACES_PER_ARTICLE}
              {ready ? ` · ${t("ready")}` : ""}
            </li>
          );
        })}
      </ul>

      {errorKey && <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{t(errorKey)}</p>}

      {/* ── 장소 등록 ── */}
      <details className="mt-5 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <summary className="cursor-pointer text-base font-semibold">{t("addTitle")}</summary>
        <form action={createPlace} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">{t("nameLabel")}</span>
              <input name="name" required maxLength={120} placeholder={t("namePlaceholder")} className={inputCls} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-300">{t("categoryLabel")}</span>
              <select name="category" required defaultValue="" className={inputCls}>
                <option value="" disabled>
                  {t("categoryPlaceholder")}
                </option>
                {PLACE_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-300">{t("nameLocalLabel")}</span>
              <input name="nameLocal" maxLength={120} placeholder={t("nameLocalPlaceholder")} className={inputCls} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-300">{t("areaLabel")}</span>
              <input name="area" maxLength={80} placeholder={t("areaPlaceholder")} className={inputCls} />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-300">{t("oneLinerLabel")}</span>
            <textarea
              name="oneLiner"
              required
              rows={2}
              maxLength={500}
              placeholder={t("oneLinerPlaceholder")}
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-slate-500">{t("oneLinerHint")}</span>
          </label>

          <details className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
            <summary className="cursor-pointer text-sm text-slate-400">{t("moreFields")}</summary>
            <label className="mt-3 block">
              <span className="text-sm font-medium text-slate-300">{t("tipsLabel")}</span>
              <textarea name="tips" rows={2} maxLength={500} placeholder={t("tipsPlaceholder")} className={inputCls} />
              <span className="mt-1 block text-xs text-amber-400/80">{t("noVolatileHint")}</span>
            </label>
            <label className="mt-3 block">
              <span className="text-sm font-medium text-slate-300">{t("mapLabel")}</span>
              <input name="mapUrl" maxLength={500} placeholder="https://maps.app.goo.gl/…" className={inputCls} />
              <span className="mt-1 block text-xs text-slate-500">{t("mapHint")}</span>
            </label>
          </details>

          <button className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white">{t("save")}</button>
        </form>
      </details>

      {/* ── 목록 ── */}
      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">{t("empty")}</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((p) => {
            const activePhotos = p.photos.filter((ph) => ph.active);
            return (
              <li
                key={p.id}
                className={`rounded-xl border border-slate-800 bg-slate-900 ${p.active ? "" : "opacity-50"}`}
              >
                {/* 접고/펴기 — 장소가 늘어나면 목록이 화면을 다 잡아먹는다(테오 요청 2026-07-23).
                    요약 줄(이름·종류·사진 수·상태)은 접힌 상태에서도 보인다. */}
                <details className="group p-5">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 list-none">
                  <span className="text-slate-500 transition group-open:rotate-90">▶</span>
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    {catLabel(p.category)}
                  </span>
                  {p.area && <span className="text-xs text-slate-500">{p.area}</span>}
                  {p.usedInArticleId ? (
                    <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] text-blue-300">
                      {t("used")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
                      {t("waiting")}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-500">
                    {t("photoCount", { n: activePhotos.length, total: p.photos.length })}
                  </span>
                </summary>
                {p.nameLocal && <p className="mt-0.5 text-xs text-slate-500">{p.nameLocal}</p>}
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{p.oneLiner}</p>
                {p.tips && <p className="mt-1 text-sm text-slate-400">{p.tips}</p>}

                {/* 사진 — 전부, 작게. 각 사진 아래에 내리기/되살리기 */}
                {p.photos.length > 0 && (
                  <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                    {p.photos.map((ph) => (
                      <li key={ph.id} className={ph.active ? "" : "opacity-40"}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ph.url} alt={ph.alt} className="h-20 w-full rounded object-cover" title={ph.alt} />
                        <p className="mt-0.5 truncate text-[10px] text-slate-500" title={ph.alt}>
                          {ph.alt}
                        </p>
                        <form action={updatePlacePhotoKind} className="mt-0.5 flex gap-1">
                          <input type="hidden" name="mediaId" value={ph.id} />
                          <select
                            name="kind"
                            defaultValue={ph.kind ?? ""}
                            className="min-w-0 flex-1 rounded border border-slate-800 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-300"
                          >
                            <option value="">{t("kindUnset")}</option>
                            {MEDIA_KINDS.map((k) => (
                              <option key={k.key} value={k.key}>
                                {k.label}
                              </option>
                            ))}
                          </select>
                          <button className="shrink-0 text-[10px] text-blue-400">{t("apply")}</button>
                        </form>
                        <form action={togglePlacePhoto}>
                          <input type="hidden" name="mediaId" value={ph.id} />
                          <button className="text-[10px] text-slate-600 hover:text-slate-300">
                            {ph.active ? t("photoHide") : t("photoShow")}
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 flex flex-wrap gap-4">
                  <details className="min-w-[16rem] flex-1">
                    <summary className="cursor-pointer text-sm font-medium text-blue-400">{t("addPhoto")}</summary>
                    <form action={addPlacePhoto} className="mt-2 space-y-2">
                      <input type="hidden" name="placeId" value={p.id} />
                      <MediaUploader
                        altPrefix={p.name}
                        labels={{
                          pick: t("pickFile"),
                          uploading: t("uploading"),
                          uploadError: t("uploadError"),
                          tooLarge: t("tooLarge"),
                          done: t("uploadDone"),
                          altPlaceholder: t("photoAltPlaceholder"),
                          remove: t("removeFromList"),
                          kindLabel: t("kindUnset"),
                          kindOptions: MEDIA_KINDS,
                        }}
                      />
                      <button className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white">
                        {t("savePhoto")}
                      </button>
                    </form>
                  </details>

                  <details className="min-w-[16rem] flex-1">
                    <summary className="cursor-pointer text-sm font-medium text-blue-400">{t("edit")}</summary>
                    <form action={updatePlace} className="mt-2 space-y-2">
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        name="name"
                        defaultValue={p.name}
                        required
                        maxLength={120}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                      />
                      <input
                        name="area"
                        defaultValue={p.area ?? ""}
                        maxLength={80}
                        placeholder={t("areaPlaceholder")}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                      />
                      <textarea
                        name="oneLiner"
                        defaultValue={p.oneLiner}
                        required
                        rows={2}
                        maxLength={500}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                      />
                      <textarea
                        name="tips"
                        defaultValue={p.tips ?? ""}
                        rows={2}
                        maxLength={500}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                      />
                      <button className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white">
                        {t("save")}
                      </button>
                    </form>
                  </details>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4">
                  {!p.usedInArticleId && p.active && (
                    <form action={draftPlaceArticleNow}>
                      <input type="hidden" name="placeId" value={p.id} />
                      <button className="rounded-lg border border-blue-500/50 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-500/10">
                        {t("draftNow")}
                      </button>
                    </form>
                  )}
                  <form action={togglePlaceActive}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-xs font-semibold text-slate-500 hover:text-slate-300">
                      {p.active ? t("deactivate") : t("activate")}
                    </button>
                  </form>
                </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
