// probeVideoFile 회귀 테스트 (villa-clip-narration)
//
// ★ 왜 이 테스트가 있는가 (2026-07-22 실측 사고):
//   `-show_entries ... stream_side_data=rotation` 문법은 ffprobe-static이 번들하는 **4.0.2에서
//   지원되지 않아 exit 1로 죽는다**("No match for section 'stream_side_data'").
//   probeVideoFile은 실패 시 null을 반환하므로, 그 상태로 배포됐다면 **모든 클립 업로드가
//   UPLOAD_NOT_FOUND_OR_INVALID로 거부**됐을 것이다. 순수함수 유닛 테스트로는 절대 안 잡힌다 —
//   실제 ffprobe 바이너리를 실제 파일에 돌려야만 드러난다.
//
// 그래서 이 테스트는 ffmpeg-static으로 테스트 영상을 즉석 생성해 실제 probe 경로를 통과시킨다.
// 외부 고정 파일에 의존하지 않으므로 CI·다른 머신에서도 그대로 돈다.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import ffmpegStatic from "ffmpeg-static";
import { probeVideoFile } from "./villa-clip";

const FFMPEG: string = ffmpegStatic ?? "ffmpeg";
let workDir = "";

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(err.slice(-400)))));
  });
}

/** 지정 해상도·길이의 무음 테스트 영상 생성. */
async function makeVideo(name: string, w: number, h: number, sec: number): Promise<string> {
  const out = path.join(workDir, name);
  await run([
    "-y",
    "-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=30:duration=${sec}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-t", String(sec),
    out,
  ]);
  return out;
}

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "villa-clip-probe-"));
}, 120_000);

afterAll(async () => {
  if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
});

describe("probeVideoFile (실제 ffprobe 바이너리)", () => {
  it("세로 영상의 길이·해상도를 읽는다 — null이면 업로드가 전부 거부된다", async () => {
    const f = await makeVideo("portrait.mp4", 540, 960, 3);
    const r = await probeVideoFile(f);
    expect(r).not.toBeNull();
    expect(r!.width).toBe(540);
    expect(r!.height).toBe(960);
    expect(r!.durationSec).toBeGreaterThan(2.5);
    expect(r!.durationSec).toBeLessThan(3.6);
  }, 120_000);

  it("가로 영상도 읽는다(짧은 변 판정용)", async () => {
    const f = await makeVideo("landscape.mp4", 1280, 720, 2);
    const r = await probeVideoFile(f);
    expect(r).not.toBeNull();
    expect(Math.min(r!.width, r!.height)).toBe(720);
  }, 120_000);

  it("영상이 아닌 파일은 null (위장·손상 차단)", async () => {
    const bogus = path.join(workDir, "not-a-video.mp4");
    await fs.writeFile(bogus, Buffer.from("이건 영상이 아니라 그냥 텍스트다"));
    await expect(probeVideoFile(bogus)).resolves.toBeNull();
  }, 60_000);

  it("존재하지 않는 파일은 null", async () => {
    await expect(probeVideoFile(path.join(workDir, "nope.mp4"))).resolves.toBeNull();
  }, 60_000);
});
