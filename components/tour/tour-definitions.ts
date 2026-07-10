// 코치마크 투어 정의 (T-tutorial-onboarding) — 화면별 스텝·앵커·i18n 키의 단일 소스.
// ⚠️ 순수 모듈: "use client" 절대 금지 — 서버 컴포넌트가 이 상수를 spread하므로
//    client 지시자가 붙으면 RSC 참조 프록시로 바뀌어 런타임 500 [[rsc-client-module-const-spread-bug]].
//    (tests/tour-onboarding.test.ts가 "use client" 미포함을 강제한다)
//
// 유지보수 규칙(테오 확정): 투어가 걸린 화면(data-tour 앵커 보유)의 UI를 변경할 때는
// 이 파일의 스텝 정의와 messages/ko.json·vi.json의 tour 문구를 동시에 갱신한다.
// 앵커 요소가 화면에서 사라지면 해당 스텝은 자동 스킵되지만(깨짐 방지 안전장치),
// 스킵된 채 방치하면 안내 공백이 생기므로 QA 체크리스트에서 함께 점검한다.

/** localStorage 완료 기록 키 접두 — `villa-tour:<tourId>` = "1"(완주·건너뛰기 모두). */
export const TOUR_STORAGE_PREFIX = "villa-tour:";
/** "?" 재생 버튼 → 투어 강제 재생 CustomEvent 이름. detail = { tourId }. */
export const TOUR_REPLAY_EVENT = "villa-tour:replay";

export interface TourStepDef {
  /** 대상 요소의 data-tour 속성값 — 위치·순서가 아닌 표식 기반 연결(UI 변경 내성). */
  anchor: string;
  /** tour 네임스페이스 기준 i18n 키 — `tour.<key>.title` / `tour.<key>.desc`. */
  key: string;
}

