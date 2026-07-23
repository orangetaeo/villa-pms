import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";

/**
 * 제안 링크 빌라 카드의 소개 영상 — 자동 발행된 유튜브 쇼츠 1건을 임베드한다.
 * ★ youtube-nocookie 도메인: 재생 전 추적 쿠키를 심지 않는 임베드(블로그 빌라 페이지와 동일 규칙).
 *   CSP frame-src에 이미 등록돼 있다(next.config.ts) — 다른 출처를 쓰면 즉시 차단된다.
 * ★ loading="lazy": 제안서는 빌라 2~3개가 한 화면이라 iframe을 즉시 로드하면 첫 화면이 무거워진다.
 */
export function VillaVideo({
  videoId,
  title,
  lang,
}: {
  videoId: string;
  title: string;
  lang: PublicLang;
}) {
  const t = PUBLIC_LABELS[lang];
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-teal-600 tracking-wider flex items-center gap-1">
        <span className="material-symbols-outlined text-[16px]">play_circle</span>
        {t.videoTitle}
      </p>
      <div className="relative aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-xl bg-neutral-100">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
          title={title}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
    </div>
  );
}
