// lib/instagram/templates.ts — satori 오버레이 템플릿 4종 (데이터 주입형 순수 함수)
//
// 정본 디자인: design/stitch/instagram-templates/SPEC.md (DESIGN). 이 파일은 그 SPEC의 레이어 구조·색상
//   토큰을 satori 노드로 변환한 것이다. cover/info/service = 투명 배경(사진 위 sharp composite, SPEC §0 (B)),
//   cta = 불투명 teal 그라디언트 카드(사진 없음).
//
// satori 제약(SPEC §0): flexbox + absolute만, box-shadow 대신 반투명 fill/border, 다자식 요소는 display:flex.
// ⚠ 이모지 미사용: satori 기본 폰트로 렌더 불가(두부). info 정보바는 텍스트+앰버 dot 구분으로 대체
//   (SPEC의 SVG 아이콘 교체는 아이콘 에셋 준비 후 후속 — BE 인계 확인 #1). 이모지는 캡션(인스타 렌더)에만.

const W = 1080;
const H = 1350;

// SPEC §1 색상 토큰.
export const BRAND = {
  teal: "#0D9488",
  tealMid: "#0F766E",
  tealDeep: "#115E59",
  cream: "#FFF9F0",
  sand: "#F59E0B",
  kakaoYellow: "#FEE500",
  kakaoInk: "#191600",
} as const;

export const FONT_SERIF = "Myeongjo"; // 감성 헤드라인 (NanumMyeongjo)
export const FONT_SANS = "Sans"; // 정보·라벨·브랜드 (NanumGothic — SPEC의 Pretendard 대체, 한글 글리프 번들)

const TEXT_SHADOW = "0px 2px 14px rgba(10,17,20,0.45)";

// satori 노드 타입(느슨) — props.style은 CSS 부분집합.
export type SatoriNode = {
  type: string;
  props: {
    style?: Record<string, unknown>;
    children?: SatoriNode | string | (SatoriNode | string)[];
  };
};

function div(style: Record<string, unknown>, children?: SatoriNode | string | (SatoriNode | string)[]): SatoriNode {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

/** 전면 스크림(가독성 그라데이션). */
function scrim(pos: "top" | "bottom", height: number, gradient: string): SatoriNode {
  return div({
    position: "absolute",
    left: 0,
    [pos]: 0,
    width: W,
    height,
    backgroundImage: gradient,
  });
}

/** 앰버 dot(정보 구분). */
function dot(): SatoriNode {
  return div({ width: 12, height: 12, borderRadius: 999, backgroundColor: BRAND.sand, margin: "0 22px" });
}

// ── 커버 ──────────────────────────────────────────────
export interface CoverData {
  headline: string; // 감성 헤드라인(변수 치환 완료, "\n" 줄바꿈 허용)
  eyebrow?: string;
  brandName?: string;
  handle?: string;
  slideHint?: string;
}

export function coverTemplate(d: CoverData): SatoriNode {
  const eyebrow = d.eyebrow ?? "PHU QUOC PRIVATE POOL VILLA";
  return div(
    { position: "relative", width: W, height: H, flexDirection: "column", justifyContent: "space-between", backgroundColor: "transparent" },
    [
      scrim("top", 460, "linear-gradient(to bottom, rgba(10,17,20,0.55) 0%, rgba(10,17,20,0) 100%)"),
      scrim("bottom", 420, "linear-gradient(to top, rgba(10,17,20,0.62) 0%, rgba(10,17,20,0) 100%)"),
      // top — 중앙정렬 헤드라인
      div({ position: "relative", flexDirection: "column", alignItems: "center", padding: "150px 84px 0 84px" }, [
        div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 30, letterSpacing: 8, color: "rgba(255,249,240,0.9)" }, eyebrow),
        div(
          {
            fontFamily: FONT_SERIF,
            fontWeight: 700,
            fontSize: 66,
            lineHeight: 1.24,
            color: "#FFFFFF",
            textAlign: "center",
            marginTop: 30,
            whiteSpace: "pre-line",
            textShadow: TEXT_SHADOW,
            flexDirection: "column",
          },
          d.headline
        ),
        div({ width: 68, height: 3, backgroundColor: BRAND.sand, marginTop: 34 }),
      ]),
      // bottom — 브랜드/핸들 + 슬라이드 힌트
      div({ position: "relative", justifyContent: "space-between", alignItems: "flex-end", padding: "0 84px 96px 84px" }, [
        div({ flexDirection: "column" }, [
          div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 42, letterSpacing: 6, color: BRAND.cream }, d.brandName ?? "VILLA GO"),
          div({ fontFamily: FONT_SANS, fontWeight: 400, fontSize: 24, color: "rgba(255,249,240,0.82)", marginTop: 10 }, d.handle ?? "@villago.phuquoc"),
        ]),
        div({ fontFamily: FONT_SANS, fontWeight: 400, fontSize: 24, color: "rgba(255,249,240,0.85)" }, d.slideHint ?? "밀어서 더보기 →"),
      ]),
    ]
  );
}

