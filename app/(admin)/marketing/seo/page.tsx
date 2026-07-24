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
import { parseArticleBody, bodyTextLength, approvedPublishEstimates } from "@/lib/seo/article";
import { blogPaths } from "@/lib/seo/routes";
import {
  SEO_ARTICLE_CATEGORIES,
  type SeoArticleCategory,
  isSeoArticleCategory,
  seoArticleCategoryLabel,
} from "@/lib/seo/categories";
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

/** 헤더 배지 — 카드가 접혀 있을 때 글 상태를 알려주는 유일한 단서라 색으로 구분한다. */
function Badge({ tone, children }: { tone: "neutral" | "warn" | "danger" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "danger"
      ? "bg-red-500/15 text-red-300"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-300"
        : tone === "info"
          ? "bg-teal-500/15 text-teal-300"
          : "bg-slate-800 text-slate-300";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** 펼침 화살표 — 운영자 레이아웃에 아이콘 폰트가 없어 인라인 SVG로 그린다. 회전은 부모 <details>가 건다. */
function Chevron({ scope }: { scope: "card" | "chip" }) {
  const cls =
    scope === "card"
      ? "h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200"
      : "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200";
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={cls}>
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * 열렸을 때 자기 summary의 화살표만 뒤집는다.
 * ★ `group-open:`을 쓰지 않는 이유 둘: ⑴ 카드 안에 칩 <details>가 중첩돼 있어 group을 공유하면
 *   카드를 펼치는 순간 칩 화살표까지 같이 돌아간다 ⑵ 직계 자식(>summary>svg)으로 막으면 중첩과 무관하게 안전하다.
 */
const OPEN_ROTATE = "[&[open]>summary>svg]:rotate-180";

/**
 * 본문 미리보기·본문 편집 토글 = 버튼처럼 보여야 한다(텍스트 링크는 눌러도 되는지 알 수 없다).
 * 접힌 동안은 칩 크기(w-fit)로 나란히 서고, 펼치면 `open:` 변형으로 한 줄을 통째로 차지한다 —
 * 안 그러면 펼친 내용이 flex 아이템 폭에 갇혀 반쪽짜리 컬럼이 된다.
 */
const CHIP =
  "inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 [&::-webkit-details-marker]:hidden";
const CHIP_DETAILS = `w-fit open:w-full open:basis-full ${OPEN_ROTATE}`;

export default async function MarketingSeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user?.id || !role || !isOperator(role)) redirect("/login");

  const t = await getTranslations("marketingSeo");
  const tn = await getTranslations("marketingSeoNav");
  const params = await searchParams;
  const tabKey = TABS.some((x) => x.key === params.tab) ? params.tab! : "pending";
  const status = TABS.find((x) => x.key === tabKey)!.status;
  // 카테고리 필터 — 화이트리스트 밖 값(?cat=xxx)은 무시하고 '전체'로 처리한다.
  const catKey: SeoArticleCategory | undefined =
    params.cat && isSeoArticleCategory(params.cat) ? params.cat : undefined;
  // 모두 펼치기/접기 — 클라이언트 JS 없이 링크(쿼리)로 전환한다(RSC 전용 원칙 유지).
  const expandAll = params.open === "1";
  // 상태 탭·카테고리 칩·펼치기 링크가 서로의 파라미터를 보존하도록 한 곳에서 조립한다.
  //   cat: null = '전체'(제거), undefined = 현재값 유지.
  const href = (opts: { tab?: string; cat?: SeoArticleCategory | null; open?: boolean } = {}) => {
    const tab = opts.tab ?? tabKey;
    const cat = opts.cat === null ? undefined : (opts.cat ?? catKey);
    const open = opts.open ?? expandAll;
    const qs = new URLSearchParams({ tab });
    if (cat) qs.set("cat", cat);
    if (open) qs.set("open", "1");
    return `/marketing/seo?${qs.toString()}`;
  };

  const [rows, counts, catCounts, catAllCount] = await Promise.all([
    // 목록은 선택된 상태 + 카테고리 둘 다로 필터한다.
    prismaList(status, catKey),
    // 상태 탭 건수 = 현재 카테고리 기준(카테고리를 고르면 탭 숫자도 그 안에서만 센다).
    Promise.all(TABS.map((x) => countWhere(x.status, catKey))),
    // 카테고리 칩 건수 = 현재 상태 기준.
    Promise.all(SEO_ARTICLE_CATEGORIES.map((c) => countWhere(status, c))),
    countWhere(status, undefined),
  ]);
  // 발행 대기(APPROVED) 글의 예정 발행 시각 — 큐에 하나라도 있을 때만 계산한다.
  const hasApproved = rows.some((r) => r.status === SeoArticleStatus.APPROVED);
  const publishEstimates = hasApproved
    ? await approvedPublishEstimates(new Date())
    : { estimateById: new Map<string, Date>(), perDay: 0 };
  const catChip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      active ? "bg-teal-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
    }`;

  return (
    <div className="p-6 text-slate-100">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
      <div className="mt-4">
        <SeoNav current="queue" labels={{ queue: tn("queue"), places: tn("places"), media: tn("media") }} />
      </div>

      <nav className="mt-5 flex flex-wrap items-center gap-2">
        {TABS.map((tab, i) => (
          <Link
            key={tab.key}
            href={href({ tab: tab.key })}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              tab.key === tabKey
                ? "bg-blue-500 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {t(`tabs.${tab.key}`)} {counts[i]}
          </Link>
        ))}
        {rows.length > 1 && (
          <Link
            href={href({ open: !expandAll })}
            className="ml-auto rounded-full border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
          >
            {expandAll ? t("collapseAll") : t("expandAll")}
          </Link>
        )}
      </nav>

      {/* 카테고리 필터 — 가이드·서비스·맛집·빌라 글이 한 큐에 섞이는 문제를 분리한다(RSC 전용: 쿼리 링크). */}
      <nav className="mt-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-slate-500">{t("categoryFilter")}</span>
        <Link href={href({ cat: null })} className={catChip(!catKey)}>
          {t("catAll")} {catAllCount}
        </Link>
        {SEO_ARTICLE_CATEGORIES.map((c, i) => (
          <Link key={c} href={href({ cat: c })} className={catChip(catKey === c)}>
            {seoArticleCategoryLabel(c, "ko")} {catCounts[i]}
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
        <ul className="mt-6 space-y-3">
          {rows.map((a) => {
            const blocks = parseArticleBody(a.bodyJson);
            const chars = bodyTextLength(blocks);
            const flagged = Array.isArray(a.flaggedTerms) ? (a.flaggedTerms as string[]) : [];
            const photoCount = blocks.filter((b) => b.type === "img").length;
            const thumb = a.thumbnailUrl ?? a.coverPhotoUrl;
            return (
              <li key={a.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
                {/* 접었다 폈다 — 글 1건일 때와 '모두 펼치기'일 때만 열린 채로 시작한다. */}
                <details className={OPEN_ROTATE} open={expandAll || rows.length === 1}>
                  {/* 접힌 상태의 유일한 정보원 = 이 헤더. 썸네일·제목·경고 배지·경로/시각을 한 줄에 담는다.
                      ★ summary 안에는 버튼·폼을 넣지 않는다 — 클릭이 전부 펼침/접힘으로 먹힌다(액션은 본문에). */}
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-4 transition-colors hover:bg-slate-800/40 [&::-webkit-details-marker]:hidden">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="h-14 w-14 shrink-0 rounded-lg border border-dashed border-slate-700 bg-slate-950" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="max-w-full truncate text-base font-semibold">{a.title}</h2>
                        {/* 카테고리 배지 — 전체 목록에서도 각 글이 무슨 유형인지 접힌 채로 구분한다. */}
                        <Badge tone="info">
                          {isSeoArticleCategory(a.category) ? seoArticleCategoryLabel(a.category, "ko") : a.category}
                        </Badge>
                        <Badge tone="neutral">{t("chars", { n: chars })}</Badge>
                        {/* 사진 0장은 실제로 나던 사고(맛집 글에 음식 사진 한 장도 없음) — 접힌 채로도 보이게 한다 */}
                        <Badge tone={photoCount === 0 ? "danger" : "neutral"}>
                          {photoCount === 0 ? t("noPhoto") : t("photoCount", { n: photoCount })}
                        </Badge>
                        {a.publicHidden && a.status === SeoArticleStatus.PUBLISHED && (
                          <Badge tone="warn">{t("hiddenBadge")}</Badge>
                        )}
                        {flagged.length > 0 && (
                          <Badge tone="danger">{t("flagged", { terms: flagged.join(", ") })}</Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500 tabular-nums">
                        /{a.slug} · {t("created")} {fmt(a.createdAt)}
                        {a.publishedAt ? ` · ${t("publishedAt")} ${fmt(a.publishedAt)}` : ""}
                      </p>
                      {a.status === SeoArticleStatus.APPROVED && publishEstimates.estimateById.has(a.id) && (
                        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-teal-300">
                          <span aria-hidden="true">🕒</span>
                          {t("publishEta", { at: fmt(publishEstimates.estimateById.get(a.id)!) })}
                        </p>
                      )}
                    </div>
                    <Chevron scope="card" />
                  </summary>

                  <div className="border-t border-slate-800 px-4 pb-4 pt-3">
                    <p className="text-sm leading-relaxed text-slate-300">{a.summary}</p>

                    {/* 미리보기·편집 토글 한 줄 — 접혀 있을 땐 칩 두 개, 하나를 펼치면 그 칩이 줄 전체를 먹는다 */}
                    <div className="mt-3 flex flex-wrap items-start gap-2">
                      <details className={CHIP_DETAILS}>
                        <summary className={CHIP}>
                          {t("preview")}
                          <Chevron scope="chip" />
                        </summary>
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
                              <figure key={i}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
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
                      <details className={CHIP_DETAILS}>
                        <summary className={CHIP}>
                          {t("edit")}
                          <Chevron scope="chip" />
                        </summary>
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
                          <button className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-400">
                            {t("saveEdit")}
                          </button>
                        </form>
                      </details>
                    </div>

                    {a.rejectionReason && (
                      <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
                        {t("rejectedReason")}: {a.rejectionReason}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                      {a.status === SeoArticleStatus.PENDING_APPROVAL && (
                        <form action={approveArticle}>
                          <input type="hidden" name="id" value={a.id} />
                          <button className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-400">
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
                            className="w-52 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
                          />
                          <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-300 transition-colors hover:border-red-500/60 hover:text-red-300">
                            {t("reject")}
                          </button>
                        </form>
                      )}
                      {a.status === SeoArticleStatus.PUBLISHED && (
                        <form action={toggleArticleVisibility}>
                          <input type="hidden" name="id" value={a.id} />
                          <button
                            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                              a.publicHidden
                                ? "border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10"
                                : "border-slate-700 text-slate-300 hover:border-slate-500"
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
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-semibold text-blue-400 transition-colors hover:border-blue-500/60 hover:text-blue-300"
                        >
                          {t("openPublic")}
                        </a>
                      )}
                    </div>
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

// ── 조회 헬퍼 (파일 하단 배치 — 페이지 본문 가독성 우선) ──
import { prisma } from "@/lib/prisma";

async function prismaList(status?: SeoArticleStatus, category?: SeoArticleCategory) {
  return prisma.seoArticle.findMany({
    where: { ...(status ? { status } : {}), ...(category ? { category } : {}) },
    orderBy: { createdAt: "desc" },
    take: 20, // 서버 페이지네이션 기본(목록 기본 10 규칙보다 완화 — 승인 큐는 한눈에 보는 용도)
    select: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      bodyJson: true,
      category: true, // 접힌 카드 헤더의 카테고리 배지
      // 접힌 카드 헤더의 썸네일 — 텍스트 썸네일(thumbnailUrl) 우선, 없으면 커버 사진
      thumbnailUrl: true,
      coverPhotoUrl: true,
      status: true,
      publicHidden: true,
      flaggedTerms: true,
      rejectionReason: true,
      createdAt: true,
      publishedAt: true,
    },
  });
}

// 상태·카테고리 조합 건수 — 둘 다 옵션(미지정 = 해당 축 필터 없음).
async function countWhere(status?: SeoArticleStatus, category?: SeoArticleCategory) {
  return prisma.seoArticle.count({
    where: { ...(status ? { status } : {}), ...(category ? { category } : {}) },
  });
}
