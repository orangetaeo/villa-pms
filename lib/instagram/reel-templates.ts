// lib/instagram/reel-templates.ts — 릴스(9:16, 1080×1920) satori 오버레이 (additive, P2 릴스 전용)
//
// P1 캐러셀 템플릿(templates.ts)은 1080×1350(4:5) 고정이라 릴스 캔버스와 크기가 다르다.
// templates.ts를 건드리지 않고(캐러셀 경로 무변경) 9:16 전용 커버·CTA 노드를 여기서 별도 정의한다.
// 색상·폰트 토큰(BRAND/FONT_*)은 templates.ts에서 재사용 — 브랜드 일관성 단일 원천.
//
// 릴스 프레임 구성(render.ts renderReelFrameBuffers):
//   1) 커버: 첫 사진 위에 reelCover916 오버레이(감성 헤드라인 + 브랜드/핸들)
//   2) 중간: 사진 원본만(오버레이 없음) — 슬라이드쇼 몰입
//   3) 엔딩: reelCta916 불투명 카드(카카오 상담 유도)
import { BRAND, FONT_SERIF, FONT_SANS, type SatoriNode, type CoverData, type CtaData } from "@/lib/instagram/templates";
import { wrapHeadlineToFit } from "@/lib/instagram/headline-wrap";

const W = 1080;
const H = 1920; // 9:16

/** 릴스 캔버스 크기(1080×1920). render.ts·reels.ts 공유. */
export const REEL_CANVAS = { width: W, height: H } as const;

const TEXT_SHADOW = "0px 2px 16px rgba(10,17,20,0.5)";

function div(style: Record<string, unknown>, children?: SatoriNode | string | (SatoriNode | string)[]): SatoriNode {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

/** 전면 스크림(가독성 그라데이션) — 9:16 폭 기준. */
function scrim(pos: "top" | "bottom", height: number, gradient: string): SatoriNode {
  return div({ position: "absolute", left: 0, [pos]: 0, width: W, height, backgroundImage: gradient });
}

// ── 릴스 커버(9:16) ─────────────────────────────────────
// P1 coverTemplate과 동일 레이아웃 구조를 1080×1920로 확대(스크림 범위·여백 상향).
export function reelCover916(d: CoverData): SatoriNode {
  const eyebrow = d.eyebrow ?? "PHU QUOC PRIVATE POOL VILLA";
  return div(
    {
      position: "relative",
      width: W,
      height: H,
      flexDirection: "column",
      justifyContent: "space-between",
      backgroundColor: "transparent",
    },
    [
      scrim("top", 620, "linear-gradient(to bottom, rgba(10,17,20,0.58) 0%, rgba(10,17,20,0) 100%)"),
      scrim("bottom", 620, "linear-gradient(to top, rgba(10,17,20,0.66) 0%, rgba(10,17,20,0) 100%)"),
      // top — 중앙정렬 헤드라인
      div({ position: "relative", flexDirection: "column", alignItems: "center", padding: "240px 90px 0 90px" }, [
        div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 32, letterSpacing: 9, color: "rgba(255,249,240,0.9)" }, eyebrow),
        div(
          {
            fontFamily: FONT_SERIF,
            fontWeight: 700,
            fontSize: 74,
            lineHeight: 1.26,
            color: "#FFFFFF",
            textAlign: "center",
            marginTop: 34,
            whiteSpace: "pre-line",
            textShadow: TEXT_SHADOW,
            flexDirection: "column",
          },
          // 좌우 패딩 90 → 내부 폭 900. 미리 균형 줄바꿈해 satori 고아 음절 방지.
          wrapHeadlineToFit(d.headline, 74, W - 90 * 2)
        ),
        div({ width: 74, height: 3, backgroundColor: BRAND.sand, marginTop: 38 }),
      ]),
      // bottom — 브랜드/핸들 + 슬라이드 힌트
      div({ position: "relative", justifyContent: "space-between", alignItems: "flex-end", padding: "0 90px 150px 90px" }, [
        div({ flexDirection: "column" }, [
          div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 46, letterSpacing: 6, color: BRAND.cream }, d.brandName ?? "VILLA GO"),
          div({ fontFamily: FONT_SANS, fontWeight: 400, fontSize: 26, color: "rgba(255,249,240,0.82)", marginTop: 12 }, d.handle ?? "@villago.phuquoc"),
        ]),
        div({ fontFamily: FONT_SANS, fontWeight: 400, fontSize: 26, color: "rgba(255,249,240,0.85)" }, d.slideHint ?? "끝까지 보기 →"),
      ]),
    ]
  );
}

