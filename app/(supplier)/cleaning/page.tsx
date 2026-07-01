// 청소 태스크 목록 (T3.8, SPEC F4) — design/stitch/a8-cleaning-tasks 변환
// role 스코프: SUPPLIER=자기 빌라 / CLEANER=배정분 (T3.4 GET /api/cleaning-tasks와 동일 규칙)
// 재고·마진 비공개: booking은 checkOut 날짜만 select — 고객명·금액 RSC 직렬화 금지
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { CleaningStatus, Prisma } from "@prisma/client";
import PaginationBar from "@/components/pagination-bar";
import ListSearch from "@/components/list-search";
import { parsePageParams } from "@/lib/pagination";
import { formatVillaName, villaNameViOnly } from "@/lib/villa-name";

// a8 상태 배지 4종: Chờ dọn(주황) / Đã gửi(파랑) / Đã duyệt(초록) / Bị từ chối(빨강 외곽선)
const STATUS_BADGE: Record<CleaningStatus, string> = {
  PENDING: "bg-orange-100 text-orange-700",
  PHOTOS_SUBMITTED: "bg-blue-100 text-blue-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "border-2 border-red-500 bg-white text-red-600",
};

// 미결(청소 대기·반려) 우선 정렬 — 청소부가 지금 해야 할 일이 맨 위
const STATUS_RANK: Record<CleaningStatus, number> = {
  PENDING: 0,
  REJECTED: 0,
  PHOTOS_SUBMITTED: 1,
  APPROVED: 2,
};

/** "DD/MM" 표시 — @db.Date는 UTC 자정 그대로, 타임스탬프는 베트남 시간 기준 */
function formatDayMonth(date: Date, vnTz: boolean): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: vnTz ? "Asia/Ho_Chi_Minh" : "UTC",
  }).format(date);
}

export const metadata: Metadata = {
  title: "Dọn dẹp — Villa Go",
};

