// lib/brand/logo-lockup.ts — Villa Go 브랜드 로고 락업(satori 노드)
//
// 왜 필요한가(테오 2026-07-23): 자동 생성 영상·이미지에 로고가 아니라 **"VILLA GO"라는 글자만**
//   박혀 있었다. 워터마크·커버·엔딩 카드 전부 letterSpacing 준 텍스트였다.
//   → 실제 브랜드 마크(로케이션 핀 = 빌라, design/stitch/logo-villa-go/concept-b)를 붙인
//     정식 락업(마크 + 워드마크)으로 교체한다.
//
// 구조:
//   - 마크(핀)  = assets/brand/villa-go-mark{,-reverse}.svg 를 base64 data URI로 인라인 → satori <img>
//     (templates.ts 정보바 아이콘과 동일 기법. satori는 data URI SVG를 그대로 렌더한다)
//   - 워드마크 = "Villa" + "Go" 텍스트. satori가 path로 변환하므로 래스터화에 폰트 불필요.
//     폰트는 render.ts·edit.ts가 로드하는 "Noto"(NotoSans-Bold) — 라틴 글리프가 가장 깔끔하다.
//
// ★ SVG 소스를 수정하면 아래 base64 상수도 재생성할 것:
//     base64 -w0 assets/brand/villa-go-mark.svg
//     base64 -w0 assets/brand/villa-go-mark-reverse.svg
// ★ 이미지 대신 텍스트만 쓰고 싶으면 CoverData.brandName 등에 문자열을 넘기면 된다(하위호환 유지).

/** satori 노드(느슨) — lib/instagram/templates.ts SatoriNode와 구조적으로 동일. */
type Node = {
  type: string;
  props: { style?: Record<string, unknown>; children?: Node | string | (Node | string)[] };
};

// 마크 원본 종횡비 (viewBox 120×150)
const MARK_ASPECT = 120 / 150;

/** 라이트 배경용 — 틸 핀 + 흰 빌라 녹아웃 + 샌드 해 점. */
const MARK_LIGHT =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAgMTUwIiBmaWxsPSJub25lIj4KICA8cGF0aCBkPSJNNjAgMkMyOS42IDIgNSAyNi42IDUgNTdjMCAzOS42IDQ3IDg2LjUgNTMgOTIuMiAxLjEgMS4xIDIuOSAxLjEgNCAwQzY4IDE0My41IDExNSA5Ni42IDExNSA1NyAxMTUgMjYuNiA5MC40IDIgNjAgMloiIGZpbGw9IiMwRDk0ODgiLz4KICA8cGF0aCBkPSJNNjAgMjYgMzQgNTB2M2g2djI4aDQwVjUzaDZ2LTNMNjAgMjZaIiBmaWxsPSIjRkZGRkZGIi8+CiAgPHJlY3QgeD0iNTMiIHk9IjYzIiB3aWR0aD0iMTQiIGhlaWdodD0iMTgiIHJ4PSIxLjUiIGZpbGw9IiMwRDk0ODgiLz4KICA8Y2lyY2xlIGN4PSI2MCIgY3k9IjQyIiByPSI1IiBmaWxsPSIjRjU5RTBCIi8+Cjwvc3ZnPgo=";

/** 어두운 사진·틸 카드 위용(reverse) — 크림 핀 + 틸 빌라 녹아웃 + 샌드 해 점. */
const MARK_REVERSE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAgMTUwIiBmaWxsPSJub25lIj4KICA8cGF0aCBkPSJNNjAgMkMyOS42IDIgNSAyNi42IDUgNTdjMCAzOS42IDQ3IDg2LjUgNTMgOTIuMiAxLjEgMS4xIDIuOSAxLjEgNCAwQzY4IDE0My41IDExNSA5Ni42IDExNSA1NyAxMTUgMjYuNiA5MC40IDIgNjAgMloiIGZpbGw9IiNGRkY5RjAiLz4KICA8cGF0aCBkPSJNNjAgMjYgMzQgNTB2M2g2djI4aDQwVjUzaDZ2LTNMNjAgMjZaIiBmaWxsPSIjMEQ5NDg4Ii8+CiAgPHJlY3QgeD0iNTMiIHk9IjYzIiB3aWR0aD0iMTQiIGhlaWdodD0iMTgiIHJ4PSIxLjUiIGZpbGw9IiNGRkY5RjAiLz4KICA8Y2lyY2xlIGN4PSI2MCIgY3k9IjQyIiByPSI1IiBmaWxsPSIjRjU5RTBCIi8+Cjwvc3ZnPgo=";