// 화면당 3스텝 상한(UX-VN 확정 — 베트남 사용자 텍스트 최소화). route는 "?" 버튼의
// pathname 정확일치 매핑용(null = 페이지가 tourId를 명시 전달, 예: 청소 상세).
// CLEANER 미노출 통제는 messages 경계가 아니라 이 tourId→라우트 매핑 + 라우트 가드가 담당.
export const TOURS = {
  myVillas: {
    route: "/my-villas",
    steps: [
      { anchor: "villa-add", key: "myVillas.add" },
      { anchor: "villa-status", key: "myVillas.status" },
      { anchor: "tab-bar", key: "myVillas.tabs" },
    ],
  },
  calendar: {
    route: "/calendar",
    steps: [
      { anchor: "calendar-villa", key: "calendar.villa" },
      { anchor: "calendar-grid", key: "calendar.grid" },
      { anchor: "calendar-legend", key: "calendar.legend" },
    ],
  },
  cleaningList: {
    route: "/cleaning",
    steps: [
      { anchor: "cleaning-task", key: "cleaningList.task" },
      { anchor: "cleaning-filter", key: "cleaningList.filter" },
    ],
  },
  cleaningDetail: {
    route: null,
    steps: [
      { anchor: "cleaning-baseline", key: "cleaningDetail.baseline" },
      { anchor: "cleaning-slots", key: "cleaningDetail.slots" },
      { anchor: "cleaning-submit", key: "cleaningDetail.submit" },
    ],
  },
  // ── 2단계: PARTNER(ko 기본)·VENDOR(vi 기본) — T-tutorial-onboarding-2 ──
  partnerHome: {
    route: "/partner",
    steps: [
      { anchor: "partner-booking", key: "partnerHome.booking" },
      { anchor: "partner-bell", key: "partnerHome.bell" },
      { anchor: "partner-tab-bar", key: "partnerHome.tabs" },
    ],
  },
  partnerReceivables: {
    route: "/partner/receivables",
    steps: [
      { anchor: "partner-outstanding", key: "partnerReceivables.outstanding" },
      { anchor: "partner-invoices", key: "partnerReceivables.invoices" },
    ],
  },
  partnerProposals: {
    route: "/partner/proposals",
    steps: [
      { anchor: "partner-proposal", key: "partnerProposals.proposal" },
      { anchor: "partner-proposal-open", key: "partnerProposals.open" },
    ],
  },
  // ── 3단계: ADMIN(ko 기본·vi 지원) — T-tutorial-onboarding-3, 에픽 마지막 ──
  // admin-stats·admin-nav는 반응형 이중 앵커(데스크톱/모바일 각 1벌, 가시 쪽 자동 선택).
  // admin-bell은 사이드바 푸터 — 모바일에선 드로어 안(비가시)이라 자동 스킵(데스크톱 3스텝/모바일 2스텝).
  adminDashboard: {
    route: "/dashboard",
    steps: [
      { anchor: "admin-stats", key: "adminDashboard.stats" },
      { anchor: "admin-nav", key: "adminDashboard.nav" },
      { anchor: "admin-bell", key: "adminDashboard.bell" },
    ],
  },
  // ── 관리자 운영 화면 확장(T-tutorial-onboarding-5) — 미래 직원 온보딩용 핵심 사이클 4종.
  //    /messages는 제외(FE 회의: 실시간 재정렬·대화 선택 후에만 렌더되는 UI라 앵커 불안정).
  adminBookings: {
    route: "/bookings",
    steps: [
      { anchor: "bookings-status", key: "adminBookings.status" },
      // T-7: 검색·필터 스텝 제거(테오 — "누가 검색을 몰라") → 체크인 시트 출력(화면 고유 기능)으로 교체
      { anchor: "bookings-sheet", key: "adminBookings.sheet" },
      { anchor: "bookings-list", key: "adminBookings.list" },
    ],
  },
  adminVillas: {
    route: "/villas",
    steps: [
      { anchor: "villas-tabs", key: "adminVillas.tabs" },
      // 이중앵커 — 모바일/데스크톱 등록 버튼 2벌, 가시 쪽 자동 선택
      { anchor: "villas-new", key: "adminVillas.new" },
      // 첫 카드 index 0 조건부 — 빈 목록이면 자동 스킵
      { anchor: "villas-row", key: "adminVillas.row" },
    ],
  },
  // 제안 목록 행은 클라 fetch 비동기 → 앵커 금지(vendorBoard 교훈). 즉시 렌더 정적 요소만.
  // T-7: filters 스텝 제거(범용 검색 안내 금지)
  adminProposals: {
    route: "/proposals",
    steps: [
      { anchor: "proposal-create", key: "adminProposals.create" },
      { anchor: "proposal-tabs", key: "adminProposals.tabs" },
    ],
  },
  // 모바일은 마스터-디테일이라 queue/actions가 상황 따라 비가시 → 자동 스킵(2스텝)
  adminInspections: {
    route: "/inspections",
    steps: [
      { anchor: "inspections-tabs", key: "adminInspections.tabs" },
      { anchor: "inspections-queue", key: "adminInspections.queue" },
      { anchor: "inspections-actions", key: "adminInspections.actions" },
    ],
  },
  // ── 전수 확장(T-tutorial-onboarding-6) — 관리자 10종 + 포털 3종 (FE·UX-VN 회의 확정).
  //    /cost-alerts·/activity·/zalo-connect·프로필류는 제외(열람 전용·화면 자체가 안내·단일 폼).
  adminAvailability: {
    route: "/availability",
    steps: [
      { anchor: "avail-filters", key: "adminAvailability.filters" },
      { anchor: "avail-legend", key: "adminAvailability.legend" },
      { anchor: "avail-grid", key: "adminAvailability.grid" },
    ],
  },
  adminSettlements: {
    route: "/settlements",
    steps: [
      { anchor: "settle-month", key: "adminSettlements.month" },
      { anchor: "settle-summary", key: "adminSettlements.summary" },
      { anchor: "settle-finance", key: "adminSettlements.finance" },
    ],
  },
  adminReceivables: {
    route: "/receivables",
    steps: [
      { anchor: "recv-kpi", key: "adminReceivables.kpi" },
      { anchor: "recv-aging", key: "adminReceivables.aging" },
      { anchor: "recv-partners", key: "adminReceivables.partners" },
    ],
  },
  // T-7: filters 스텝 제거(범용 검색 안내 금지) — 고유 업무(묶음 입금·중계현황)는 summary/tabs가 커버
  adminServiceOrders: {
    route: "/service-orders",
    steps: [
      { anchor: "sorders-summary", key: "adminServiceOrders.summary" },
      { anchor: "sorders-tabs", key: "adminServiceOrders.tabs" },
    ],
  },
  adminRevenue: {
    route: "/revenue",
    steps: [
      { anchor: "revenue-filters", key: "adminRevenue.filters" },
      { anchor: "revenue-summary", key: "adminRevenue.summary" },
      { anchor: "revenue-export", key: "adminRevenue.export" },
    ],
  },
  adminStatistics: {
    route: "/statistics",
    steps: [
      { anchor: "stats-tabs", key: "adminStatistics.tabs" },
      { anchor: "stats-period", key: "adminStatistics.period" },
    ],
  },
  adminInventory: {
    route: "/inventory",
    steps: [
      { anchor: "inv-stock", key: "adminInventory.stock" },
      { anchor: "inv-inbound", key: "adminInventory.inbound" },
    ],
  },
  adminUsers: {
    route: "/users",
    steps: [
      { anchor: "users-add", key: "adminUsers.add" },
      { anchor: "users-filters", key: "adminUsers.filters" },
      { anchor: "users-list", key: "adminUsers.list" },
    ],
  },
  adminPartners: {
    route: "/partners",
    steps: [
      { anchor: "partners-new", key: "adminPartners.new" },
      { anchor: "partners-list", key: "adminPartners.list" },
    ],
  },
  adminSettings: {
    route: "/settings",
    steps: [
      { anchor: "settings-season", key: "adminSettings.season" },
      { anchor: "settings-hold", key: "adminSettings.hold" },
      { anchor: "settings-sub", key: "adminSettings.sub" },
    ],
  },
  // 빌라 상세(/villas/[id]) — route 동적: 페이지 명시 tourId(cleaningDetail 선례). 테오 7기능 커버(T-7).
  // 탭 콘텐츠는 탭 전환 시 언마운트 → 앵커는 항상 렌더되는 헤더·탭 바·펼치기 버튼만.
  // vdetail-tab-overview 2회는 의도(같은 탭의 두 주제: 요금/청소 — 인접 스텝이라 하이라이트 고정 채 문구만 진행).
  villaDetail: {
    route: null,
    steps: [
      { anchor: "vdetail-title", key: "villaDetail.header" },
      { anchor: "vdetail-tab-overview", key: "villaDetail.rates" },
      { anchor: "vdetail-tab-overview", key: "villaDetail.cleaning" },
      { anchor: "vdetail-expand", key: "villaDetail.supplies" },
      { anchor: "vdetail-tab-sales", key: "villaDetail.sales" },
    ],
  },
  // 예약 상세(/bookings/[id]) — route 동적: 페이지 명시 tourId(villaDetail 선례). 운영 사이클
  // (수납→확정→체크인/아웃) 중심. actions~services는 살아있는 예약에서만 렌더 → 종결 예약은 자동 스킵.
  bookingDetail: {
    route: null,
    steps: [
      { anchor: "bdetail-header", key: "bookingDetail.header" },
      { anchor: "bdetail-payments", key: "bookingDetail.payments" },
      { anchor: "bdetail-actions", key: "bookingDetail.actions" },
      { anchor: "bdetail-guest-token", key: "bookingDetail.guestToken" },
      { anchor: "bdetail-roster", key: "bookingDetail.roster" },
      { anchor: "bdetail-services", key: "bookingDetail.services" },
    ],
  },
  // 파트너 상세(/partners/[id]) — route 동적. B2B 여신·미수 업무 규칙 중심.
  // 편집 모드에서는 헤더 외 자동 스킵(첫 진입은 항상 overview·비편집이라 5스텝 전부 재생).
  partnerDetail: {
    route: null,
    steps: [
      { anchor: "pdetail-header", key: "partnerDetail.header" },
      { anchor: "pdetail-tabs", key: "partnerDetail.tabs" },
      { anchor: "pdetail-aging", key: "partnerDetail.aging" },
      { anchor: "pdetail-credit", key: "partnerDetail.credit" },
      { anchor: "pdetail-receivables", key: "partnerDetail.receivables" },
    ],
  },
  // 공급자 빌라 상세(/my-villas/[id]) — 5개 편집 진입 카드가 전부 무조건 렌더 → 앵커=카드 컨테이너.
  supplierVillaDetail: {
    route: null,
    steps: [
      { anchor: "svdetail-photos", key: "supplierVillaDetail.photos" },
      { anchor: "svdetail-amenities", key: "supplierVillaDetail.amenities" },
      { anchor: "svdetail-rates", key: "supplierVillaDetail.rates" },
      { anchor: "svdetail-sell-link", key: "supplierVillaDetail.sellLink" },
      { anchor: "svdetail-info", key: "supplierVillaDetail.info" },
    ],
  },
  // 파트너 예약 상세(/partner/bookings/[id]) — summary·roster 항상, services·change-request는
  // 서버 조건부("그 상태에서만 의미 있는 스텝" → 자동 스킵 규약, T-8 카브아웃).
  partnerBookingDetail: {
    route: null,
    steps: [
      { anchor: "pbdetail-summary", key: "partnerBookingDetail.summary" },
      { anchor: "pbdetail-services", key: "partnerBookingDetail.services" },
      { anchor: "pbdetail-change-request", key: "partnerBookingDetail.changeRequest" },
      { anchor: "pbdetail-roster", key: "partnerBookingDetail.roster" },
    ],
  },
  earnings: {
    route: "/earnings",
    steps: [
      { anchor: "earnings-tabs", key: "earnings.tabs" },
      { anchor: "earnings-period", key: "earnings.period" },
      { anchor: "earnings-kpi", key: "earnings.kpi" },
    ],
  },
  myBookings: {
    route: "/my-bookings",
    steps: [
      { anchor: "mybook-card", key: "myBookings.card" },
      { anchor: "mybook-action", key: "myBookings.action" },
    ],
  },
  vendorStats: {
    route: "/vendor/stats",
    steps: [
      { anchor: "vstats-period", key: "vendorStats.period" },
      { anchor: "vstats-kpi", key: "vendorStats.kpi" },
      { anchor: "vstats-settle", key: "vendorStats.settle" },
    ],
  },
  // 벤더 발주함 — 앵커는 즉시 렌더되는 탭 버튼 3개만(카드는 클라 fetch 비동기 → 앵커 금지).
  // 완료보고는 일정(schedule) 탭 UI에 있으므로 그 스텝 문구가 담당(FE·UX-VN 회의 확정).
  vendorBoard: {
    route: "/vendor",
    steps: [
      { anchor: "vendor-tab-inbox", key: "vendorBoard.inbox" },
      { anchor: "vendor-tab-schedule", key: "vendorBoard.schedule" },
      { anchor: "vendor-tab-settlement", key: "vendorBoard.settlement" },
    ],
  },
} as const satisfies Record<
  string,
  { route: string | null; steps: readonly TourStepDef[] }
