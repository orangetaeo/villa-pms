// 진단: 컷별 [요청 길이] vs [normalizeClip 산출 길이] — 어디서 타임라인이 어긋나는지 정확히 본다.
import "dotenv/config";
import { spawnSync } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { PrismaClient } from "@prisma/client";
import { synthesizeNarration, computeNarrationTimeline } from "../lib/youtube/narration";

const W = 1080, H = 1920, FPS = 30;
const dur = (f: string) =>
  parseFloat(
    spawnSync(ffprobeStatic.path, ["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1", f], { encoding: "utf8" }).stdout.trim()
  );

const prisma = new PrismaClient();
const short = await prisma.youtubeShort.findUniqueOrThrow({
  where: { id: "cmrw7repn0001ukckus07bflt" },
  select: { editParamsJson: true },
});
const ep = short.editParamsJson as any;
const synth = await synthesizeNarration(ep.narration.lines);
const tl = computeNarrationTimeline({
  lines: synth.map((s) => ({ durationSec: s.durationSec, parts: s.parts })),
  transitionSec: 0.4, minSegmentSec: 2, ctaMinSec: 2.8,
});

const files = ["00-entrance","01-pool","02-facade","03-living","04-dining","05-kitchen","06-bed1","07-bed2","08-twin","09-bath","10-balcony"];
const MAX_SLOWDOWN = 1.6;
const base = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p[vout]`;

console.log("컷  요청     원본     산출     차이   감속");
const produced: number[] = [];
for (let i = 0; i < files.length; i++) {
  const src = `smoke/clip-${files[i]}.mp4`;
  const want = tl.clipDurations[i];
  const avail = dur(src);
  let filter = `[0:v]` + base;
  let readSec = want;
  let factor = 1;
  if (avail > 0.1 && want > avail + 0.05) {
    factor = Math.min(MAX_SLOWDOWN, want / avail);
    filter = `[0:v]setpts=${factor.toFixed(4)}*PTS[slow];[slow]` + base;
    readSec = avail;
  }
  const out = `smoke/seg-${i}.mp4`;
  const r = spawnSync(ffmpegStatic, ["-y","-ss","0.000","-t",readSec.toFixed(3),"-i",src,"-filter_complex",filter,"-map","[vout]","-an","-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p","-r",String(FPS), out], { encoding: "utf8" });
  if (r.status !== 0) { console.log(i+1, "실패", r.stderr.slice(-200)); continue; }
  const got = dur(out);
  produced.push(got);
  const diff = got - want;
  console.log(
    String(i + 1).padStart(2),
    want.toFixed(2).padStart(7), avail.toFixed(2).padStart(8), got.toFixed(2).padStart(8),
    (diff >= 0 ? "+" : "") + diff.toFixed(2).padStart(5),
    factor > 1 ? `  ${factor.toFixed(2)}x` : ""
  );
}
const T = 0.4;
const timelineTotal = tl.clipDurations.reduce((a, b) => a + b, 0) + tl.ctaDurationSec - 11 * T;
const actualTotal = produced.reduce((a, b) => a + b, 0) + tl.ctaDurationSec - 11 * T;
console.log("\n타임라인 기준 총길이:", timelineTotal.toFixed(2) + "s");
console.log("실제 산출 총길이   :", actualTotal.toFixed(2) + "s");
console.log("어긋남             :", (actualTotal - timelineTotal).toFixed(2) + "s");

await prisma.$disconnect();
