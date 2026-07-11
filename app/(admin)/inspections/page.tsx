// /inspections — 운영자 청소 검수 목록·승인 (T3.4, Stitch b6-inspections 변환)
// RSC: prisma 직접 조회 (T1.5 패턴 — 신규 API 표면 0). 승인/반려 액션만 기존 BE API 소비.
// leak-checklist: select 화이트리스트 — booking·고객명·금액·assignee 미포함 (구조적 보장)
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isOperator } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { VillaStatus, type CleaningStatus, type Prisma } from "@prisma/client";
import { quickRangeWhere } from "@/lib/date-vn";
import { parsePageParams } from "@/lib/pagination";
import InspectionsView, {
  type BaselinePhoto,
  type SelectedTask,
  type TaskListItem,
} from "./inspections-view";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("inspections")} — Villa Go` };
}

// 우선순위 JS 정렬을 위해 상한 200까지 적재 후 그 안에서 page/pageSize 분할 (정렬 보존)
const TAKE = 200;

// 탭 키 ↔ CleaningStatus 매핑 (승인 대기를 전체 다음에 배치 — b6 "pending approval on top")
const TAB_STATUS: Record<string, CleaningStatus | undefined> = {
  all: undefined,
  submitted: "PHOTOS_SUBMITTED",
  pending: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
};

// 승인 대기 우선 정렬 순위 (Prisma enum 순서와 다르므로 JS 정렬)
const STATUS_RANK: Record<CleaningStatus, number> = {
  PHOTOS_SUBMITTED: 0,
  PENDING: 1,
  REJECTED: 2,
  APPROVED: 3,
};

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    task?: string;
    range?: string;
    area?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  // 운영자(OWNER/MANAGER/STAFF) 가드 — 검수는 STAFF 업무(ADR-0013). layout과 이중화.
  const session = await auth();
  if (!session || !isOperator(session.user?.role)) redirect("/login");

  const params = await searchParams;
  const tab = params.status && params.status in TAB_STATUS ? params.status : "all";
  const statusFilter = TAB_STATUS[tab];
  const area = params.area?.trim() || undefined;
  // 빠른 날짜 필터 — createdAt(검수 태스크 생성 시각, 정렬 기준) 기준. "all"/무효 → undefined
  const createdAtRange = quickRangeWhere(params.range, "timestamp");

  // 날짜·지역(단지명 complex) 공통 필터 — 탭 카운트도 같은 범위에서 집계
  const scopeWhere: Prisma.CleaningTaskWhereInput = {
    ...(createdAtRange ? { createdAt: createdAtRange } : {}),
    ...(area ? { villa: { is: { complex: area } } } : {}),
  };

  const [rows, statusCounts, complexRows] = await Promise.all([
    prisma.cleaningTask.findMany({
      where: {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...scopeWhere,
      },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      // 화이트리스트 select — booking(고객명·금액)·assignee 절대 미포함
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
        villa: { select: { name: true, complex: true } },
      },
    }),
    prisma.cleaningTask.groupBy({
      by: ["status"],
      _count: { _all: true },
      // 탭 카운트도 날짜·지역 필터와 일관되게 — 범위 밖 태스크는 어느 탭에도 세지 않음
      where: scopeWhere,
    }),
    // 지역(area) 옵션 = 운영 대상 빌라의 단지명(complex) distinct (공실 보드 패턴 준용)
    prisma.villa.findMany({
      where: {
        status: { in: [VillaStatus.ACTIVE, VillaStatus.INACTIVE] },
        complex: { not: null },
      },
      distinct: ["complex"],
      orderBy: { complex: "asc" },
      select: { complex: true },
    }),
  ]);

  const areaOptions = complexRows
    .map((r) => r.complex)
    .filter((c): c is string => !!c);

  // 개별 재배정 드롭다운용 CLEANER 목록(미삭제) — 운영자 전용 화면
  const cleaners = await prisma.user.findMany({
    where: { role: "CLEANER", deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // 승인 대기(PHOTOS_SUBMITTED) 우선 + 최신순
  rows.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );

  const countOf = (s: CleaningStatus) =>
    statusCounts.find((c) => c.status === s)?._count._all ?? 0;
  const counts = {
    all: statusCounts.reduce((sum, c) => sum + c._count._all, 0),
    submitted: countOf("PHOTOS_SUBMITTED"),
    pending: countOf("PENDING"),
    approved: countOf("APPROVED"),
    rejected: countOf("REJECTED"),
  };

  // 정렬된 전체(상한 200) 안에서 현재 페이지만 슬라이스 — 우선순위 정렬 보존
  const { page, pageSize, skip, take } = parsePageParams({
    page: params.page,
    pageSize: params.pageSize,
  });
  const pagedRows = rows.slice(skip, skip + take);

  const tasks: TaskListItem[] = pagedRows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    villaName: r.villa.name,
    complex: r.villa.complex,
  }));

  // 행 선택 — ?task= 쿼리 파라미터 (새로고침 시 선택 유지). 없으면 전역 첫 행 자동 선택 (b6).
  // 페이지 슬라이스가 아니라 정렬된 전체의 첫 행(rows[0])으로 고정 → 페이지 이동 시 우측 상세 불변
  // 현재 탭 목록 밖이어도 params.task를 그대로 신뢰 (QA D-2): 승인 대기 탭에서 승인하면
  // 태스크가 필터에서 빠지지만 선택·배너는 유지돼야 함 — 상세는 findUnique라 목록과 무관,
  // 무효 id면 아래 findUnique가 null을 반환해 placeholder 렌더로 안전
  const selectedId = params.task || rows[0]?.id;

  // 선택 태스크 상세 — 같은 빌라의 기준 사진(isBaseline) join. 역시 booking·금액 미포함
  let selected: SelectedTask | null = null;
  if (selectedId) {
    const detail = await prisma.cleaningTask.findUnique({
      where: { id: selectedId },
      select: {
        id: true,
        type: true,
        status: true,
        photoUrls: true,
        photoSlots: true, // 제출 사진과 병렬 슬롯 id — 기준 사진 페어링 정렬용
        rejectNote: true,
        approvedAt: true,
        dueDate: true,
        createdAt: true,
        // 담당자 — 운영자 검수 화면에서 현재 담당 표시 + 개별 재배정용(운영 전용, 비운영자 미노출 규칙과 무관).
        assignee: { select: { id: true, name: true } },
        villa: {
          select: {
            name: true,
            complex: true,
            photos: {
              where: { isBaseline: true },
              orderBy: [{ space: "asc" }, { sortOrder: "asc" }],
              select: { id: true, space: true, spaceLabel: true, url: true },
            },
          },
        },
      },
    });
    if (detail) {
      const baselinePhotos: BaselinePhoto[] = detail.villa.photos.map((p) => ({
        id: p.id,
        space: p.space,
        spaceLabel: p.spaceLabel,
        url: p.url,
      }));
      selected = {
        id: detail.id,
        type: detail.type,
        status: detail.status,
        photoUrls: detail.photoUrls,
        photoSlots: detail.photoSlots,
        rejectNote: detail.rejectNote,
        approvedAt: detail.approvedAt?.toISOString() ?? null,
        dueDate: detail.dueDate?.toISOString() ?? null,
        createdAt: detail.createdAt.toISOString(),
        assigneeId: detail.assignee?.id ?? null,
        assigneeName: detail.assignee?.name ?? null,
        villaName: detail.villa.name,
        complex: detail.villa.complex,
        baselinePhotos,
      };
    }
  }

  // 코치마크 문구 — RSC 번역 → props (ADMIN_CLIENT_NAMESPACES 무변경)
  const tTour = await getTranslations("tour");
  // 사진 확대 라이트박스 라벨 — 공용 photoLightbox 네임스페이스에서 로케일에 맞게 주입(한글 폴백 방지)
  const tLightbox = await getTranslations("photoLightbox");

  return (
    <>
      {/* key=선택 태스크 id — 태스크 전환 시 클라 상태(반려 사유·메시지) 리마운트 초기화 (QA D-1:
          미초기화 시 직전 태스크의 반려 사유가 다른 태스크에 제출될 수 있음) */}
      <InspectionsView
        key={selected?.id ?? "none"}
        tasks={tasks}
        selected={selected}
        // 모바일 마스터-디테일: 첫 태스크 자동선택(데스크톱용)과 구분해, ?task= 명시 시에만 상세 표시
        taskSelected={!!params.task}
        tab={tab}
        counts={counts}
        area={area}
        areaOptions={areaOptions}
        cleaners={cleaners}
        pagination={{ total: rows.length, page, pageSize }}
        lightboxLabels={{
          close: tLightbox("close"),
          prev: tLightbox("prev"),
          next: tLightbox("next"),
        }}
      />
      {/* 코치마크 투어 — InspectionsView 밖(형제)이라 key 리마운트와 무관. 첫 진입 자동 1회 */}
      <CoachMark
        tourId="adminInspections"
        steps={buildTourSteps(tTour, "adminInspections")}
        labels={buildTourLabels(tTour)}
      />
    </>
  );
}