>;

export type TourId = keyof typeof TOURS;

export function tourStorageKey(tourId: TourId): string {
  return `${TOUR_STORAGE_PREFIX}${tourId}`;
}

/** pathname 정확일치로 투어 찾기 — "?" 버튼(공용 헤더)용. 상세 경로는 명시 tourId 사용. */
export function tourIdForRoute(pathname: string): TourId | null {
  for (const [id, tour] of Object.entries(TOURS)) {
    if (tour.route !== null && tour.route === pathname) return id as TourId;
  }
  return null;
}

/**
 * rect 수평 가시 판정 (T-tutorial-onboarding-3) — 반응형 이중 렌더 대응.
 * 관리자처럼 같은 의미의 UI가 뷰포트별 두 벌(데스크톱 사이드바 vs 모바일 하단네비)일 때,
 * 같은 data-tour 값을 양쪽에 달고 "보이는 쪽"을 고르기 위한 순수 판정.
 * - width/height 0 = display:none(자신·조상) → 비가시
 * - right <= 0 = 모바일 드로어 -translate-x-full(경계값 right=0 포함) → 비가시
 * - left >= viewportW = 오른쪽 화면 밖 → 비가시
 * 수직은 스크롤로 데려올 수 있으므로 판정하지 않는다.
 * 한계: 가로 스크롤 컨테이너 안에서 밀려난 요소는 "논리적 가시"여도 비가시 판정(현 앵커엔 해당 없음).
 */
