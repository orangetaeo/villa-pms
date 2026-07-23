// /marketing/seo — 가이드 글 승인 큐 (운영자 다크, ko) — T-seo-s3
//
// RSC + 서버 액션만 사용한다(클라이언트 컴포넌트 없음):
//   · 새 admin 클라이언트 네임스페이스를 만들지 않아도 되고(ADMIN_CLIENT_NAMESPACES 누락 함정 회피)
//   · 승인/반려가 폼 제출이라 상태 동기화 버그가 생길 여지가 없다
//
// ★ 승인 = 발행 큐 진입. 실제 발행은 seo-publish cron이 일 상한을 지키며 수행한다.
// ★ 누수 표면 없음 — SeoArticle에 원가·판매가·공급자 필드 자체가 없다.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SeoArticleStatus } from "@prisma/client";
import { auth } from "@/auth";
import { isOperator } from "@/lib/permissions";
import { userCanSeeMarketing } from "@/lib/marketing-access";
import { parseArticleBody, bodyTextLength } from "@/lib/seo/article";
import { blogPaths } from "@/lib/seo/routes";
import SeoNav from "./seo-nav";
import { approveArticle, rejectArticle, toggleArticleVisibility, updateArticleBody } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketingSeo");
  return { title: `${t("title")} — Villa Go` };
}

const TABS: { key: string; status?: SeoArticleStatus }[] = [
  { key: "pending", status: SeoArticleStatus.PENDING_APPROVAL },
  { key: "approved", status: SeoArticleStatus.APPROVED },
  { key: "published", status: SeoArticleStatus.PUBLISHED },
  { key: "rejected", status: SeoArticleStatus.REJECTED },
];

