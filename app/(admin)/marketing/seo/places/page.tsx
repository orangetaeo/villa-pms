// /marketing/seo/places — 푸꾸옥 장소(맛집·카페·쇼핑) 등록 (운영자 다크, ko) — T-seo-place-article
//
// 여기 등록된 장소만 블로그 글에 등장할 수 있다. 남의 가게는 우리 DB가 사실 원천이 아니라
// AI에게 맡기면 없는 가게를 지어낸다 — **사실은 사람이 넣고 문장만 AI가 쓴다.**
//
// ★ 카테고리별로 "아직 소개 안 한 장소" 3곳이 모이면 다음 초안에서 한 편이 만들어진다.
//   화면 상단에 그 진행도를 보여준다(3곳까지 몇 곳 남았는지).
// ★ RSC + 서버 액션. 클라이언트 컴포넌트는 사진 업로더 하나(문구는 props).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { userCanSeeMarketing } from "@/lib/marketing-access";
import { PLACE_CATEGORIES, MIN_PLACES_PER_ARTICLE } from "@/lib/seo/place-article";
import MediaUploader from "../media/media-uploader";
import { createPlace, updatePlace, togglePlaceActive, addPlacePhoto } from "./actions";

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
};

export default async function SeoPlacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user?.id || !role || !isOperator(role)) redirect("/login");
  if (!(await userCanSeeMarketing(session.user.id))) redirect("/dashboard");

  const t = await getTranslations("marketingSeoPlaces");
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
      photos: { where: { active: true }, select: { id: true, url: true, alt: true }, take: 4 },
    },
  });

  // 카테고리별 "아직 소개 안 한 활성 장소" 수 — 3곳이면 다음 초안에서 한 편이 나간다
  const pendingByCat = new Map<string, number>();
  for (const r of rows) {
    if (!r.active || r.usedInArticleId) continue;
    pendingByCat.set(r.category, (pendingByCat.get(r.category) ?? 0) + 1);
  }

  const catLabel = (key: string) => PLACE_CATEGORIES.find((c) => c.key === key)?.label ?? key;
  const uploaderLabels = {
    pick: t("pickFile"),
    uploading: t("uploading"),
    uploadError: t("uploadError"),
    tooLarge: t("tooLarge"),
    done: t("uploadDone"),
  };

  return (
    <div className="p-6 text-slate-100">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Link href="/marketing/seo" className="text-sm font-semibold text-blue-400">
          {t("backToQueue")}
        </Link>
        <Link href="/marketing/seo/media" className="text-sm font-semibold text-blue-400">
          {t("mediaLink")}
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-400">{t("subtitle", { n: MIN_PLACES_PER_ARTICLE })}</p>

      {/* ── 카테고리별 진행도 ── */}
      <ul className="mt-4 flex flex-wrap gap-2">
        {PLACE_CATEGORIES.map((c) => {
          const n = pendingByCat.get(c.key) ?? 0;
          const ready = n >= MIN_PLACES_PER_ARTICLE;
          return (
            <li
              key={c.key}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                ready ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-300"
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
      <form action={createPlace} className="mt-6 space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">{t("addTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-300">{t("nameLabel")}</span>
            <input
              name="name"
              required
              maxLength={120}
              placeholder={t("namePlaceholder")}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-300">{t("nameLocalLabel")}</span>
            <input
              name="nameLocal"
              maxLength={120}
              placeholder={t("nameLocalPlaceholder")}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-300">{t("categoryLabel")}</span>
            <select
              name="category"
              required
              defaultValue=""
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
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
            <span className="text-sm font-medium text-slate-300">{t("areaLabel")}</span>
            <input
              name="area"
              maxLength={80}
              placeholder={t("areaPlaceholder")}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
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
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          />
          <span className="mt-1 block text-xs text-slate-500">{t("oneLinerHint")}</span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-300">{t("tipsLabel")}</span>
          <textarea
            name="tips"
            rows={2}
            maxLength={500}
            placeholder={t("tipsPlaceholder")}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          />
          <span className="mt-1 block text-xs text-slate-500">{t("noVolatileHint")}</span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-300">{t("mapLabel")}</span>
          <input
            name="mapUrl"
            maxLength={500}
            placeholder="https://maps.app.goo.gl/…"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          />
          <span className="mt-1 block text-xs text-slate-500">{t("mapHint")}</span>
        </label>

        <button className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white">{t("save")}</button>
      </form>

      {/* ── 목록 ── */}
      {rows.length === 0 ? (
        <p className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">{t("empty")}</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((p) => (
            <li
              key={p.id}
              className={`rounded-xl border border-slate-800 bg-slate-900 p-5 ${p.active ? "" : "opacity-50"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                  {catLabel(p.category)}
                </span>
                {p.area && <span className="text-xs text-slate-500">{p.area}</span>}
                {p.usedInArticleId ? (
                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-300">{t("used")}</span>
                ) : (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                    {t("waiting")}
                  </span>
                )}
              </div>
              {p.nameLocal && <p className="mt-0.5 text-xs text-slate-500">{p.nameLocal}</p>}
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{p.oneLiner}</p>
              {p.tips && <p className="mt-1 text-sm text-slate-400">{p.tips}</p>}

              {p.photos.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.photos.map((ph) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={ph.id} src={ph.url} alt={ph.alt} className="h-24 rounded-lg object-cover" />
                  ))}
                </div>
              )}

              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-blue-400">{t("addPhoto")}</summary>
                <form action={addPlacePhoto} className="mt-2 space-y-2">
                  <input type="hidden" name="placeId" value={p.id} />
                  <MediaUploader labels={uploaderLabels} />
                  <input
                    name="alt"
                    required
                    maxLength={200}
                    placeholder={t("photoAltPlaceholder")}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                  <button className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white">
                    {t("savePhoto")}
                  </button>
                </form>
              </details>

              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-blue-400">{t("edit")}</summary>
                <form action={updatePlace} className="mt-2 space-y-2">
                  <input type="hidden" name="id" value={p.id} />
                  <input
                    name="name"
                    defaultValue={p.name}
                    required
                    maxLength={120}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                  <input
                    name="area"
                    defaultValue={p.area ?? ""}
                    maxLength={80}
                    placeholder={t("areaPlaceholder")}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                  <textarea
                    name="oneLiner"
                    defaultValue={p.oneLiner}
                    required
                    rows={2}
                    maxLength={500}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                  <textarea
                    name="tips"
                    defaultValue={p.tips ?? ""}
                    rows={2}
                    maxLength={500}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                  <button className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white">
                    {t("save")}
                  </button>
                </form>
              </details>

              <form action={togglePlaceActive} className="mt-2">
                <input type="hidden" name="id" value={p.id} />
                <button className="text-xs font-semibold text-slate-400">
                  {p.active ? t("deactivate") : t("activate")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
