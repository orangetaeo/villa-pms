// scripts/test-instagram-render.ts — 인스타 렌더 스모크 (dev 서버 불요, 업로드 안 함)
//   실행: npx tsx scripts/test-instagram-render.ts [출력디렉터리]
//   4종 템플릿(cover/info/service/cta)을 실제 VillaPhoto(있으면) 또는 합성 이미지로 렌더해
//   JPEG로 저장하고, sharp metadata로 1080×1350 확인 + 한글 오버레이 렌더 여부를 검증.
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import { __renderInternals } from "@/lib/instagram/render";
import {
  coverTemplate,
  infoTemplate,
  serviceTemplate,
  ctaTemplate,
} from "@/lib/instagram/templates";

const { compositeToJpeg, cardToJpeg } = __renderInternals;

const OUT_DIR = process.argv[2] ?? path.join(process.cwd(), ".render-smoke");

/** 실제 사진 로드 시도(assets 없으면 합성 그라데이션 사진). */
async function loadSamplePhoto(): Promise<Buffer> {
  // 프로젝트에 있는 임의 png/jpg 재사용(루트 배너 등). 없으면 합성.
  const candidates = ["villa-go-banner-800x400-teal.png", "partner-hi.png"];
  for (const c of candidates) {
    try {
      return readFileSync(path.join(process.cwd(), c));
    } catch {
      /* next */
    }
  }
  // 합성: 세로 그라데이션 배경(사진 대용).
  return sharp({
    create: { width: 1600, height: 1200, channels: 3, background: { r: 30, g: 90, b: 120 } },
  })
    .jpeg()
    .toBuffer();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const photo = await loadSamplePhoto();

  const jobs: { name: string; buf: Promise<Buffer> }[] = [
    {
      name: "cover",
      buf: compositeToJpeg(photo, coverTemplate({ headline: "푸꾸옥에서\n눈 뜨자마자 수영장" })),
    },
    {
      name: "info",
      buf: compositeToJpeg(
        photo,
        infoTemplate({ villaName: "쏘나씨 · 프라이빗 풀빌라", facts: ["침실 3", "최대 8인", "해변 도보 5분"], priceValue: "45만원~" })
      ),
    },
    {
      name: "service",
      buf: compositeToJpeg(
        photo,
        serviceTemplate({ label: "빌라로 찾아오는 출장 마사지", headline: "장보기부터 세팅까지,\n손 하나 안 대셔도 됩니다", ctaText: "카톡 문의 시 견적 안내" })
      ),
    },
    {
      name: "cta",
      buf: cardToJpeg(ctaTemplate({ headline: "예약 · 견적 문의는\n프로필 링크 →\n카카오톡 상담" })),
    },
  ];

  let allOk = true;
  for (const j of jobs) {
    const buf = await j.buf;
    const file = path.join(OUT_DIR, `${j.name}.jpg`);
    writeFileSync(file, buf);
    const meta = await sharp(buf).metadata();
    const ok = meta.width === 1080 && meta.height === 1350 && meta.format === "jpeg";
    if (!ok) allOk = false;
    console.log(`${ok ? "OK " : "FAIL"} ${j.name}: ${meta.width}x${meta.height} ${meta.format} ${buf.length}B → ${file}`);
  }
  console.log(allOk ? "\n✅ 모든 템플릿 1080x1350 JPEG 산출" : "\n❌ 일부 실패");
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