// ── 정보바 ────────────────────────────────────────────
export interface InfoData {
  villaName: string;
  facts: string[]; // 예: ["침실 3", "최대 8인", "해변 도보 5분"]
  priceValue?: string | null; // "45만원~" — "1박 "은 템플릿 고정. null/미지정이면 뱃지 숨김
}

export function infoTemplate(d: InfoData): SatoriNode {
  const chips: SatoriNode[] = [];
  d.facts.forEach((f, i) => {
    if (i > 0) chips.push(dot());
    chips.push(div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 40, color: "#FFFFFF" }, f));
  });

  const children: SatoriNode[] = [
    scrim("bottom", 470, "linear-gradient(to top, rgba(10,17,20,0.86) 0%, rgba(10,17,20,0.62) 46%, rgba(10,17,20,0) 100%)"),
  ];

  if (d.priceValue) {
    children.push(
      div(
        { position: "absolute", top: 56, right: 84, backgroundColor: BRAND.cream, alignItems: "baseline", padding: "16px 30px", borderRadius: 999 },
        [
          div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 26, color: BRAND.tealMid, marginRight: 10 }, "1박"),
          div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 34, color: BRAND.teal }, d.priceValue),
        ]
      )
    );
  }

  children.push(
    div({ position: "relative", flexDirection: "column", padding: "0 84px 92px 84px" }, [
      div({ fontFamily: FONT_SERIF, fontWeight: 700, fontSize: 46, color: BRAND.cream, marginBottom: 22 }, d.villaName),
      div({ alignItems: "center", flexWrap: "wrap" }, chips),
    ])
  );

  return div(
    { position: "relative", width: W, height: H, flexDirection: "column", justifyContent: "flex-end", backgroundColor: "transparent" },
    children
  );
}

// ── 서비스 ────────────────────────────────────────────
export interface ServiceData {
  label: string; // 라벨 pill 텍스트(카테고리)
  headline: string; // 편의성 카피(serif, "\n" 허용)
  ctaText: string; // 카톡 견적 문구(가격 없음)
  brandName?: string;
}

