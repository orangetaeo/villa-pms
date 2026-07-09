"use client";

// 코치마크 투어 (T-tutorial-onboarding) — 오버레이+하이라이트 구멍+말풍선. 외부 라이브러리 없음.
// 문구는 전부 RSC에서 번역해 props로 받는다(cleaning-submit 패턴) — layout 화이트리스트 비의존.
//
// 하드 요구(QA 확정 — 전부 실사고 이력):
//   1) 오버레이는 createPortal(document.body) — 헤더 backdrop-blur/transform 조상이
//      fixed를 가두는 함정 회피 [[portal-header-backdrop-blur-fixed-trap]]
//   2) z-[70] — 하단 탭바(z-50)·자체 앱바(z-50)·바텀시트(z-[60]) 위
//   3) 100vh 금지 — 뷰포트 높이는 visualViewport/innerHeight로 계산(모바일 툴바 겹침)
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
  TOUR_REPLAY_EVENT,
  isRectHorizontallyVisible,
  tourIdForRoute,
  tourStorageKey,
  visibleTourSteps,
  type TourId,
  type TourLabels,
  type TourStep,
} from "./tour-definitions";

/** 하이라이트 구멍 여백(px) — 대상 요소 주변 숨쉴 공간. */
const HOLE_PAD = 6;
/** 말풍선 폭 상한(px). 뷰포트가 좁으면 좌우 12px 여백으로 축소. */
const BUBBLE_MAX_W = 320;
/** 첫 진입 자동 시작 지연(ms) — 폰트·이미지 로드로 인한 레이아웃 이동 안정화. */
const AUTO_START_DELAY_MS = 400;

function readSeen(tourId: TourId): boolean {
  try {
    return localStorage.getItem(tourStorageKey(tourId)) !== null;
  } catch {
    return true; // 저장 불가 환경(사파리 프라이빗 등)이면 자동 표시 포기 — 재생 버튼은 동작
  }
}

function writeSeen(tourId: TourId) {
  try {
    localStorage.setItem(tourStorageKey(tourId), "1");
  } catch {
    // 기록 실패는 무해 — 다음 진입 시 다시 보일 뿐
  }
}

/**
 * 앵커 해석 — 같은 data-tour가 반응형 변형 2벌에 달릴 수 있어(관리자 사이드바/하단네비),
 * 전 매치 중 현재 뷰포트에서 "보이는" 첫 요소를 고른다 (T-tutorial-onboarding-3).
 * display:none·드로어 오프스크린은 rect 판정, visibility:hidden은 computedStyle로 배제.
 */
