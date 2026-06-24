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
import InspectionsView, {
  type BaselinePhoto,
  type SelectedTask,
  type TaskListItem,
} from "./inspections-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("inspections")} — Villa PMS` };
}

// 페이지네이션 범위 밖 (계약) — 상한 take 200
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
  searchParams: Promise<{ status?: string; task?: string; range?: string; area?: string }>;
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

  const tasks: TaskListItem[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    villaName: r.villa.name,
    complex: r.villa.complex,
  }));

  // 행 선택 — ?task= 쿼리 파라미터 (새로고침 시 선택 유지). 없으면 첫 행 자동 선택 (b6).
  // 현재 탭 목록 밖이어도 params.task를 그대로 신뢰 (QA D-2): 승인 대기 탭에서 승인하면
  // 태스크가 필터에서 빠지지만 선택·배너는 유지돼야 함 — 상세는 findUnique라 목록과 무관,
  // 무효 id면 아래 findUnique가 null을 반환해 placeholder 렌더로 안전
  const selectedId = params.task || tasks[0]?.id;

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
        rejectNote: true,
        approvedAt: true,
        dueDate: true,
        createdAt: true,
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
        rejectNote: detail.rejectNote,
        approvedAt: detail.approvedAt?.toISOString() ?? null,
        dueDate: detail.dueDate?.toISOString() ?? null,
        createdAt: detail.createdAt.toISOString(),
        villaName: detail.villa.name,
        complex: detail.villa.complex,
        baselinePhotos,
      };
    }
  }

  return (
    // key=선택 태스크 id — 태스크 전환 시 클라 상태(반려 사유·메시지) 리마운트 초기화 (QA D-1:
    // 미초기화 시 직전 태스크의 반려 사유가 다른 태스크에 제출될 수 있음)
    <InspectionsView
      key={selected?.id ?? "none"}
      tasks={tasks}
      selected={selected}
      // 모바일 마스터-디테일: 첫 태스크 자동선택(데스크톱용)과 구분해, ?task= 명시 시에만 상세 표시
      taskSelected={!!params.task}
      tab={tab}
      counts={counts}
      range={params.range}
      area={area}
      areaOptions={areaOptions}
    />
  );
}
