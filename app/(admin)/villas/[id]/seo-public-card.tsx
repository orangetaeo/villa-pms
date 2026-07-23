// 빌라 공개 노출(SEO) 카드 — T-seo-s2 앞부분 (운영자 다크, ko)
//
// RSC + 서버 액션만 사용한다(클라이언트 컴포넌트 없음) — 새 admin 클라이언트 NS를 만들지 않아
// ADMIN_CLIENT_NAMESPACES 누락 함정을 피하고, 폼 제출이라 상태 동기화 버그 여지도 없다.
//
// 공개 조건 4가지를 체크리스트로 보여주고, 미충족이면 켜기 버튼을 비활성화한다.
// (서버 액션이 최종 판단하지만, 왜 못 켜는지 화면에서 바로 알 수 있어야 한다)
import { getTranslations } from "next-intl/server";
import CollapsibleCard from "@/components/admin/collapsible-card";
import { blogPaths } from "@/lib/seo/routes";
import { MIN_PUBLIC_PHOTOS, MIN_PUBLIC_BODY_CHARS } from "@/lib/seo/public-villa";
import { evaluatePrep } from "@/lib/seo/villa-prep";
import { issuePublicSlug, generateDescription, togglePublicListed } from "./seo-public-actions";

export interface SeoPublicCardProps {
  villaId: string;
  status: string;
  isSellable: boolean;
  publicSlug: string | null;
  publicListed: boolean;
  description: string | null;
  photoCount: number;
}

export default async function SeoPublicCard(p: SeoPublicCardProps) {
  const t = await getTranslations("adminVillaSeo");
  const descLen = (p.description ?? "").trim().length;
  const prep = evaluatePrep({
    status: p.status,
    isSellable: p.isSellable,
    publicSlug: p.publicSlug,
    description: p.description,
    photoCount: p.photoCount,
  });

  const checks: { ok: boolean; label: string }[] = [
    { ok: prep.activeSellable, label: t("checks.sellable") },
    { ok: prep.enoughPhotos, label: t("checks.photos", { n: p.photoCount, min: MIN_PUBLIC_PHOTOS }) },
    { ok: prep.hasDescription, label: t("checks.description", { n: descLen, min: MIN_PUBLIC_BODY_CHARS }) },
    { ok: prep.hasSlug, label: t("checks.slug") },
  ];

  return (
    // 다른 상세 섹션과 동일하게 접기/펴기(기본 접힘). 공개 여부 배지는 접힌 상태에서도 보이게 헤더에 둔다.
    <CollapsibleCard
      title={t("title")}
      icon="public"
      headerMeta={
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
            p.publicListed ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"
          }`}
        >
          {p.publicListed ? t("state.on") : t("state.off")}
        </span>
      }
    >
      <p className="text-xs leading-relaxed text-slate-400">{t("desc")}</p>

      <ul className="mt-4 space-y-1.5 text-sm">
        {checks.map((c, i) => (
          <li key={i} className={c.ok ? "text-slate-300" : "text-amber-300"}>
            {c.ok ? "✓" : "✗"} {c.label}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!p.publicSlug && (
          <form action={issuePublicSlug}>
            <input type="hidden" name="villaId" value={p.villaId} />
            <button className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200">
              {t("actions.issueSlug")}
            </button>
          </form>
        )}
        {descLen === 0 && (
          <form action={generateDescription}>
            <input type="hidden" name="villaId" value={p.villaId} />
            <button className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200">
              {t("actions.generateDescription")}
            </button>
          </form>
        )}
        <form action={togglePublicListed}>
          <input type="hidden" name="villaId" value={p.villaId} />
          <input type="hidden" name="next" value={p.publicListed ? "0" : "1"} />
          <button
            disabled={!p.publicListed && !prep.eligible}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              p.publicListed
                ? "border border-slate-700 text-slate-300"
                : prep.eligible
                  ? "bg-blue-500 text-white"
                  : "cursor-not-allowed bg-slate-800 text-slate-500"
            }`}
          >
            {p.publicListed ? t("actions.unpublish") : t("actions.publish")}
          </button>
        </form>
        {p.publicListed && p.publicSlug && (
          <a
            href={blogPaths.villa(p.publicSlug)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-blue-400"
          >
            {t("actions.openPublic")}
          </a>
        )}
      </div>

      {descLen > 0 && descLen < MIN_PUBLIC_BODY_CHARS && (
        <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-300">
          {t("shortDescriptionWarning", { n: descLen, min: MIN_PUBLIC_BODY_CHARS })}
        </p>
      )}
    </CollapsibleCard>
  );
}
