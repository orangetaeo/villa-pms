// 프로덕션과 동일 입력으로 로컬 전체 렌더 → 정지 구간이 사라지는지 검증.
import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import ffmpegStatic from "ffmpeg-static";
import { PrismaClient } from "@prisma/client";
import { synthesizeNarration, computeNarrationTimeline, buildIntroSpecs } from "../lib/youtube/narration";
import { renderEditedVideo } from "../lib/youtube/edit";

const prisma = new PrismaClient();
const short = await prisma.youtubeShort.findUniqueOrThrow({
  where: { id: "cmrw7repn0001ukckus07bflt" },
  select: { editParamsJson: true, villa: { select: { name: true, bedrooms: true, hasPool: true, beachDistanceM: true } } },
});
const ep = short.editParamsJson as any;

const synth = await synthesizeNarration(ep.narration.lines);
const tl = computeNarrationTimeline({
  lines: synth.map((s) => ({ durationSec: s.durationSec, parts: s.parts })),
  transitionSec: 0.4, minSegmentSec: 2, ctaMinSec: 2.8,
});

const wavDir = "smoke/wav2";
await fs.mkdir(wavDir, { recursive: true });
const wavPaths: string[] = [];
for (let i = 0; i < synth.length; i++) {
  const p = path.resolve(wavDir, `n-${i}.wav`);
  await fs.writeFile(p, synth[i].wav);
  wavPaths.push(p);
}

// R2에서 받아둔 클립을 그대로 사용(서버와 동일 입력)
const local = tl.clipDurations.map((d, i) => ({
  path: path.resolve(`smoke/r2-${String(i).padStart(2, "0")}.mp4`),
  startSec: 0,
  durationSec: d,
}));
console.log("컷 길이:", tl.clipDurations.map((d) => d.toFixed(2)).join(", "), "| CTA", tl.ctaDurationSec.toFixed(2));

const rendered = await renderEditedVideo(local, {
  headline: short.villa!.name,
  villaName: "푸꾸옥 쏘나씨",
  audio: "silent",
  horizontalMode: "crop",
  introSpecs: buildIntroSpecs({
    villaName: short.villa!.name,
    bedrooms: short.villa!.bedrooms,
    hasPool: short.villa!.hasPool,
    beachDistanceM: short.villa!.beachDistanceM,
    clips: [],
  }),
  introHoldSec: tl.lineOffsets[0] + synth[0].durationSec + 0.4,
  ctaDurationSec: tl.ctaDurationSec,
  narration: { wavPaths, offsetsSec: tl.lineOffsets },
  subtitles: tl.subtitles.filter((s) => !s.isCta).map(({ text, fromSec, toSec }) => ({ text, fromSec, toSec })),
});

await fs.writeFile("smoke/repro.mp4", rendered.mp4);
console.log("렌더 완료:", rendered.durationSec, "초");

console.log("\n=== 정지 구간 검사 ===");
let prev: string | null = null;
let frozen = 0;
for (let t = 24; t <= 40; t += 1) {
  const f = `smoke/rp-${t}.jpg`;
  spawnSync(ffmpegStatic!, ["-y", "-ss", String(t), "-i", "smoke/repro.mp4", "-frames:v", "1", "-vf", "scale=120:-1", "-q:v", "6", f], { encoding: "utf8" });
  const h = createHash("md5").update(readFileSync(f)).digest("hex").slice(0, 8);
  const same = h === prev;
  if (same) frozen++;
  console.log("  " + String(t).padStart(2) + "s " + h + (same ? "  ← 동일" : ""));
  prev = h;
}
console.log(frozen === 0 ? "\n✅ 정지 없음 — 수정이 원인을 맞혔다" : `\n★ 정지 ${frozen}구간 — 원인이 다른 데 있다`);

await prisma.$disconnect();
