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
import { parsePageParams } from "@/lib/pagination";

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
  title: "Dọn dẹp — Villa PMS",
};

export default async function CleaningListPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; page?: string; pageSize?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { role, id: userId } = session.user;
  if (role !== "SUPPLIER" && role !== "CLEANER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "cleaning" });
  const params = await searchParams;
  const { submitted } = params;
  const { page, pageSize, skip, take } = parsePageParams(params);

  const scope: Prisma.CleaningTaskWhereInput =
    role === "SUPPLIER" ? { villa: { supplierId: userId } } : { assigneeId: userId };

  const tasks = await prisma.cleaningTask.findMany({
    where: scope,
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
  // 페이지네이션 — 미결 우선 정렬을 보존하기 위해 정렬 후 메모리 슬라이스(take:200 캡 내)
  const totalTasks = sorted.length;
  const pagedTasks = sorted.slice(skip, skip + take);

  const todayLabel = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "vi-VN", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());

  return (
    <>
      {/* TopAppBar (a8) */}
      <header className="sticky top-0 z-40 flex h-16 w-full items-center bg-white px-4 shadow-sm">
        <h1 className="text-xl font-semibold text-teal-600">{t("title")}</h1>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pt-4">
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

        {sorted.length === 0 ? (
          // 빈 상태 — 체크아웃 후 자동 생성 안내
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
            <span className="material-symbols-outlined text-5xl text-teal-600">
              cleaning_services
            </span>
            <p className="text-sm font-bold text-neutral-700">{t("empty")}</p>
            <p className="text-sm text-neutral-500">{t("emptyHint")}</p>
          </div>
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
                      {task.villa.name}
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

        {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(라이트) */}
        <PaginationBar total={totalTasks} page={page} pageSize={pageSize} light />
      </main>
    </>
  );
}