export default async function CleaningListPage({
  searchParams,
}: {
  searchParams: Promise<{
    submitted?: string;
    page?: string;
    pageSize?: string;
    q?: string;
    d?: string; // 날짜 필터: today | tomorrow | week | (없음=전체)
  }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { role, id: userId } = session.user;
  if (role !== "SUPPLIER" && role !== "CLEANER") redirect("/");

  // 청소직원은 베트남어 고정(한국어 미노출). 공급자는 기존 우선순위.
  const isCleaner = role === "CLEANER";
  const locale = isCleaner ? "vi" : await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "cleaning" });
  const params = await searchParams;
  const { submitted } = params;
  const { page, pageSize, skip, take } = parsePageParams(params);
  // 검색어(URL q 모드) — 빌라명(표시되는 name·nameVi). 기존 role 스코프 안에서만(누수 0).
  const q = params.q?.trim() || undefined;

  // role 스코프(supplierId/assigneeId) 유지 + q는 그 안에서만 검색
  const scope: Prisma.CleaningTaskWhereInput =
    role === "SUPPLIER" ? { villa: { supplierId: userId } } : { assigneeId: userId };
  const where: Prisma.CleaningTaskWhereInput = q
    ? {
        ...scope,
        villa: {
          ...(role === "SUPPLIER" ? { supplierId: userId } : {}),
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { nameVi: { contains: q, mode: "insensitive" } },
          ],
        },
      }
    : scope;

  const tasks = await prisma.cleaningTask.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      rejectNote: true,
      dueDate: true,
      createdAt: true,
      // checkOut 날짜만 — 고객명·금액 비전달 (leak-checklist)
      booking: { select: { checkOut: true } },
      villa: {
        select: {
          name: true,
          nameVi: true,
          // 기준 사진 1장 — 카드 썸네일
          photos: {
            where: { isBaseline: true },
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: { url: true },
          },
        },
      },
    },
  });
  const sorted = [...tasks].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]
  );

  // ── 날짜 필터 (바쁜 청소직원용 원탭 칩) — d=today|tomorrow|week, 없으면 전체 ──
  // 각 태스크 표시 기준일을 카드와 동일 규칙으로 산출(@db.Date=UTC일 그대로, 타임스탬프=VN일).
  const dParam =
    params.d === "today" || params.d === "tomorrow" || params.d === "week"
      ? params.d
      : "all";
  const vnDateStr = (date: Date, vnTz: boolean) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: vnTz ? "Asia/Ho_Chi_Minh" : "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  const addDaysStr = (ymd: string, n: number) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  };
  const todayStr = vnDateStr(new Date(), true);
  const tomorrowStr = addDaysStr(todayStr, 1);
  const weekEndStr = addDaysStr(todayStr, 6); // 오늘 포함 7일
  const withDate = sorted.map((task) => {
    const refDate = task.booking?.checkOut ?? task.dueDate ?? task.createdAt;
    const isTimestamp = !task.booking?.checkOut && !task.dueDate;
    return { task, dateStr: vnDateStr(refDate, isTimestamp) };
  });
  // 칩 건수 — 현재 검색(q) 스코프 내. 0건이어도 칩은 노출(청소직원이 "오늘 0건" 확인).
  const counts = {
    all: withDate.length,
    today: withDate.filter((x) => x.dateStr === todayStr).length,
    tomorrow: withDate.filter((x) => x.dateStr === tomorrowStr).length,
    week: withDate.filter((x) => x.dateStr >= todayStr && x.dateStr <= weekEndStr).length,
  } as const;
  const filtered = withDate
    .filter((x) =>
      dParam === "today"
        ? x.dateStr === todayStr
        : dParam === "tomorrow"
          ? x.dateStr === tomorrowStr
          : dParam === "week"
            ? x.dateStr >= todayStr && x.dateStr <= weekEndStr
            : true
    )
    .map((x) => x.task);

  // 날짜 필터 칩 링크 — q 보존, 페이지 리셋(d만 갱신). 전체는 d 제거.
  const chipHref = (bucket: "all" | "today" | "tomorrow" | "week") => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (bucket !== "all") sp.set("d", bucket);
    const qs = sp.toString();
    return qs ? `/cleaning?${qs}` : "/cleaning";
  };

  // 페이지네이션 — 미결 우선 정렬을 보존하기 위해 정렬 후 메모리 슬라이스(take:200 캡 내)
  const totalTasks = filtered.length;
  const pagedTasks = filtered.slice(skip, skip + take);

  const todayLabel = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "vi-VN", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());

  return (
    <>
      <main className="mx-auto w-full max-w-md px-4 pt-6">
        {/* 제목 — 공용 포털 헤더 아래 본문 헤딩(기존 a8 앱바를 헤딩으로 강등, 이중 헤더 방지) */}
        <h1 className="mb-4 text-2xl font-bold text-neutral-900">{t("title")}</h1>
        {/* 제출 성공 배너 — /cleaning/[id] 제출 후 복귀 시 */}
        {submitted === "1" && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3">
            <span className="material-symbols-outlined icon-fill text-green-600">
              check_circle
            </span>
            <p className="pt-0.5 text-sm font-medium text-green-800">
              {t("submittedBanner")}
            </p>
          </div>
        )}

        {/* 헤더 요약 (a8) */}
        <div className="mb-6">
          <p className="mb-1 text-sm font-medium text-gray-500">
            {t("today", { date: todayLabel })}
          </p>
          <h2 className="text-2xl font-bold text-gray-900">{t("listTitle")}</h2>
        </div>

        {/* 날짜 필터 칩 (원탭) — 전체·오늘·내일·이번주 + 건수. 바쁜 청소직원이 한 번에 조회. */}
        {(sorted.length > 0 || q || dParam !== "all") && (
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {(["all", "today", "tomorrow", "week"] as const).map((bucket) => {
              const active = dParam === bucket;
              return (
                <Link
                  key={bucket}
                  href={chipHref(bucket)}
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold transition-colors active:scale-95 ${
                    active
                      ? "bg-teal-600 text-white"
                      : "border border-neutral-200 bg-white text-neutral-600"
                  }`}
                >
                  {t(`dateFilter.${bucket}`)}
                  <span
                    className={`rounded-full px-1.5 text-xs tabular-nums ${
                      active ? "bg-white/25" : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {counts[bucket]}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {/* 검색 (URL q 모드, 라이트) — 빌라명. 검색 중이면 결과 0건이어도 입력 유지 */}
        {(sorted.length > 0 || q) && (
          <div className="mb-4">
            <ListSearch light placeholder={t("searchPlaceholder")} />
          </div>
        )}

        {filtered.length === 0 ? (
          sorted.length === 0 ? (
            // 빈 상태 — 청소 자체가 없음(체크아웃 후 자동 생성 안내)
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
              <span className="material-symbols-outlined text-5xl text-teal-600">
                cleaning_services
              </span>
              <p className="text-sm font-bold text-neutral-700">{t("empty")}</p>
              <p className="text-sm text-neutral-500">{t("emptyHint")}</p>
            </div>
          ) : (
            // 날짜 필터/검색 결과만 0건 — 칩은 위에 남아 다른 날짜로 전환 가능
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
              <span className="material-symbols-outlined text-4xl text-neutral-300">
                event_busy
              </span>
              <p className="text-sm font-medium text-neutral-500">{t("noForDate")}</p>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-4">
            {pagedTasks.map((task) => {
              const refDate = task.booking?.checkOut ?? task.dueDate ?? task.createdAt;
              const isTimestamp = !task.booking?.checkOut && !task.dueDate;
              const thumb = task.villa.photos[0]?.url;
              return (
                <Link
                  key={task.id}
                  href={`/cleaning/${task.id}`}
                  className="flex min-h-[112px] items-center rounded-xl border border-gray-100 bg-white p-3 shadow-sm transition-transform active:scale-[0.98]"
                >
                  {/* 빌라 썸네일 (기준 사진) */}
                  <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100">
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={task.villa.name}
                        fill
                        unoptimized
                        sizes="96px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-neutral-300">
                        <span className="material-symbols-outlined text-4xl">villa</span>
                      </div>
                    )}
                  </div>
                  <div className="ml-4 flex min-w-0 flex-grow flex-col justify-center">
                    <h3 className="truncate text-base font-bold leading-tight text-gray-900">
                      {isCleaner
                        ? villaNameViOnly({ name: task.villa.name, nameVi: task.villa.nameVi })
                        : formatVillaName({ name: task.villa.name, nameVi: task.villa.nameVi })}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {t("checkout", { date: formatDayMonth(refDate, isTimestamp) })}
                    </p>
                    {/* 반려 사유 한 줄 미리보기 */}
                    {task.status === "REJECTED" && task.rejectNote && (
                      <p className="mt-1 truncate text-xs text-red-600">{task.rejectNote}</p>
                    )}
                    <div className="mt-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[task.status]}`}
                      >
                        {t(`status.${task.status}`)}
                      </span>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-gray-400">
                    chevron_right
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(라이트). 필터 결과 기준. */}
        {filtered.length > 0 && (
          <PaginationBar total={totalTasks} page={page} pageSize={pageSize} light />
        )}
      </main>
    </>
  );
}
