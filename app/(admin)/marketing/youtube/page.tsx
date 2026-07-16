// /marketing/youtube — 유튜브 쇼츠 승인 큐 + 설정 패널 (운영자 다크, ko)
// RSC: 인증 게이트 + 탭(searchParams 클론 패턴) + 설정 패널·큐(클라이언트, BE API 소비).
//   목록·편집·승인/반려는 /api/youtube/* 을 클라이언트가 직접 소비(서버 페이지네이션 10).
//   ★ 재고/마진 누수 표면 없음 — YoutubeShort 모델·직렬화에 원가·판매가·시크릿 필드 자체가 부재.
//   OAuth 복귀(?connected=1 / ?error=코드)는 큐가 토스트로 안내, 설정 패널 자동 펼침.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { YtShortStatus } from "@prisma/client";
import { auth } from "@/auth";
import { isOperator, isSystemAdmin } from "@/lib/permissions";
import YoutubeSettingsPanel from "./youtube-settings";
import YoutubeQueue from "./youtube-queue";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("youtube")} — Villa Go` };
}

// 목록은 클라이언트가 매 진입 조회 — RSC 캐시 금지(탭 전환·페이지 이동 즉시 반영).
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<string>(Object.values(YtShortStatus));

// 탭 ↔ 대표 status. failed 탭은 FAILED 기본, 보조 칩으로 CANCELLED 전환(둘 다 단일 status 서버 조회).
const TABS: { key: string; status?: string }[] = [
  { key: "pending", status: YtShortStatus.PENDING_APPROVAL },
  { key: "queued", status: YtShortStatus.QUEUED },
  { key: "published", status: YtShortStatus.PUBLISHED },
  { key: "failed", status: YtShortStatus.FAILED },
  { key: "all", status: undefined },
];
const FAILED_CHIPS = [YtShortStatus.FAILED, YtShortStatus.CANCELLED] as const;

function activeTabKey(status?: string): string {
  if (status === YtShortStatus.PENDING_APPROVAL) return "pending";
  if (status === YtShortStatus.QUEUED) return "queued";
  if (status === YtShortStatus.PUBLISHED) return "published";
  if (status === YtShortStatus.FAILED || status === YtShortStatus.CANCELLED) return "failed";
  return "all";
}

export default async function YoutubeMarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; connected?: string; error?: string }>;
}) {
  // 페이지 게이트(레이아웃 isOperator 위 2차 방어) — 비운영자는 /login 바운스.
  const session = await auth();
  if (!session?.user?.id || !isOperator(session.user.role)) {
    redirect("/login");
  }
  const canEditSettings = isSystemAdmin(session.user.role);

  const t = await getTranslations("adminYoutube");
  const params = await searchParams;
  const status =
    params.status && VALID_STATUSES.has(params.status) ? params.status : undefined;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const activeKey = activeTabKey(status);

  // OAuth 복귀 결과 — 큐 토스트용(성공/에러코드). 설정 패널도 자동 펼침.
  const oauth: { kind: "ok" | "err"; code?: string } | null = params.connected
    ? { kind: "ok" }
    : params.error
      ? { kind: "err", code: params.error }
      : null;

  // 탭·칩 링크 — 기존 searchParams 를 전부 복제 후 status 만 조정, page 는 1로 리셋(제외).
  //   connected/error(일회성 토스트 파라미터)도 링크에서 제외.
  const hrefFor = (nextStatus?: string) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      if (k === "status" || k === "page" || k === "connected" || k === "error") continue;
      next.set(k, v);
    }
    if (nextStatus) next.set("status", nextStatus);
    const qs = next.toString();
    return qs ? `/marketing/youtube?${qs}` : "/marketing/youtube";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t("title")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          {/* 인스타그램 화면 상호 이동 */}
          <Link
            href="/marketing/instagram"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800"
          >
            <span className="material-symbols-outlined text-[16px]">photo_camera</span>
            {t("linkToInstagram")}
          </Link>
          <nav className="hidden sm:flex text-xs text-slate-500 gap-2 whitespace-nowrap">
            <span>{t("breadcrumbAdmin")}</span>
            <span>/</span>
            <span>{t("breadcrumbMarketing")}</span>
            <span>/</span>
            <span className="text-slate-300">{t("breadcrumbCurrent")}</span>
          </nav>
        </div>
      </div>

      {/* 연동 설정(접이식) — GET=운영자, PUT=OWNER/ADMIN. OAuth 복귀 시 자동 펼침. */}
      <YoutubeSettingsPanel canEdit={canEditSettings} defaultOpen={oauth != null} />

      {/* 상태 탭 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800">
        {TABS.map((tab) => {
          const active = activeKey === tab.key;
          return (
            <Link
              key={tab.key}
              href={hrefFor(tab.status)}
              aria-current={active ? "page" : undefined}
              className={
                "-mb-px inline-flex items-center rounded-t-lg px-4 py-2.5 text-sm font-bold transition-colors " +
                (active
                  ? "border-b-2 border-admin-primary text-admin-primary"
                  : "border-b-2 border-transparent text-slate-400 hover:text-slate-200")
              }
            >
              {t(`tabs.${tab.key}`)}
            </Link>
          );
        })}
      </div>

      {/* 실패·취소 탭 보조 칩 — 단일 status 서버 조회 유지(페이지네이션 정확) */}
      {activeKey === "failed" && (
        <div className="flex items-center gap-2">
          {FAILED_CHIPS.map((s) => {
            const active =
              status === s || (s === YtShortStatus.FAILED && status !== YtShortStatus.CANCELLED);
            return (
              <Link
                key={s}
                href={hrefFor(s)}
                aria-current={active ? "page" : undefined}
                className={
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold transition-colors " +
                  (active
                    ? "border-admin-primary bg-admin-primary/10 text-admin-primary"
                    : "border-slate-700 text-slate-400 hover:text-slate-200")
                }
              >
                {t(`failedChip.${s}`)}
              </Link>
            );
          })}
        </div>
      )}

      {/* 콘텐츠 큐(클라이언트) — status/page prop 변경 시 재조회 */}
      <YoutubeQueue status={status ?? null} page={page} oauth={oauth} />
    </div>
  );
}
