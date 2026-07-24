// /marketing/seo/media — 가이드·서비스 글에 쓰는 **범용 자료 사진** (운영자 다크, ko)
//
// ★★ 여기 나오는 사진은 **특정 가게에 속하지 않는 사진만**이다(T-seo-ux-fix, 테오 지적 4).
//    장소 사진(placeId 있음)은 그 장소를 소개하는 글에서만 의미가 있으므로 /marketing/seo/places에서 관리한다.
//    이 목록이 둘을 섞어 보여줘서 "왜 식당 사진이 자료 사진에 있나"라는 혼란이 났다.
// ★ 목록은 조밀한 썸네일 그리드다 — 한 장씩 크게 나오면 몇 장인지·무엇이 있는지 파악이 안 된다(지적 3).
// ★ RSC + 서버 액션. 클라이언트 컴포넌트는 업로더 하나(문구는 props).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { MEDIA_TOPIC_GROUPS } from "@/lib/seo/media";
import SeoNav from "../seo-nav";
import MediaUploader from "./media-uploader";
import MediaDeleteBar from "./media-delete-bar";
import { createMedia, updateMedia, toggleMediaActive, deleteMedia } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketingSeoMedia");
  return { title: `${t("title")} — Villa Go` };
}

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

  const t = await getTranslations("marketingSeoMedia");
  const tn = await getTranslations("marketingSeoNav");
  const errorKey = ERROR_KEYS[(await searchParams).error ?? ""];

  // ★ placeId: null — 장소 사진은 여기 나오지 않는다(지적 4)
  const rows = await prisma.seoMedia.findMany({
    where: { placeId: null },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    take: 120,
    select: { id: true, url: true, alt: true, caption: true, topicKeys: true, usedCount: true, active: true },
  });

  const allTopics = MEDIA_TOPIC_GROUPS.flatMap((g) => g.options);
  const topicLabel = (key: string) => allTopics.find((x) => x.key === key)?.title ?? key;

  return (
    <div className="p-6 text-slate-100">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
      <div className="mt-4">
        <SeoNav current="media" labels={{ queue: tn("queue"), places: tn("places"), media: tn("media") }} />
      </div>

      {errorKey && <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{t(errorKey)}</p>}

      {/* ── 업로드 ── */}
      <form action={createMedia} className="mt-5 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-base font-semibold">{t("uploadTitle")}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t("altHint")}</p>

        <div className="mt-3">
          <MediaUploader
            labels={{
              pick: t("pickFile"),
              uploading: t("uploading"),
              uploadError: t("uploadError"),
              tooLarge: t("tooLarge"),
              done: t("uploadDone"),
              altPlaceholder: t("altPlaceholder"),
              remove: t("removeFromList"),
            }}
          />
        </div>

        {/* 주제 선택 — 접힌 상태가 기본. 펼치지 않으면 '범용'으로 저장된다(지적 5) */}
        <details className="mt-4 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-300">
            {t("topicsLabel")} <span className="text-xs font-normal text-slate-500">· {t("topicsHint")}</span>
          </summary>
          {MEDIA_TOPIC_GROUPS.map((group) => (
            <div key={group.label} className="mt-3">
              <p className="text-xs font-semibold text-slate-500">{t(`group.${group.label}`)}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {group.options.map((topic) => (
                  <label
                    key={topic.key}
                    className="flex items-center gap-1.5 rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:border-slate-500"
                  >
                    <input type="checkbox" name="topicKeys" value={topic.key} className="accent-blue-500" />
                    {topic.title}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </details>

        <button className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white">{t("save")}</button>
      </form>

      {/* ── 목록: 조밀한 썸네일 그리드 ── */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold">{t("listTitle")}</h2>
          <span className="text-xs text-slate-500">{t("count", { n: rows.length })}</span>
        </div>
        {/* 다중선택 영구삭제 — 체크박스는 아래 목록 <li>에 있고 form 속성으로 이 form에 연결된다.
            (각 <li>가 이미 수정·중지용 <form>을 품고 있어 <ul>을 form으로 감싸면 중첩 form이 되므로 감싸지 않는다.) */}
        {rows.length > 0 && (
          <form id="media-delete-form" action={deleteMedia}>
            <MediaDeleteBar
              selectAllLabel={t("selectAll")}
              deleteLabel={t("deleteSelected")}
              deletingLabel={t("deleting")}
              // "{n}"은 클라이언트가 실제 선택 개수로 치환한다(서버 렌더 시점엔 개수를 모름).
              confirmTemplate={t("deleteConfirm", { n: "{n}" })}
              noneSelectedText={t("deleteNoneSelected")}
            />
          </form>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">{t("empty")}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {rows.map((m) => (
            <li
              key={m.id}
              className={`relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900 ${m.active ? "" : "opacity-40"}`}
            >
              {/* 삭제 대상 선택 체크박스 — form 속성으로 상단 media-delete-form에 연결(중첩 form 회피).
                  비활성(사용 중지)인 사진도 삭제 대상에 포함된다. */}
              <label className="absolute left-1.5 top-1.5 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-slate-950/70 backdrop-blur-sm">
                <input
                  type="checkbox"
                  name="ids"
                  value={m.id}
                  form="media-delete-form"
                  data-media-select="1"
                  className="h-4 w-4 accent-red-500"
                />
              </label>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt={m.alt} className="h-28 w-full object-cover" />
              <div className="p-2">
                <p className="truncate text-xs font-medium text-slate-200" title={m.alt}>
                  {m.alt}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {m.topicKeys.length === 0 ? t("generalTag") : m.topicKeys.map(topicLabel).join(", ")}
                </p>
                <p className="text-[11px] text-slate-600">{t("usedCount", { n: m.usedCount })}</p>

                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-blue-400">{t("edit")}</summary>
                  <form action={updateMedia} className="mt-1.5 space-y-1.5">
                    <input type="hidden" name="id" value={m.id} />
                    <input
                      name="alt"
                      defaultValue={m.alt}
                      required
                      maxLength={200}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200"
                    />
                    <input
                      name="caption"
                      defaultValue={m.caption ?? ""}
                      maxLength={200}
                      placeholder={t("captionPlaceholder")}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200"
                    />
                    <div className="max-h-28 overflow-y-auto rounded border border-slate-800 p-1">
                      {allTopics.map((topic) => (
                        <label key={topic.key} className="flex items-center gap-1 py-0.5 text-[11px] text-slate-300">
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
                    <button className="w-full rounded bg-blue-500 py-1 text-[11px] font-semibold text-white">
                      {t("save")}
                    </button>
                  </form>
                </details>

                <form action={toggleMediaActive} className="mt-1">
                  <input type="hidden" name="id" value={m.id} />
                  <button className="text-[11px] text-slate-500 hover:text-slate-300">
                    {m.active ? t("deactivate") : t("activate")}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
