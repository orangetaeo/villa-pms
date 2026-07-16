// scripts/test-instagram-reels.ts — 릴스 MP4 생성 스모크(DB 접근 없음)
//
// 임의 크기 이미지 4장(sharp 합성) → buildReelVideo → MP4를 스크래치패드에 저장 →
// ffprobe(ffprobe-static)로 해상도(1080×1920)·길이·코덱(h264/aac) 검증. 무음/앰비언트 둘 다 확인.
//
// 실행: npx tsx scripts/test-instagram-reels.ts
import { spawnSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import ffprobeStatic from "ffprobe-static";
import { buildReelVideo, computeReelTiming, type ReelAudioMode } from "@/lib/instagram/reels";

const OUT_DIR =
  process.env.SMOKE_OUT_DIR ??
  "C:/Users/heros/AppData/Local/Temp/claude/c--Projects-villa-pms/a2b9f00c-74a7-489a-b46c-257d8fe94d44/scratchpad";

// 정규화 경로를 실제로 태우기 위해 서로 다른 크기·비율의 임의 이미지 4장.
const SPEC = [
  { w: 1600, h: 1200, rgb: { r: 12, g: 148, b: 136 } }, // 가로형
  { w: 1080, h: 1920, rgb: { r: 245, g: 158, b: 11 } }, // 세로형(정타겟)
  { w: 900, h: 900, rgb: { r: 17, g: 94, b: 89 } }, // 정사각
  { w: 1280, h: 720, rgb: { r: 255, g: 249, b: 240 } }, // 와이드
];

async function makeImage(w: number, h: number, rgb: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: rgb } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  duration?: string;
}
interface ProbeResult {
  streams?: ProbeStream[];
  format?: { duration?: string; format_name?: string };
}

function ffprobe(file: string): ProbeResult {
  const res = spawnSync(
    ffprobeStatic.path,
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  if (res.status !== 0) throw new Error(`ffprobe 실패: ${res.stderr || res.error}`);
  return JSON.parse(res.stdout) as ProbeResult;
}

let failures = 0;
function check(label: string, cond: boolean, detail: string) {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${mark}] ${label} — ${detail}`);
}

async function runOne(audio: ReelAudioMode, frames: Buffer[]) {
  console.log(`\n▶ audio=${audio}`);
  const t0 = Date.now();
  const video = await buildReelVideo(frames, { audio });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const file = path.join(OUT_DIR, `reel-smoke-${audio}.mp4`);
  await fs.writeFile(file, video.mp4);

  const timing = computeReelTiming(frames.length);
  const probe = ffprobe(file);
  const v = probe.streams?.find((s) => s.codec_type === "video");
  const a = probe.streams?.find((s) => s.codec_type === "audio");
  const durSec = parseFloat(probe.format?.duration ?? v?.duration ?? "0");
  const sizeMB = video.mp4.length / 1024 / 1024;

  console.log(`  파일: ${file} (${elapsed}s 소요)`);
  check("해상도 1080×1920", v?.width === 1080 && v?.height === 1920, `${v?.width}×${v?.height}`);
  check("비디오 코덱 h264", v?.codec_name === "h264", `${v?.codec_name}`);
  check("오디오 코덱 aac", a?.codec_name === "aac", `${a?.codec_name ?? "없음"}`);
  check("프레임레이트 30fps", v?.r_frame_rate === "30/1", `${v?.r_frame_rate}`);
  check("길이 10~16초", durSec >= 9.5 && durSec <= 16.5, `${durSec.toFixed(2)}s (예상 ${timing.totalSec.toFixed(2)}s)`);
  check("용량 100MB 미만", sizeMB < 100, `${sizeMB.toFixed(2)}MB`);
  check("프레임 수 반영", video.frameCount === frames.length, `${video.frameCount}장`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log("=== 릴스 MP4 스모크 (DB 없음) ===");
  console.log(`ffprobe: ${ffprobeStatic.path}`);

  const frames = await Promise.all(SPEC.map((s) => makeImage(s.w, s.h, s.rgb)));
  console.log(`임의 이미지 ${frames.length}장 생성 (크기: ${SPEC.map((s) => `${s.w}×${s.h}`).join(", ")})`);

  const timing = computeReelTiming(frames.length);
  console.log(`타이밍: 프레임당 ${timing.perFrameSec.toFixed(2)}s, 전환 ${timing.transitionSec}s, 총 ${timing.totalSec.toFixed(2)}s`);

  await runOne("silent", frames);
  await runOne("ambient", frames);

  console.log(`\n=== 결과: ${failures === 0 ? "전체 PASS ✅" : `${failures}건 FAIL ❌`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("스모크 실패:", e);
  process.exit(1);
});