export function serviceTemplate(d: ServiceData): SatoriNode {
  return div(
    { position: "relative", width: W, height: H, flexDirection: "column", justifyContent: "flex-end", backgroundColor: "transparent" },
    [
      scrim("top", 400, "linear-gradient(to bottom, rgba(10,17,20,0.5) 0%, rgba(10,17,20,0) 100%)"),
      scrim("bottom", 480, "linear-gradient(to top, rgba(10,17,20,0.86) 0%, rgba(10,17,20,0.55) 46%, rgba(10,17,20,0) 100%)"),
      // top — 라벨 pill
      div({ position: "absolute", top: 64, left: 68, alignItems: "center", backgroundColor: BRAND.teal, padding: "16px 30px", borderRadius: 999 }, [
        div({ width: 12, height: 12, borderRadius: 999, backgroundColor: BRAND.sand, marginRight: 16 }),
        div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 30, color: BRAND.cream }, d.label),
      ]),
      // bottom — 카피 + 카톡 태그 + 브랜드
      div({ position: "relative", flexDirection: "column", padding: "0 68px 96px 68px" }, [
        div(
          { fontFamily: FONT_SERIF, fontWeight: 700, fontSize: 62, color: "#FFFFFF", lineHeight: 1.24, whiteSpace: "pre-line", textShadow: TEXT_SHADOW, flexDirection: "column" },
          d.headline
        ),
        div({ alignItems: "center", marginTop: 36 }, [
          div({ backgroundColor: BRAND.kakaoYellow, color: BRAND.kakaoInk, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 32, padding: "16px 30px", borderRadius: 999 }, d.ctaText),
          div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 32, color: BRAND.cream, marginLeft: 26, letterSpacing: 4 }, d.brandName ?? "VILLA GO"),
        ]),
      ]),
    ]
  );
}

// ── CTA ───────────────────────────────────────────────
export interface CtaData {
  headline: string; // serif, "\n" 허용
  brandName?: string;
  handle?: string;
  kakaoLabel?: string;
  helper?: string;
}

export function ctaTemplate(d: CtaData): SatoriNode {
  return div(
    {
      position: "relative",
      width: W,
      height: H,
      flexDirection: "column",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: BRAND.teal,
      backgroundImage: `linear-gradient(150deg, ${BRAND.teal} 0%, ${BRAND.tealMid} 52%, ${BRAND.tealDeep} 100%)`,
    },
    [
      // decor circles (블러 없음 — satori-safe depth)
      div({ position: "absolute", top: -120, right: -100, width: 460, height: 460, borderRadius: 999, backgroundColor: "rgba(255,249,240,0.06)" }),
      div({ position: "absolute", bottom: -80, left: -120, width: 380, height: 380, borderRadius: 999, backgroundColor: "rgba(245,158,11,0.08)" }),
      // top — 워드마크 + 핸들
      div({ position: "relative", flexDirection: "column", alignItems: "center", paddingTop: 132 }, [
        div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 44, letterSpacing: 10, color: BRAND.cream }, d.brandName ?? "VILLA GO"),
        div({ fontFamily: FONT_SANS, fontWeight: 400, fontSize: 30, color: "rgba(255,249,240,0.85)", marginTop: 14 }, d.handle ?? "푸꾸옥 프라이빗 풀빌라"),
      ]),
      // center — 디바이더 + 헤드라인 + 카카오 버튼
      div({ position: "relative", flexDirection: "column", alignItems: "center", padding: "0 96px" }, [
        div({ width: 68, height: 3, backgroundColor: BRAND.sand }),
        div(
          { fontFamily: FONT_SERIF, fontWeight: 700, fontSize: 62, color: "#FFFFFF", textAlign: "center", lineHeight: 1.3, marginTop: 40, whiteSpace: "pre-line", flexDirection: "column" },
          d.headline
        ),
        div({ backgroundColor: BRAND.kakaoYellow, color: BRAND.kakaoInk, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 36, padding: "22px 42px", borderRadius: 999, marginTop: 52 }, d.kakaoLabel ?? "카카오톡으로 상담하기"),
      ]),
      // bottom — helper
      div({ position: "relative", paddingBottom: 92, padding: "0 96px 92px 96px" }, [
        div({ fontFamily: FONT_SANS, fontWeight: 400, fontSize: 30, color: "rgba(255,249,240,0.8)", textAlign: "center" }, d.helper ?? "프로필 링크를 눌러 카카오 채널로 연결됩니다"),
      ]),
    ]
  );
}

export const TEMPLATE_IDS = ["cover", "info", "service", "cta"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const CANVAS = { width: W, height: H } as const;