function anchorEl(anchor: string): HTMLElement | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`);
  for (const el of els) {
    if (!isRectHorizontallyVisible(el.getBoundingClientRect(), window.innerWidth)) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    return el;
  }
  return null;
}

export function CoachMark({
  tourId,
  steps,
  labels,
}: {
  tourId: TourId;
  steps: TourStep[];
  labels: TourLabels;
}) {
  // active = 시작 시점에 앵커가 실존하는 스텝만(부분 스킵). null = 미표시.
  const [active, setActive] = useState<TourStep[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [viewportH, setViewportH] = useState(0);

  const start = useCallback(
    (force: boolean) => {
      if (!force && readSeen(tourId)) return;
      const present = visibleTourSteps(steps, (a) => anchorEl(a) !== null);
      if (present.length === 0) return; // 전 앵커 부재 — 투어 자체 미표시(완료 기록도 안 함)
      setIdx(0);
      setActive(present);
    },
    [tourId, steps]
  );

  // 첫 진입 자동 시작 — 렌더 안정화 뒤 1회 (UX-VN 확정: 물어보지 않고 바로)
  useEffect(() => {
    const timer = window.setTimeout(() => start(false), AUTO_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [start]);

  // "?" 재생 버튼 — 완료 기록 무시하고 강제 재생
  useEffect(() => {
    function onReplay(e: Event) {
      if ((e as CustomEvent<{ tourId?: string }>).detail?.tourId === tourId) start(true);
    }
    window.addEventListener(TOUR_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, onReplay);
  }, [tourId, start]);

  // 현재 스텝 앵커 측정 — 스텝 진입 시 화면 중앙 스크롤 후 rect 추적(리사이즈·스크롤)
  const step = active?.[idx] ?? null;
  useEffect(() => {
    if (!step) return;
    const measure = () => {
      // 100vh 금지 — 모바일 주소창/툴바를 뺀 실제 가시 높이
      setViewportH(window.visualViewport?.height ?? window.innerHeight);
      // 매번 재해석 — 리사이즈/회전으로 반응형 변형(사이드바↔하단네비)이 바뀌면
      // 캡처해둔 옛 요소가 all-zero rect를 반환해 (0,0) 유령 구멍이 생긴다(FE 회의 결함 2)
      const el = anchorEl(step.anchor);
      setRect(el ? el.getBoundingClientRect() : null); // 진행 중 소멸 → 구멍 없이 말풍선만
    };
    anchorEl(step.anchor)?.scrollIntoView({ block: "center" });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [step]);

  // 완주·건너뛰기 = "봤다" 기록. 라우트 이탈(언마운트)은 기록하지 않음 → 재진입 시 재노출(계약 8).
  const finish = useCallback(() => {
    writeSeen(tourId);
    setActive(null);
  }, [tourId]);

  if (!active || !step) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 360;
  const vh = viewportH || 640;
  const bubbleW = Math.min(BUBBLE_MAX_W, vw - 24);

  // 말풍선 배치 — 대상 아래 우선, 화면 하단 55% 아래면 위쪽(높이 측정 없이 top/bottom 고정).
  // 키 큰 앵커(사이드바 nav 등)는 위·아래 모두 공간 부족 → 중앙 폴백(구멍 유지, FE 회의 결함 1).
  const BUBBLE_SPACE_MIN = 190; // 말풍선 예상 높이 + 여백 대략치
  const bubbleStyle: CSSProperties = { width: bubbleW };
  const centerBubble = () => {
    bubbleStyle.left = (vw - bubbleW) / 2;
    bubbleStyle.top = vh * 0.35;
  };
  if (rect) {
    bubbleStyle.left = Math.min(
      Math.max(rect.left + rect.width / 2 - bubbleW / 2, 12),
      vw - bubbleW - 12
    );
    if (rect.bottom < vh * 0.55) {
      bubbleStyle.top = rect.bottom + HOLE_PAD + 12;
    } else if (rect.top >= BUBBLE_SPACE_MIN) {
      bubbleStyle.bottom = vh - rect.top + HOLE_PAD + 12;
    } else {
      delete bubbleStyle.left; // 좌측 클램프 무효화 후 중앙 재배치
      centerBubble();
    }
  } else {
    // 앵커 소멸 — 중앙 표시
    centerBubble();
  }

  const isLast = idx === active.length - 1;

  return createPortal(
    // 오버레이 — 전면 차단(터치 스크롤 잠금 포함). 어둡기는 구멍 div의 box-shadow가 그린다.
    <div
      className="fixed inset-0 z-[70] touch-none"
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
    >
      {rect ? (
        // 하이라이트 구멍 — 주변만 어둡게(9999px box-shadow). 대상 z-index와 무관하게 뚫린다.
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl ring-2 ring-white/90 [box-shadow:0_0_0_9999px_rgba(15,23,42,0.62)]"
          style={{
            left: rect.left - HOLE_PAD,
            top: rect.top - HOLE_PAD,
            width: rect.width + HOLE_PAD * 2,
            height: rect.height + HOLE_PAD * 2,
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-slate-900/60" />
      )}

      {/* 말풍선 */}
      <div
        className="absolute rounded-2xl bg-white p-4 shadow-[0_10px_40px_rgba(0,0,0,0.25)]"
        style={bubbleStyle}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="text-base font-bold text-neutral-900">{step.title}</h3>
          <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-bold tabular-nums text-teal-700">
            {idx + 1}/{active.length}
          </span>
        </div>
        <p className="mb-4 text-sm leading-snug text-neutral-600">{step.desc}</p>
        {/* 마지막 스텝 — "?" 재생 경로 안내(투어는 1회성, 발견성 확보 — T-tutorial-onboarding-4) */}
        {isLast && (
          <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-teal-700">
            <span className="material-symbols-outlined text-sm" aria-hidden>
              help
            </span>
            {labels.replayHint}
          </p>
        )}
        <div className="flex items-center gap-2">
          {/* 건너뛰기 — 크게(반사적으로 눌러도 다시 볼 길은 "?" 버튼) */}
          <button
            type="button"
            onClick={finish}
            className="h-11 rounded-xl px-3 text-sm font-semibold text-neutral-400 active:scale-95"
          >
            {labels.skip}
          </button>
          <div className="flex-1" />
          {idx > 0 && (
            <button
              type="button"
              onClick={() => setIdx(idx - 1)}
              className="h-11 rounded-xl border border-neutral-200 px-4 text-sm font-bold text-neutral-600 active:scale-95"
            >
              {labels.back}
            </button>
          )}
          <button
            type="button"
            onClick={() => (isLast ? finish() : setIdx(idx + 1))}
            className="h-11 rounded-xl bg-teal-600 px-5 text-sm font-bold text-white shadow-sm active:scale-95"
          >
            {isLast ? labels.done : labels.next}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * "?" 투어 재생 버튼 — 완료 기록을 무시하고 해당 화면 투어를 처음부터 재생.
 * tourId 미지정 시 pathname 정확일치 매핑(공용 포털 헤더용) — 투어 없는 화면에선 렌더 안 함.
 */
export function TourHelpButton({
  tourId,
  label,
  className,
}: {
  tourId?: TourId;
  label: string;
  className?: string;
}) {
  const pathname = usePathname();
  const resolved = tourId ?? tourIdForRoute(pathname);
  if (!resolved) return null;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent(TOUR_REPLAY_EVENT, { detail: { tourId: resolved } })
        )
      }
      className={
        className ??
        // 공용 헤더 우측 — 계정 아이콘과 동일 톤(h-9 원형 외곽선)
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition-colors hover:text-teal-600 active:scale-95"
      }
    >
      <span className="material-symbols-outlined text-xl">help</span>
    </button>
  );
}