// ── 릴스 중간 프레임 캡션(9:16) ─────────────────────────
// 중간 사진이 밋밋하지 않도록 하단 1/3에 짧은 셀링포인트 텍스트를 올린다(공개정보만).
// 하단 스크림으로 가독성 확보, sand 악센트 바 + 세리프 헤드라인 톤(커버와 일관).
export function reelMiddle916(caption: string): SatoriNode {
  return div(
    { position: "relative", width: W, height: H, flexDirection: "column", justifyContent: "flex-end", backgroundColor: "transparent" },
    [
      scrim("top", 300, "linear-gradient(to bottom, rgba(10,17,20,0.34) 0%, rgba(10,17,20,0) 100%)"),
      scrim("bottom", 680, "linear-gradient(to top, rgba(10,17,20,0.74) 0%, rgba(10,17,20,0.32) 44%, rgba(10,17,20,0) 100%)"),
      div({ position: "relative", flexDirection: "column", alignItems: "center", padding: "0 96px 320px 96px" }, [
        div({ width: 60, height: 3, backgroundColor: BRAND.sand, marginBottom: 30 }),
        div(
          {
            fontFamily: FONT_SERIF,
            fontWeight: 700,
            fontSize: 70,
            color: "#FFFFFF",
            textAlign: "center",
            lineHeight: 1.28,
            whiteSpace: "pre-line",
            textShadow: TEXT_SHADOW,
            flexDirection: "column",
          },
          // 좌우 패딩 96 → 내부 폭 888. 균형 줄바꿈으로 고아 음절 방지.
          wrapHeadlineToFit(caption, 70, W - 96 * 2)
        ),
      ]),
    ]
  );
}

// ── 릴스 엔딩 CTA(9:16, 불투명 카드) ────────────────────
// P1 ctaTemplate과 동일 톤을 1080×1920로. 사진 없이 teal 그라디언트 카드.
export function reelCta916(d: CtaData): SatoriNode {
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
      div({ position: "absolute", top: -140, right: -120, width: 520, height: 520, borderRadius: 999, backgroundColor: "rgba(255,249,240,0.06)" }),
      div({ position: "absolute", bottom: -100, left: -140, width: 440, height: 440, borderRadius: 999, backgroundColor: "rgba(245,158,11,0.08)" }),
      // top — 워드마크 + 핸들
      div({ position: "relative", flexDirection: "column", alignItems: "center", paddingTop: 220 }, [
        div({ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 48, letterSpacing: 10, color: BRAND.cream }, d.brandName ?? "VILLA GO"),
        div({ fontFamily: FONT_SANS, fontWeight: 400, fontSize: 32, color: "rgba(255,249,240,0.85)", marginTop: 16 }, d.handle ?? "푸꾸옥 프라이빗 풀빌라"),
      ]),
      // center — 디바이더 + 헤드라인 + 카카오 버튼
      div({ position: "relative", flexDirection: "column", alignItems: "center", padding: "0 100px" }, [
        div({ width: 74, height: 3, backgroundColor: BRAND.sand }),
        div(
          { fontFamily: FONT_SERIF, fontWeight: 700, fontSize: 68, color: "#FFFFFF", textAlign: "center", lineHeight: 1.32, marginTop: 44, whiteSpace: "pre-line", flexDirection: "column" },
          // 좌우 패딩 100 → 내부 폭 880.
          wrapHeadlineToFit(d.headline, 68, W - 100 * 2)
        ),
        div({ backgroundColor: BRAND.kakaoYellow, color: BRAND.kakaoInk, fontFamily: FONT_SANS, fontWeight: 700, fontSize: 40, padding: "24px 46px", borderRadius: 999, marginTop: 60 }, d.kakaoLabel ?? "카카오톡으로 상담하기"),
      ]),
      // bottom — helper
      div({ position: "relative", padding: "0 100px 150px 100px" }, [
        div({ fontFamily: FONT_SANS, fontWeight: 400, fontSize: 32, color: "rgba(255,249,240,0.8)", textAlign: "center" }, d.helper ?? "프로필 링크를 눌러 카카오 채널로 연결됩니다"),
      ]),
    ]
  );
}
