// /marketing/instagram — 인스타그램 콘텐츠 큐 (운영자 다크, ko)
// RSC: 인증 게이트 + 탭(searchParams 클론 패턴) + 설정 패널·큐(클라이언트, BE API 소비).
//   목록·편집·승인/반려는 /api/instagram/* 을 클라이언트가 직접 소비(서버 페이지네이션 10).
//   ★ 재고/마진 누수 표면 없음 — InstagramPost 모델·직렬화에 원가·판매가 필드 자체가 부재.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { IgPostStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isSystemAdmin } from "@/lib/permissions";
import { userCanSeeMarketing } from "@/lib/marketing-access";
import InstagramSettingsPanel from "./instagram-settings";
import InstagramQueue from "./instagram-queue";
import InstagramInsights from "./instagram-insights";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("instagram")} — Villa Go` };
}

// 목록은 클라이언트가 매 진입 조회 — RSC 캐시 금지(탭 전환·페이지 이동 즉시 반영).
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<string>(Object.values(IgPostStatus));

// 탭 ↔ 대표 status. failed 탭은 FAILED 기본, 보조 칩으로 CANCELLED 전환(둘 다 단일 status 서버 조회).
const TABS: { key: string; status?: string }[] = [
  { key: "pending", status: IgPostStatus.PENDING_APPROVAL },
  { key: "queued", status: IgPostStatus.QUEUED },
  { key: "published", status: IgPostStatus.PUBLISHED },
  { key: "failed", status: IgPostStatus.FAILED },
  { key: "all", status: undefined },
];
const FAILED_CHIPS = [IgPostStatus.FAILED, IgPostStatus.CANCELLED] as const;

function activeTabKey(status?: string): string {
  if (status === IgPostStatus.PENDING_APPROVAL) return "pending";
  if (status === IgPostStatus.QUEUED) return "queued";
  if (status === IgPostStatus.PUBLISHED) return "published";
  if (status === IgPostStatus.FAILED || status === IgPostStatus.CANCELLED) return "failed";
  return "all";
}

export default async function InstagramMarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  // 페이지 게이트 — 마케팅은 특정 계정(테오 phone) 전용. 그 외 계정은 /login 바운스.
  const session = await auth();
  if (!session?.user?.id || !(await userCanSeeMarketing(session.user.id))) {
    redirect("/login");
  }
  const canEditSettings = isSystemAdmin(session.user.role);

  const t = await getTranslations("adminInstagram");
  const params = await searchParams;
  const status =
    params.status && VALID_STATUSES.has(params.status) ? params.status : undefined;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const activeKey = activeTabKey(status);

  // DM 인박스 미읽음 총계(뱃지) — 미읽음 수신 메시지 수. 열람 시 서버가 읽음 처리 → 재방문 시 갱신.
  //   ★ 운영자 전용 화면이라 스코프 불요(전체 IG 계정 1개). 원가/판매가 개념 부재(누수 불가).
  const dmUnread = await prisma.instagramMessage.count({
    where: { direction: "IN", readByAdmin: false },
  });

  // 탭·칩 링크 — 기존 searchParams 를 전부 복제 후 status 만 조정, page 는 1로 리셋(제외).
  const hrefFor = (nextStatus?: string) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      if (k === "status" || k === "page") continue;
      next.set(k, v);
    }
    if (nextStatus) next.set("status", nextStatus);
    const qs = next.toString();
    return qs ? `/marketing/instagram?${qs}` : "/marketing/instagram";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t("title")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          {/* DM 인박스 진입 — 미읽음 총계 뱃지 */}
          <Link
            href="/marketing/instagram/dm"
            className="relative inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800"
          >
            <span className="material-symbols-outlined text-[16px]">forum</span>
            {t("dm.openInbox")}
            {dmUnread > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-fuchsia-500 px-1.5 text-[10px] font-bold tabular-nums text-white">
                {dmUnread > 99 ? "99+" : dmUnread}
              </span>
            )}
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

      {/* 연동 설정(접이식) — GET=운영자, PUT=OWNER/ADMIN */}
      <InstagramSettingsPanel canEdit={canEditSettings} />

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
              status === s || (s === IgPostStatus.FAILED && status !== IgPostStatus.CANCELLED);
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

      {/* 성과(인사이트) — 발행됨 탭 상단 요약 스트립 */}
      {activeKey === "published" && <InstagramInsights />}

      {/* 콘텐츠 큐(클라이언트) — status/page prop 변경 시 재조회 */}
      <InstagramQueue status={status ?? null} page={page} />
    </div>
  );
}
