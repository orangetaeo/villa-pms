// SEO 관리 3화면 공통 탭 (T-seo-ux-fix)
//
// 왜 있는가: 화면마다 다른 링크를 흩뿌려 놓아 "지금 어디에 있는지"가 안 보였다(테오 지적 5).
// 한 줄 탭으로 통일하고, 현재 화면만 강조한다. 서버 컴포넌트 — 문구는 호출부가 넘긴다.
import Link from "next/link";

export type SeoTab = "queue" | "places" | "media";

const HREF: Record<SeoTab, string> = {
  queue: "/marketing/seo",
  places: "/marketing/seo/places",
  media: "/marketing/seo/media",
};

export default function SeoNav({
  current,
  labels,
}: {
  current: SeoTab;
  labels: Record<SeoTab, string>;
}) {
  return (
    <nav className="flex flex-wrap gap-1 rounded-xl bg-slate-900 p-1">
      {(Object.keys(HREF) as SeoTab[]).map((tab) => (
        <Link
          key={tab}
          href={HREF[tab]}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            tab === current ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {labels[tab]}
        </Link>
      ))}
    </nav>
  );
}