/**
 * 배치 맥락별 색 조합.
 *   photo — 사진 위(어두운 스크림·반투명 알약). "Go"를 밝은 틸로 띄운다.
 *   teal  — 틸 그라디언트 카드 위. 틸 계열 글자는 묻히므로 워드마크 전체를 크림 단색으로.
 *   light — 밝은 배경(현재 영상 경로엔 없음. 향후 밝은 카드용).
 */
export type LockupVariant = "photo" | "teal" | "light";

const VARIANT_STYLE: Record<LockupVariant, { mark: string; villa: string; go: string }> = {
  photo: { mark: MARK_REVERSE, villa: "#FFF9F0", go: "#5EEAD4" },
  teal: { mark: MARK_REVERSE, villa: "#FFF9F0", go: "#FFF9F0" },
  light: { mark: MARK_LIGHT, villa: "#1E293B", go: "#0D9488" },
};

/** 워드마크 폰트 — render.ts/edit.ts loadFonts()가 등록하는 이름. 라틴 전용이라 Noto가 가장 깔끔. */
const WORDMARK_FONT = "Noto";

/** 핀 마크 <img> 노드. 높이만 주면 종횡비대로 폭이 정해진다. */
export function brandMark(height: number, variant: LockupVariant = "photo"): Node {
  return {
    type: "img",
    props: {
      src: VARIANT_STYLE[variant].mark,
      width: Math.round(height * MARK_ASPECT),
      height,
      style: { display: "flex" },
    },
  } as unknown as Node;
}

export interface LockupOptions {
  variant?: LockupVariant;
  /** 워드마크 글자 크기(px). 마크 높이는 지정 없으면 이 값의 1.15배 */
  fontSize?: number;
  markHeight?: number;
  /** 마크와 워드마크 사이 간격(px) */
  gap?: number;
  /** 그림자(사진 위 가독성). 기본 photo 변형에서만 켠다 */
  shadow?: boolean;
}

/** 워드마크만("Villa Go") — 마크 없이 텍스트 lockup이 필요할 때. */
export function brandWordmark(fontSize: number, variant: LockupVariant = "photo", shadow = false): Node {
  const c = VARIANT_STYLE[variant];
  const base = {
    fontFamily: WORDMARK_FONT,
    fontWeight: 700,
    fontSize,
    letterSpacing: -fontSize * 0.02, // 워드마크는 살짝 조여야 로고처럼 보인다(넓은 자간 = 라벨 느낌)
    ...(shadow ? { textShadow: "0px 2px 12px rgba(10,17,20,0.55)" } : {}),
  };
  return {
    type: "div",
    props: {
      style: { display: "flex", alignItems: "baseline" },
      children: [
        { type: "div", props: { style: { display: "flex", ...base, color: c.villa }, children: "Villa" } },
        {
          type: "div",
          props: {
            style: { display: "flex", ...base, color: c.go, marginLeft: fontSize * 0.18 },
            children: "Go",
          },
        },
      ],
    },
  };
}

/**
 * 가로 락업(마크 + Villa Go) — 워터마크·커버 하단 등 기본 형태.
 * design/stitch/logo-villa-go/concept-b "HORIZONTAL LOCKUP" 기준.
 */
export function brandLockup(opts: LockupOptions = {}): Node {
  const variant = opts.variant ?? "photo";
  const fontSize = opts.fontSize ?? 40;
  const markHeight = opts.markHeight ?? Math.round(fontSize * 1.15);
  const gap = opts.gap ?? Math.round(fontSize * 0.42);
  const shadow = opts.shadow ?? variant === "photo";
  return {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "row", alignItems: "center" },
      children: [
        {
          type: "div",
          props: {
            style: { display: "flex", marginRight: gap, ...(shadow ? { filter: "drop-shadow(0 2px 10px rgba(10,17,20,0.5))" } : {}) },
            children: brandMark(markHeight, variant),
          },
        },
        brandWordmark(fontSize, variant, shadow),
      ],
    },
  };
}

/**
 * 세로 락업(마크 위 · Villa Go 아래) — 엔딩 CTA 카드처럼 로고를 크게 세우는 자리.
 * design/stitch/logo-villa-go/concept-b "STACKED LOCKUP" 기준.
 */
export function brandLockupStacked(opts: LockupOptions = {}): Node {
  const variant = opts.variant ?? "teal";
  const fontSize = opts.fontSize ?? 56;
  const markHeight = opts.markHeight ?? Math.round(fontSize * 2.1);
  const gap = opts.gap ?? Math.round(fontSize * 0.42);
  const shadow = opts.shadow ?? variant === "photo";
  return {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column", alignItems: "center" },
      children: [
        {
          type: "div",
          props: { style: { display: "flex", marginBottom: gap }, children: brandMark(markHeight, variant) },
        },
        brandWordmark(fontSize, variant, shadow),
      ],
    },
  };
}