function fmt(d: Date | null): string {
  if (!d) return "—";
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}.${p(kst.getUTCMonth() + 1)}.${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`;
}

export default async function MarketingSeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user?.id || !role || !isOperator(role)) redirect("/login");
  if (!(await userCanSeeMarketing(session.user.id))) redirect("/dashboard");

  const t = await getTranslations("marketingSeo");
  const tn = await getTranslations("marketingSeoNav");
  const params = await searchParams;
  const tabKey = TABS.some((x) => x.key === params.tab) ? params.tab! : "pending";
  const status = TABS.find((x) => x.key === tabKey)!.status;

  const [rows, counts] = await Promise.all([
    prismaList(status),
    Promise.all(TABS.map((x) => countByStatus(x.status))),
  ]);

  return (
    <div className="p-6 text-slate-100">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
      <div className="mt-4">
        <SeoNav current="queue" labels={{ queue: tn("queue"), places: tn("places"), media: tn("media") }} />
      </div>

      <nav className="mt-5 flex flex-wrap gap-2">
        {TABS.map((tab, i) => (
          <Link
            key={tab.key}
            href={`/marketing/seo?tab=${tab.key}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              tab.key === tabKey ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            {t(`tabs.${tab.key}`)} {counts[i]}
          </Link>
        ))}
      </nav>

      {params.error === "TOO_SHORT" && (
        <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
          {t("errorTooShort", { chars: Number(params.chars ?? 0), min: Number(params.min ?? 800) })}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((a) => {
            const blocks = parseArticleBody(a.bodyJson);
            const chars = bodyTextLength(blocks);
            const flagged = Array.isArray(a.flaggedTerms) ? (a.flaggedTerms as string[]) : [];
            return (
              <li key={a.id} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{a.title}</h2>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                    {t("chars", { n: chars })}
                  </span>
                  {a.publicHidden && a.status === SeoArticleStatus.PUBLISHED && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                      {t("hiddenBadge")}
                    </span>
                  )}
                  {flagged.length > 0 && (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300">
                      {t("flagged", { terms: flagged.join(", ") })}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500 tabular-nums">
                  /{a.slug} · {t("created")} {fmt(a.createdAt)}
                  {a.publishedAt ? ` · ${t("publishedAt")} ${fmt(a.publishedAt)}` : ""}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">{a.summary}</p>

                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-blue-400">{t("preview")}</summary>
                  <div className="mt-3 space-y-3 rounded-lg bg-slate-950 p-4">
                    {blocks.map((b, i) =>
                      b.type === "h2" ? (
                        <h3 key={i} className="font-bold text-slate-100">
                          {b.text}
                        </h3>
                      ) : b.type === "ul" ? (
                        <ul key={i} className="list-disc pl-5 text-sm text-slate-300">
                          {b.items.map((it, j) => (
                            <li key={j}>{it}</li>
                          ))}
                        </ul>
                      ) : b.type === "img" ? (
                        // 승인 화면에서도 실제 이미지를 확인할 수 있어야 한다(alt·배치 검수).
                        // eslint-disable-next-line @next/next/no-img-element
                        <figure key={i}>
                          <img src={b.url} alt={b.alt} className="w-full rounded-lg" />
                          <figcaption className="mt-1 text-xs text-slate-500">
                            alt: {b.alt}
                            {b.caption ? ` · ${b.caption}` : ""}
                          </figcaption>
                        </figure>
                      ) : b.type === "video" ? (
                        <p key={i} className="rounded-lg bg-slate-800 p-2 text-xs text-slate-300">
                          🎬 영상: {b.title} (youtube {b.ytVideoId})
                        </p>
                      ) : (
                        <p key={i} className="text-sm leading-relaxed text-slate-300">
                          {b.text}
                        </p>
                      )
                    )}
                  </div>
                </details>

                {/* ── 본문 편집 (T-seo-article-edit) ──
                    승인/반려 두 개뿐이라 문장 하나 때문에 글 전체를 버려야 했다. 여기서 고쳐서 승인한다.
                    ★ 클라 JS 없이 동작: 폼 배열 순서 = 블록 순서, 삭제는 select(체크박스는 미전송 시 짝이 어긋남) */}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-amber-400">{t("edit")}</summary>
                  <form action={updateArticleBody} className="mt-3 space-y-3 rounded-lg bg-slate-950 p-4">
                    <input type="hidden" name="id" value={a.id} />
                    <label className="block">
                      <span className="text-xs font-medium text-slate-400">{t("editTitle")}</span>
                      <input
                        name="title"
                        defaultValue={a.title}
                        maxLength={200}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-400">{t("editSummary")}</span>
                      <textarea
                        name="summary"
                        defaultValue={a.summary}
                        rows={2}
                        maxLength={300}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
                      />
                    </label>

                    <ul className="space-y-2">
                      {blocks.map((b, i) => (
                        <li key={i} className="rounded border border-slate-800 p-2">
                          {/* ★ 모든 배열 필드는 **블록마다 정확히 하나씩** 나가야 한다 —
                              조건부로 빼면 getAll() 인덱스가 밀려 다른 블록의 값이 섞인다. */}
                          <input type="hidden" name="bType" value={b.type} />
                          <input type="hidden" name="bUrl" value={b.type === "img" ? b.url : ""} />
                          <input type="hidden" name="bVideo" value={b.type === "video" ? b.ytVideoId : ""} />
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold uppercase text-slate-500">
                              {b.type === "h2" ? t("blockH2") : b.type === "p" ? t("blockP") : b.type === "img" ? t("blockImg") : b.type === "ul" ? t("blockUl") : t("blockVideo")}
                            </span>
                            <select
                              name="bKeep"
                              defaultValue="keep"
                              className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-300"
                            >
                              <option value="keep">{t("keep")}</option>
                              <option value="drop">{t("drop")}</option>
                            </select>
                          </div>

                          {b.type === "img" ? (
                            <div className="mt-1.5 flex gap-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={b.url} alt={b.alt} className="h-16 w-16 shrink-0 rounded object-cover" />
                              <div className="min-w-0 flex-1 space-y-1">
                                <input
                                  name="bAlt"
                                  defaultValue={b.alt}
                                  maxLength={200}
                                  placeholder={t("altPlaceholder")}
                                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                                />
                                <input
                                  name="bText"
                                  defaultValue={b.caption ?? ""}
                                  maxLength={200}
                                  placeholder={t("captionPlaceholder2")}
                                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              {/* 배열 짝 맞추기 — img가 아닌 블록도 bAlt 자리를 채워야 인덱스가 밀리지 않는다 */}
                              <input type="hidden" name="bAlt" value="" />
                              <textarea
                                name="bText"
                                defaultValue={b.type === "ul" ? b.items.join(String.fromCharCode(10)) : b.type === "video" ? b.title : b.text}
                                rows={b.type === "h2" ? 1 : 3}
                                className="mt-1.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm leading-relaxed text-slate-200"
                              />
                            </>
                          )}
                        </li>
                      ))}
                    </ul>

                    <p className="text-[11px] text-slate-500">{t("editHint", { min: 800 })}</p>
                    <button className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900">
                      {t("saveEdit")}
                    </button>
                  </form>
                </details>

                {a.rejectionReason && (
                  <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
                    {t("rejectedReason")}: {a.rejectionReason}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {a.status === SeoArticleStatus.PENDING_APPROVAL && (
                    <form action={approveArticle}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white">
                        {t("approve")}
                      </button>
                    </form>
                  )}
                  {a.status !== SeoArticleStatus.PUBLISHED && a.status !== SeoArticleStatus.REJECTED && (
                    <form action={rejectArticle} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={a.id} />
                      <input
                        name="reason"
                        placeholder={t("rejectPlaceholder")}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                      />
                      <button className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">
                        {t("reject")}
                      </button>
                    </form>
                  )}
                  {a.status === SeoArticleStatus.PUBLISHED && (
                    <form action={toggleArticleVisibility}>
                      <input type="hidden" name="id" value={a.id} />
                      <button
                        className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
                          a.publicHidden
                            ? "border-emerald-500/50 text-emerald-300"
                            : "border-slate-700 text-slate-300"
                        }`}
                      >
                        {a.publicHidden ? t("show") : t("hide")}
                      </button>
                    </form>
                  )}
                  {a.status === SeoArticleStatus.PUBLISHED && !a.publicHidden && (
                    <a
                      href={blogPaths.article(a.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-blue-400"
                    >
                      {t("openPublic")}
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── 조회 헬퍼 (파일 하단 배치 — 페이지 본문 가독성 우선) ──
import { prisma } from "@/lib/prisma";

async function prismaList(status?: SeoArticleStatus) {
  return prisma.seoArticle.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 20, // 서버 페이지네이션 기본(목록 기본 10 규칙보다 완화 — 승인 큐는 한눈에 보는 용도)
    select: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      bodyJson: true,
      status: true,
      publicHidden: true,
      flaggedTerms: true,
      rejectionReason: true,
      createdAt: true,
      publishedAt: true,
    },
  });
}

async function countByStatus(status?: SeoArticleStatus) {
  return prisma.seoArticle.count({ where: status ? { status } : {} });
}
