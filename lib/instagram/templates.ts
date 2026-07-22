// lib/instagram/templates.ts — satori 오버레이 템플릿 4종 (데이터 주입형 순수 함수)
//
// 정본 디자인: design/stitch/instagram-templates/SPEC.md (DESIGN). 이 파일은 그 SPEC의 레이어 구조·색상
//   토큰을 satori 노드로 변환한 것이다. cover/info/service = 투명 배경(사진 위 sharp composite, SPEC §0 (B)),
//   cta = 불투명 teal 그라디언트 카드(사진 없음).
//
// satori 제약(SPEC §0): flexbox + absolute만, box-shadow 대신 반투명 fill/border, 다자식 요소는 display:flex.
// ⚠ 이모지 미사용: satori 기본 폰트로 렌더 불가(두부). 이모지는 캡션(인스타 렌더)에만.
//   info 정보바 아이콘: 모노크롬 SVG(assets/icons/info-{bed,guests,beach}.svg, DESIGN, fill #FFF9F0)를
//   base64 data URI로 인라인해 satori <img>(height 40)로 렌더(marketing-s2 §E, SPEC §2-2). 순서=침실→인원→해변.
//   ★ 소스 SVG 편집 시 아래 base64 상수도 재생성할 것(scripts로 base64 -w0 <svg>).

import { wrapHeadlineToFit } from "@/lib/instagram/headline-wrap";
// 브랜드 로고 락업(마크 + 워드마크). 예전엔 전 템플릿이 "VILLA GO" 글자만 찍었다(테오 2026-07-23).
import { brandLockup, brandLockupStacked } from "@/lib/brand/logo-lockup";

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

// 정보바 아이콘 (assets/icons/info-*.svg → base64 data URI). fill #FFF9F0 고정 · viewBox 32×32 · satori-safe.
//   순서 인덱스: 0=침실(bed), 1=인원(guests), 2=해변/수영장(beach).
const ICON_BED =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0iI0ZGRjlGMCI+CiAgPHJlY3QgeD0iMyIgeT0iOS41IiB3aWR0aD0iMi44IiBoZWlnaHQ9IjE1IiByeD0iMS40Ii8+CiAgPHJlY3QgeD0iNi42IiB5PSIxMi44IiB3aWR0aD0iNy4yIiBoZWlnaHQ9IjQuNiIgcng9IjIuMyIvPgogIDxwYXRoIGQ9Ik02IDE1LjUgaDE4LjUgYTMgMyAwIDAgMSAzIDMgVjIxIEg2IFoiLz4KICA8cmVjdCB4PSI0IiB5PSIyMC40IiB3aWR0aD0iMjQiIGhlaWdodD0iMi44IiByeD0iMS40Ii8+CiAgPHJlY3QgeD0iNC42IiB5PSIyMi44IiB3aWR0aD0iMi42IiBoZWlnaHQ9IjMuNiIgcng9IjAuOSIvPgogIDxyZWN0IHg9IjI0LjgiIHk9IjIyLjgiIHdpZHRoPSIyLjYiIGhlaWdodD0iMy42IiByeD0iMC45Ii8+Cjwvc3ZnPgo=";
const ICON_GUESTS =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0iI0ZGRjlGMCI+CiAgPHBhdGggZD0iTTMuOSAyNi41IGE2LjQgNi40IDAgMCAxIDEyLjggMCBaIi8+CiAgPGNpcmNsZSBjeD0iMTAuMyIgY3k9IjEwLjgiIHI9IjQuNiIvPgogIDxwYXRoIGQ9Ik0xMi42IDI3IGE3LjcgNy43IDAgMCAxIDE1LjQgMCBaIi8+CiAgPGNpcmNsZSBjeD0iMjAuMyIgY3k9IjEyIiByPSI1LjIiLz4KPC9zdmc+Cg==";
const ICON_BEACH =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0iI0ZGRjlGMCI+CiAgPGNpcmNsZSBjeD0iMTYiIGN5PSI0LjIiIHI9IjEuNSIvPgogIDxyZWN0IHg9IjE1LjMiIHk9IjUiIHdpZHRoPSIxLjQiIGhlaWdodD0iMjIiIHJ4PSIwLjciLz4KICA8cGF0aCBkPSJNMTYgNC41IEMyNC4yIDQuNSAyNy4yIDkuNCAyNy4yIDE1IHEtMi44IDMgLTUuNiAwIHEtMi44IDMgLTUuNiAwIHEtMi44IDMgLTUuNiAwIHEtMi44IDMgLTUuNiAwIEM0LjggOS40IDcuOCA0LjUgMTYgNC41IFoiLz4KPC9zdmc+Cg==";
const INFO_ICONS = [ICON_BED, ICON_GUESTS, ICON_BEACH] as const;

