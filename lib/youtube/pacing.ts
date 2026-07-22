// lib/youtube/pacing.ts — 컷 속도 조절(페이싱) 계획 (video-pacing-quality)
//
// 왜 필요한가(테오 2026-07-23): 지금까지 모든 컷이 **원본 속도 1배**로 재생됐다.
//   빌라 투어 영상에서 복도·계단·현관은 "거쳐 가는 곳"이라 정속으로 보여주면 지루하고,
//   반대로 수영장·거실·침실은 **머물러야** 매력이 전달된다.
//   전문 부동산 투어 영상은 예외 없이 이 완급을 준다 — 이동 구간은 빠르게 훑고, 도착하면 천천히.
//
// 설계 원칙(중요):
//   ★ **화면에 나가는 길이(targetScreenSec)는 절대 바꾸지 않는다.** 그건 나레이션이 정한다
//     (narration.ts computeNarrationTimeline). 페이싱이 바꾸는 것은 "그 시간 동안 원본을
//     얼마나 소비하느냐"뿐이다. 빠른 컷 = 같은 시간에 더 많은 공간을 지나간다.
//     여기를 헷갈리면 오디오와 화면이 어긋난다(2026-07-22 드리프트 사고의 원인 클래스).
//   ★ 순수 함수만 둔다 — ffmpeg 인자 조립은 edit.ts가 한다. 테스트로 수식을 고정한다.
//
// 두 가지 속도 조절:
//   ⑴ 정속 배속 — 컷 전체를 일정 배율로. factor = 화면길이/읽은길이 (setpts 곱)
//   ⑵ 램프(감속 진입) — 빠르게 들어가서 끝에서 정상 속도로 **도착**한다. 복도를 성큼 지나
//      방 문턱에서 속도가 붙잡히는 느낌. 테오가 말한 "빠른 이동 후 집중해서 보여주기".

/** 컷의 성격 — 원본 공간(PhotoSpace)과 메모에서 판정한다. */
export type ClipPaceKind = "transit" | "feature" | "hero";

export interface ClipPace {
  kind: ClipPaceKind;
  /**
   * 화면 1초당 소비할 원본 초.
   *   1보다 크면 빨리 감기(같은 시간에 더 멀리 이동), 1보다 작으면 슬로우(더 오래 음미).
   */
  sourceSpeed: number;
  /** 컷 안에서 속도를 떨어뜨릴지 — 빠르게 진입 → 끝에서 감속(도착). */
  ramp: boolean;
}

/**
 * 공간별 기본 페이싱.
 *
 * ★ EXTERIOR·POOL을 hero로 두는 이유: 첫인상을 만드는 컷이다. 여기서 서두르면
 *   "좋은 빌라"라는 인상 자체가 안 남는다. 살짝(0.88배) 느리게 흘려 여유를 준다.
 * ★ ETC가 transit인 이유: 복도·계단·현관·이동 샷이 대부분 여기로 분류된다.
 *   공간을 특정하지 못한 컷 = 대개 "지나가는 곳"이라는 실측 경향.
 */
const SPACE_PACE: Record<string, ClipPaceKind> = {
  EXTERIOR: "hero",
  POOL: "hero",
  LIVING: "feature",
  KITCHEN: "feature",
  BEDROOM: "feature",
  BATHROOM: "feature",
  BALCONY: "feature",
  ETC: "transit",
};

/**
 * 메모(note)에 나오면 **이동 컷**으로 강제하는 단어들.
 * 공급자(베트남어)·운영자(한국어) 양쪽이 쓰는 표현을 함께 본다 — note는 자유 텍스트라
 * 공간 코드보다 훨씬 정확한 신호일 때가 많다("BEDROOM인데 실제론 침실로 걸어가는 컷").
 */
