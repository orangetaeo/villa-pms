// scripts/smoke-brand-logo.ts — 브랜드 로고 락업 렌더 스모크(업로드·DB 미접촉)
// 실행: npx tsx scripts/smoke-brand-logo.ts   → tmp/brand-smoke/*.png
//
// 확인 목적: satori가 data URI SVG(핀 마크)를 실제로 그리는지, 락업 정렬·크기가 맞는지 눈으로 본다.
import { promises as fs, readFileSync } from "fs";
import path from "path";
import satori from "satori";
import sharp from "sharp";
import { reelCover916, reelCta916 } from "@/lib/instagram/reel-templates";
import { FONT_SANS, FONT_SERIF, type SatoriNode } from "@/lib/instagram/templates";
import { brandLockup, brandLockupStacked, brandMark } from "@/lib/brand/logo-lockup";

const W = 1080;
const H = 1920;
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

const fonts = [
  { name: FONT_SERIF, data: readFileSync(path.join(FONT_DIR, "NanumMyeongjo-Bold.ttf")), weight: 700 as const, style: "normal" as const },
  { name: FONT_SANS, data: readFileSync(path.join(FONT_DIR, "NanumGothic-Regular.ttf")), weight: 400 as const, style: "normal" as const },
  { name: FONT_SANS, data: readFileSync(path.join(FONT_DIR, "NanumGothic-Bold.ttf")), weight: 700 as const, style: "normal" as const },
  { name: "Noto", data: readFileSync(path.join(FONT_DIR, "NotoSans-Regular.ttf")), weight: 400 as const, style: "normal" as const },
  { name: "Noto", data: readFileSync(path.join(FONT_DIR, "NotoSans-Bold.ttf")), weight: 700 as const, style: "normal" as const },
];

function div(style: Record<string, unknown>, children?: unknown): SatoriNode {
  return { type: "div", props: { style: { display: "flex", ...style }, children } } as SatoriNode;
}

async function render(node: SatoriNode, out: string, bg: string) {
  const svg = await satori(node as unknown as Parameters<typeof satori>[0], { width: W, height: H, fonts });
  await sharp(Buffer.from(svg)).flatten({ background: bg }).png().toFile(out);
  console.log("  →", path.basename(out));
}

async function main() {
  const dir = path.join(process.cwd(), "tmp", "brand-smoke");
  await fs.mkdir(dir, { recursive: true });

  // 1) 락업 견본판 — 사진 위(어두운 회색) 가정
  await render(
    div({ position: "relative", width: W, height: H, flexDirection: "column", justifyContent: "center", alignItems: "center", backgroundColor: "#243330" }, [
      div({ marginBottom: 90 }, brandMark(200, "photo")),
      div({ marginBottom: 90 }, brandLockup({ variant: "photo", fontSize: 64 })),
      div({}, brandLockupStacked({ variant: "photo", fontSize: 58 })),
    ]),
    path.join(dir, "1-lockups.png"),
    "#243330"
  );

  // 2) 영상 워터마크(우상단 알약) 재현
  await render(
    div({ position: "relative", width: W, height: H, backgroundColor: "#3B4A46" }, [
      div(
        { position: "absolute", top: 54, right: 54, alignItems: "center", backgroundColor: "rgba(13,17,20,0.42)", borderRadius: 999, padding: "12px 26px 12px 22px" },
        brandLockup({ variant: "photo", fontSize: 34, markHeight: 46, gap: 14 })
      ),
    ]),
    path.join(dir, "2-watermark.png"),
    "#3B4A46"
  );

  // 3) 릴스 커버(사진 없이 오버레이만)
  await render(
    reelCover916({ headline: "문을 열면 바로 앞이\n푸꾸옥의 바다" }),
    path.join(dir, "3-reel-cover.png"),
    "#4A5B56"
  );

  // 4) 엔딩 CTA 카드
  await render(
    reelCta916({ headline: "예약 · 견적 문의는\n카카오톡 채널\n'빌라고' 검색" }),
    path.join(dir, "4-reel-cta.png"),
    "#0F766E"
  );

  console.log("\n완료:", dir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