export function isRectHorizontallyVisible(
  rect: Pick<DOMRect, "width" | "height" | "left" | "right">,
  viewportW: number
): boolean {
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < viewportW;
}

/**
 * 앵커 존재 스텝만 추림 — 전 스텝 부재면 [](투어 미표시), 일부 부재면 존재분만(자동 스킵).
 * 순수 함수로 분리해 단위 테스트로 스킵 규칙을 강제한다.
 */
export function visibleTourSteps<T extends { anchor: string }>(
  steps: readonly T[],
  hasAnchor: (anchor: string) => boolean
): T[] {
  return steps.filter((s) => hasAnchor(s.anchor));
}

/** 번역된 스텝(클라이언트 props용). 문구는 RSC에서 번역해 전달 — 화이트리스트 비의존(cleaning-submit 패턴). */
export interface TourStep {
  anchor: string;
  title: string;
  desc: string;
}

export interface TourLabels {
  next: string;
  back: string;
  skip: string;
  done: string;
  /** 마지막 스텝 하단 "?" 발견성 안내 — 투어는 1회성이라 재생 경로를 알려줘야 함(T-tutorial-onboarding-4). */
  replayHint: string;
}

/** RSC에서 getTranslations({namespace:"tour"})의 t로 스텝 문구를 빌드. */
export function buildTourSteps(
  t: (key: string) => string,
  tourId: TourId
): TourStep[] {
  return TOURS[tourId].steps.map((s) => ({
    anchor: s.anchor,
    title: t(`${s.key}.title`),
    desc: t(`${s.key}.desc`),
  }));
}

export function buildTourLabels(t: (key: string) => string): TourLabels {
  return {
    next: t("next"),
    back: t("back"),
    skip: t("skip"),
    done: t("done"),
    replayHint: t("replayHint"),
  };
}
