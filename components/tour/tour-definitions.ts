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
  return { next: t("next"), back: t("back"), skip: t("skip"), done: t("done") };
}