/** 정보바 아이콘 <img> 노드(height 40). satori는 data URI 이미지를 지원(SatoriNode 타입 외 props라 캐스팅). */
function infoIcon(dataUri: string): SatoriNode {
  return {
    type: "img",
    props: { src: dataUri, width: 40, height: 40, style: { display: "flex", marginRight: 16 } },
  } as unknown as SatoriNode;
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
          // 좌우 패딩 84 → 내부 폭 912. 미리 균형 줄바꿈해 satori 고아 음절("로") 방지.
          wrapHeadlineToFit(d.headline, 66, W - 84 * 2)
        ),
        div({ width: 68, height: 3, backgroundColor: BRAND.sand, marginTop: 34 }),
      ]),
      // bottom — 브랜드/핸들 + 슬라이드 힌트
      div({ position: "relative", justifyContent: "space-between", alignItems: "flex-end", padding: "0 84px 96px 84px" }, [
        div({ flexDirection: "column" }, [
          d.brandName
            ? div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 42, letterSpacing: 6, color: BRAND.cream }, d.brandName)
            : (brandLockup({ variant: "photo", fontSize: 40, markHeight: 52, gap: 16 }) as SatoriNode),
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
  // ⚠ 마진 비공개 원칙(QA P2 #1): 운영자가 승인한 "공개 시작가 티저" 문자열만 허용 — 반드시 "~" 포함 표기(예: "45만원~").
  //   quote 엔진 판매가·원가·마진 파생값을 절대 주입하지 말 것. 자동 파이프라인(draft.ts)은 null 고정.
  priceValue?: string | null; // null/미지정이면 뱃지 숨김. "1박 "은 템플릿 고정
}

export function infoTemplate(d: InfoData): SatoriNode {
  // 각 항목 = [아이콘 img + 텍스트] 그룹, 그룹 사이 간격(marginRight). 앰버 dot 폐지(marketing-s2 §E).
  //   아이콘은 순서 인덱스(0 침실·1 인원·2 해변)로 매핑. 4번째+ 항목은 아이콘 없이 텍스트만(안전 폴백).
  const chips: SatoriNode[] = d.facts.map((f, i) => {
    const iconSrc = INFO_ICONS[i];
    return div(
      { alignItems: "center", marginRight: i < d.facts.length - 1 ? 40 : 0 },
      [
        ...(iconSrc ? [infoIcon(iconSrc)] : []),
        div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 40, color: "#FFFFFF" }, f),
      ]
    );
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
          // 좌우 패딩 68 → 내부 폭 944.
          wrapHeadlineToFit(d.headline, 62, W - 68 * 2)
        ),
        div({ alignItems: "center", marginTop: 36 }, [
          div({ backgroundColor: BRAND.kakaoYellow, color: BRAND.kakaoInk, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 32, padding: "16px 30px", borderRadius: 999 }, d.ctaText),
          d.brandName
            ? div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 32, color: BRAND.cream, marginLeft: 26, letterSpacing: 4 }, d.brandName)
            : (div({ marginLeft: 26 }, brandLockup({ variant: "photo", fontSize: 32, markHeight: 42, gap: 12 }) as SatoriNode)),
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
      // top — 로고 락업(세로) + 핸들
      div({ position: "relative", flexDirection: "column", alignItems: "center", paddingTop: 110 }, [
        d.brandName
          ? div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 44, letterSpacing: 10, color: BRAND.cream }, d.brandName)
          : (brandLockupStacked({ variant: "teal", fontSize: 54, markHeight: 118, gap: 24 }) as SatoriNode),
        div({ fontFamily: FONT_SANS, fontWeight: 400, fontSize: 30, color: "rgba(255,249,240,0.85)", marginTop: 14 }, d.handle ?? "푸꾸옥 프라이빗 풀빌라"),
      ]),
      // center — 디바이더 + 헤드라인 + 카카오 버튼
      div({ position: "relative", flexDirection: "column", alignItems: "center", padding: "0 96px" }, [
        div({ width: 68, height: 3, backgroundColor: BRAND.sand }),
        div(
          { fontFamily: FONT_SERIF, fontWeight: 700, fontSize: 62, color: "#FFFFFF", textAlign: "center", lineHeight: 1.3, marginTop: 40, whiteSpace: "pre-line", flexDirection: "column" },
          // 좌우 패딩 96 → 내부 폭 888.
          wrapHeadlineToFit(d.headline, 62, W - 96 * 2)
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
