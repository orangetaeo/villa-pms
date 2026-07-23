// /marketing/seo/media — 가이드 글 자료 사진 라이브러리 (운영자 다크, ko) — T-seo-media-library
//
// 왜 있는가: 가이드 글에 빌라 사진을 끼우면 본문과 무관한 이미지가 된다. 그래서 **주제에 맞는 사진**을
// 운영자가 직접 올려두고(저작권 = 자사 촬영본), seo-draft cron이 주제 태그로 골라 본문에 넣는다.
//
// ★ RSC + 서버 액션 중심. 클라이언트 컴포넌트는 업로더 하나뿐이고 문구를 props로 받는다
//   (새 admin 클라이언트 네임스페이스를 만들지 않기 위함 — ADMIN_CLIENT_NAMESPACES 누락 함정 회피).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { userCanSeeMarketing } from "@/lib/marketing-access";
import { MEDIA_TOPIC_GROUPS } from "@/lib/seo/media";
import MediaUploader from "./media-uploader";
import { createMedia, updateMedia, toggleMediaActive } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketingSeoMedia");
  return { title: `${t("title")} — Villa Go` };
}

function fmt(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}.${p(kst.getUTCMonth() + 1)}.${p(kst.getUTCDate())}`;
}

/** 저장 실패 사유 → 화면 문구 키. 사전 밖 값은 무시한다(쿼리로 임의 문자열이 들어와도 렌더되지 않게). */
const ERROR_KEYS: Record<string, string> = {
  URL_REQUIRED: "errorNoFile",
  URL_NOT_ALLOWED: "errorBadUrl",
  ALT_REQUIRED: "errorNoAlt",
};

export default async function SeoMediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user?.id || !role || !isOperator(role)) redirect("/login");
  if (!(await userCanSeeMarketing(session.user.id))) redirect("/dashboard");

  const t = await getTranslations("marketingSeoMedia");
  const errorKey = ERROR_KEYS[(await searchParams).error ?? ""];
  const rows = await prisma.seoMedia.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    take: 60,
    select: {
      id: true,
      url: true,
      alt: true,
      caption: true,
      credit: true,
      topicKeys: true,
      usedCount: true,
      active: true,
      createdAt: true,
    },
  });

  const topicLabel = (key: string) =>
    MEDIA_TOPIC_GROUPS.flatMap((g) => g.options).find((x) => x.key === key)?.title ?? key;

  return (
    <div className="p-6 text-slate-100">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Link href="/marketing/seo" className="text-sm font-semibold text-blue-400">
          {t("backToQueue")}
        </Link>
        <Link href="/marketing/seo/places" className="text-sm font-semibold text-blue-400">
          {t("placesLink")}
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>

      {/* ── 업로드 ── */}
      <form action={createMedia} className="mt-6 space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">{t("uploadTitle")}</h2>
        {errorKey && (
          <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{t(errorKey)}</p>
        )}
        <MediaUploader
          labels={{
            pick: t("pickFile"),
            uploading: t("uploading"),
            uploadError: t("uploadError"),
            tooLarge: t("tooLarge"),
            done: t("uploadDone"),
          }}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-300">{t("altLabel")}</span>
            <input
              name="alt"
              required
              maxLength={200}
              placeholder={t("altPlaceholder")}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
            <span className="mt-1 block text-xs text-slate-500">{t("altHint")}</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-300">{t("captionLabel")}</span>
            <input
              name="caption"
              maxLength={200}
              placeholder={t("captionPlaceholder")}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
            <span className="mt-1 block text-xs text-slate-500">{t("captionHint")}</span>
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-300">{t("creditLabel")}</span>
          <input
            name="credit"
            maxLength={100}
            placeholder={t("creditPlaceholder")}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 sm:max-w-sm"
          />
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-slate-300">{t("topicsLabel")}</legend>
          <p className="text-xs text-slate-500">{t("topicsHint")}</p>
          {MEDIA_TOPIC_GROUPS.map((group) => (
            <div key={group.label} className="mt-3">
              <p className="text-xs font-semibold text-slate-400">{t(`group.${group.label}`)}</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {group.options.map((topic) => (
                  <label
                    key={topic.key}
                    className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-300"
                  >
                    <input type="checkbox" name="topicKeys" value={topic.key} className="accent-blue-500" />
                    {topic.title}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>

        <button className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white">{t("save")}</button>
      </form>

      {/* ── 목록 ── */}
      {rows.length === 0 ? (
        <p className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">{t("empty")}</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((m) => (
            <li
              key={m.id}
              className={`rounded-xl border border-slate-800 bg-slate-900 p-4 ${m.active ? "" : "opacity-50"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt={m.alt} className="aspect-video w-full rounded-lg object-cover" />
              <p className="mt-2 text-sm font-medium text-slate-200">{m.alt}</p>
              {m.caption && <p className="text-xs text-slate-400">{m.caption}</p>}
              <p className="mt-1 text-xs text-slate-500 tabular-nums">
                {t("usedCount", { n: m.usedCount })} · {fmt(m.createdAt)}
                {m.credit ? ` · ${m.credit}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {m.topicKeys.length === 0 ? (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    {t("generalTag")}
                  </span>
                ) : (
                  m.topicKeys.map((k) => (
                    <span key={k} className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                      {topicLabel(k)}
                    </span>
                  ))
                )}
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-blue-400">{t("edit")}</summary>
                <form action={updateMedia} className="mt-2 space-y-2">
                  <input type="hidden" name="id" value={m.id} />
                  <input
                    name="alt"
                    defaultValue={m.alt}
                    required
                    maxLength={200}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                  <input
                    name="caption"
                    defaultValue={m.caption ?? ""}
                    maxLength={200}
                    placeholder={t("captionPlaceholder")}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                  <div className="flex flex-wrap gap-1">
                    {MEDIA_TOPIC_GROUPS.flatMap((g) => g.options).map((topic) => (
                      <label
                        key={topic.key}
                        className="flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
                      >
                        <input
                          type="checkbox"
                          name="topicKeys"
                          value={topic.key}
                          defaultChecked={m.topicKeys.includes(topic.key)}
                          className="accent-blue-500"
                        />
                        {topic.title}
                      </label>
                    ))}
                  </div>
                  <button className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white">
                    {t("save")}
                  </button>
                </form>
              </details>

              <form action={toggleMediaActive} className="mt-2">
                <input type="hidden" name="id" value={m.id} />
                <button className="text-xs font-semibold text-slate-400">
                  {m.active ? t("deactivate") : t("activate")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