const TRANSIT_HINTS = [
  "복도", "계단", "통로", "입구", "현관", "로비", "이동", "진입", "들어가", "올라가", "내려가",
  "hallway", "corridor", "stair", "entrance", "lobby", "walk", "hall", "passage",
  "hành lang", "cầu thang", "lối đi", "lối vào", "sảnh", "đi vào",
];

/** 메모에 나오면 **머무는 컷**으로 강제하는 단어들(이동 단어보다 우선). */
const LINGER_HINTS = [
  "수영장", "전망", "뷰", "일몰", "노을", "바다", "정원", "테라스", "야경",
  "pool", "view", "sunset", "sea", "ocean", "garden", "terrace",
  "hồ bơi", "bể bơi", "hoàng hôn", "biển", "sân vườn", "view biển",
];

/** 페이싱 배율 — 실제 렌더로 눈으로 보고 조정한 값(과하면 슬로모션·타임랩스 티가 난다). */
export const PACE_SPEED: Record<ClipPaceKind, number> = {
  /** 이동 컷: 화면 1초에 원본 1.85초 → 복도를 성큼성큼 지나간다 */
  transit: 1.85,
  /** 일반 공간: 거의 정속. 아주 살짝 여유만 준다 */
  feature: 0.95,
  /** 첫인상 컷(외관·수영장): 살짝 느리게 흘려 여운을 남긴다 */
  hero: 0.88,
};

function hasHint(text: string, hints: string[]): boolean {
  const t = text.toLowerCase();
  return hints.some((h) => t.includes(h));
}

/**
 * 컷의 공간·메모 → 페이싱.
 * @param space PhotoSpace 값(EXTERIOR·LIVING…). null이면 미지정
 * @param note  자유 메모(VillaClip.note). 공간 코드보다 우선하는 신호로 쓴다
 */
export function resolveClipPace(space?: string | null, note?: string | null): ClipPace {
  let kind: ClipPaceKind = space ? (SPACE_PACE[space] ?? "feature") : "feature";

  const n = (note ?? "").trim();
  if (n) {
    // 머무는 신호가 이동 신호를 이긴다 — "계단 위 수영장 뷰"는 머물러야 하는 컷이다.
    if (hasHint(n, LINGER_HINTS)) kind = "hero";
    else if (hasHint(n, TRANSIT_HINTS)) kind = "transit";
  }

  return { kind, sourceSpeed: PACE_SPEED[kind], ramp: kind === "transit" };
}

/** 원본이 짧아 요청 길이를 못 채울 때 허용하는 최대 감속(슬로모션 티가 나기 직전). */
export const MAX_SLOWDOWN = 1.6;
/** 최대 빨리 감기 — 이보다 빠르면 타임랩스로 보인다. */
export const MAX_SPEEDUP = 3.0;
/** 램프 강도 — 시작/끝 속도가 평균의 ±40%. 0.4를 넘기면 끝부분이 눈에 띄게 질질 끌린다. */
export const RAMP_RATIO = 0.4;

export interface ClipTimingPlan {
  /** 원본에서 읽을 길이(초) — ffmpeg `-t` */
  readSec: number;
  /** 정속 배속 인자(out_pts = factor × in_pts). ramp가 있으면 무시된다 */
  factor: number;
  /** 램프 구간 속도(소스초/화면초). a=시작(빠름) → b=끝(느림) */
  ramp: { a: number; b: number } | null;
  /** 실제로 나오는 화면 길이(초). 원본이 부족하면 target보다 짧다 */
  screenSec: number;
  /** 페이싱이 실제로 적용됐는지(로그·진단용) */
  applied: boolean;
}

/**
 * 목표 화면 길이 + 남은 원본 길이 + 페이싱 → ffmpeg 실행 계획.
 *
 * 수식(램프):
 *   속도 s(T) = a + (b−a)·T/S  (S = readSec, 소스 시간 T)
 *   화면시간 f(T) = (S/(b−a))·ln(1 + ((b−a)/(a·S))·T)
 *   f(S) = (S/(b−a))·ln(b/a) = screenSec 가 되도록 a,b를 잡는다.
 *   a = m(1+r), b = m(1−r), m = S·ln((1+r)/(1−r)) / (2·r·screenSec)
 *   → m이 상쇄되어 f(S) = screenSec 이 **정확히** 성립한다(테스트로 고정).
 */
