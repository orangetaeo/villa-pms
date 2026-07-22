// 진단: 나레이션 타임라인이 요구한 컷 길이 vs 원본 클립 실제 길이
import "dotenv/config";
import { spawnSync } from "child_process";
import ffprobeStatic from "ffprobe-static";
import { PrismaClient } from "@prisma/client";
import { synthesizeNarration, computeNarrationTimeline } from "../lib/youtube/narration";

const prisma = new PrismaClient();
const short = await prisma.youtubeShort.findUniqueOrThrow({
  where: { id: "cmrw6mmg50001ukxo28rjxogq" },
  select: { editParamsJson: true },
});
const ep = short.editParamsJson as any;
const lines = ep.narration.lines;

const synth = await synthesizeNarration(lines); // 캐시 히트 → 빠름
const tl = computeNarrationTimeline({
  lines: synth.map((s) => ({ durationSec: s.durationSec, parts: s.parts })),
  transitionSec: 0.4,
  minSegmentSec: 2,
  ctaMinSec: 2.8,
});

const files = [
  "00-entrance","01-pool","02-facade","03-living","04-dining",
  "05-kitchen","06-bed1","07-bed2","08-twin","09-bath","10-balcony",
];
const dur = (f: string) =>
  parseFloat(
    spawnSync(ffprobeStatic.path, ["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1", f], { encoding: "utf8" }).stdout.trim()
  );

console.log("컷   요구길이   원본길이   판정");
let deficit = 0;
files.forEach((f, i) => {
  const want = tl.clipDurations[i] ?? 0;
  const have = dur(`smoke/clip-${f}.mp4`);
  const short = want > have + 0.05;
  if (short) deficit += want - have;
  console.log(
    String(i + 1).padStart(3),
    want.toFixed(2).padStart(8),
    have.toFixed(2).padStart(9),
    "  " + (short ? `★부족 ${(want - have).toFixed(2)}s` : "OK")
  );
});
console.log("\nCTA 카드:", tl.ctaDurationSec.toFixed(2) + "s");
console.log("타임라인 총길이:", tl.totalSec.toFixed(2) + "s");
console.log("부족분 합계:", deficit.toFixed(2) + "s  ← 이만큼 화면이 모자라 정지로 보인다");
console.log("나레이션 총 발화:", synth.reduce((a, s) => a + s.durationSec, 0).toFixed(2) + "s");

await prisma.$disconnect();