export function planClipTiming(
  targetScreenSec: number,
  availableSourceSec: number | null,
  pace: ClipPace,
  opts: { maxSlowdown?: number; maxSpeedup?: number; rampRatio?: number } = {}
): ClipTimingPlan {
  const maxSlow = opts.maxSlowdown ?? MAX_SLOWDOWN;
  const maxFast = opts.maxSpeedup ?? MAX_SPEEDUP;
  const r = opts.rampRatio ?? RAMP_RATIO;
  const target = Math.max(0.1, targetScreenSec);

  // 원본 길이를 모르면(ffprobe 실패) 손대지 않는다 — 추측으로 배속을 걸면 조용히 깨진다.
  if (availableSourceSec == null || !Number.isFinite(availableSourceSec) || availableSourceSec <= 0.1) {
    return { readSec: target, factor: 1, ramp: null, screenSec: target, applied: false };
  }

  // 이 컷에 쓰고 싶은 원본 양. 원본이 모자라면 있는 만큼만 쓴다.
  const want = target * pace.sourceSpeed;
  const readSec = Math.min(want, availableSourceSec);

  // out = factor × in. factor < 1 = 빨리 감기, > 1 = 감속.
  let factor = target / readSec;
  const clamped = Math.min(maxSlow, Math.max(1 / maxFast, factor));
  const applied = Math.abs(clamped - 1) > 0.02;
  factor = clamped;

  const screenSec = readSec * factor;

  // 램프는 **빨리 감는 컷에서만** 의미가 있다(느린 컷을 더 느리게 시작시키면 정지처럼 보인다).
  let ramp: { a: number; b: number } | null = null;
  const avgSpeed = readSec / screenSec; // 평균 소스속도
  if (pace.ramp && avgSpeed > 1.05 && r > 0.01 && r < 0.9) {
    const m = (readSec * Math.log((1 + r) / (1 - r))) / (2 * r * screenSec);
    ramp = { a: m * (1 + r), b: m * (1 - r) };
  }

  return { readSec, factor, ramp, screenSec, applied };
}

/**
 * 계획 → ffmpeg 필터 조각(비디오 입력 [0:v] 직후에 붙는다). 손댈 게 없으면 빈 문자열.
 * ★ 콤마를 쓰지 않는다: filter_complex는 콤마가 필터 구분자라, 표현식 안에 콤마가 들어가면
 *   따옴표로 감싸야 하고 그건 spawn 인자 배열에서 또 다른 함정이 된다
 *   ([[ffmpeg-aevalsrc-exprs-comma-quoting]]와 같은 클래스의 사고). log(1+C*T)에는 콤마가 없다.
 */
export function pacingFilterChain(plan: ClipTimingPlan): string {
  if (plan.ramp) {
    const { a, b } = plan.ramp;
    const S = plan.readSec;
    const K = S / (b - a); // 음수(b < a)
    const C = (b - a) / (a * S); // 음수 — "1+-0.07*T" 꼴이 되지 않게 부호를 밖으로 뺀다
    const cTerm = C < 0 ? `1-${Math.abs(C).toFixed(9)}*T` : `1+${C.toFixed(9)}*T`;
    // 앞의 setpts로 T를 0부터 시작하게 맞춘 뒤 램프를 건다.
    return `setpts=PTS-STARTPTS,setpts=${K.toFixed(6)}*log(${cTerm})/TB`;
  }
  if (Math.abs(plan.factor - 1) <= 0.005) return "";
  return `setpts=${plan.factor.toFixed(6)}*(PTS-STARTPTS)`;
}
