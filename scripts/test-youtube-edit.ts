// scripts/test-youtube-edit.ts — 유튜브 직접 촬영 자동 편집 파이프라인 스모크(DB·R2 접근 없음)
//
// ffmpeg로 합성한 테스트 클립 3개(가로 1개 + 세로 2개, 각 6s, 오디오 포함) → renderEditedVideo(로컬 경로)
//   → ffprobe로 1080×1920·h264/aac·15~60s 검증 + 산출물 스크래치패드 저장.
//   crop(무음) / blur(앰비언트) 두 모드 확인. 자막·인트로·워터마크 육안 확인용 MP4/포스터 저장.
//
// 실행: npx tsx scripts/test-youtube-edit.ts
import { spawnSync } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { renderEditedVideo, type RenderOpts } from "@/lib/youtube/edit";

const FFMPEG = ffmpegStatic ?? "ffmpeg";
const OUT_DIR =
  process.env.SMOKE_OUT_DIR ?? path.join(os.tmpdir(), "yt-edit-smoke-out");

// 테스트 클립 스펙 — 가로 1 + 세로 2(정규화·crop/blur 경로 실사용), 각 6s.
const CLIP_SPEC = [
  { name: "landscape", w: 1280, h: 720, testsrc: "testsrc" },
  { name: "portrait1", w: 1080, h: 1920, testsrc: "smptebars" },
  { name: "portrait2", w: 720, h: 1280, testsrc: "testsrc2" },
];
const CLIP_DUR = 6;

/** 나레이션 대역 테스트용 WAV(사인파) 생성 — TTS 없이 오디오 배치·BGM 믹스 경로만 검증한다. */
function makeWav(durationSec: number, outPath: string): void {
  const res = spawnSync(
    FFMPEG,
    [
      "-y",
      "-f", "lavfi",
      "-i", `sine=frequency=320:duration=${durationSec}:sample_rate=24000`,
      "-ac", "1",
      "-c:a", "pcm_s16le",
      outPath,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  if (res.status !== 0) throw new Error(`WAV 생성 실패: ${res.stderr || res.error}`);
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
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

function makeClip(spec: (typeof CLIP_SPEC)[number], outPath: string): void {
  const res = spawnSync(
    FFMPEG,
    [
      "-y",
      "-f", "lavfi",
      "-i", `${spec.testsrc}=size=${spec.w}x${spec.h}:rate=30:duration=${CLIP_DUR}`,
      "-f", "lavfi",
      "-i", `sine=frequency=440:duration=${CLIP_DUR}`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-t", String(CLIP_DUR),
      outPath,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  if (res.status !== 0) throw new Error(`클립 생성 실패(${spec.name}): ${res.stderr || res.error}`);
}

let failures = 0;
function check(label: string, cond: boolean, detail: string) {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${mark}] ${label} — ${detail}`);
}

async function runOne(
  label: string,
  clipPaths: string[],
  opts: RenderOpts,
  clipMeta?: { space?: string; note?: string; durationSec?: number }[],
  /** 이 시나리오에서 기대하는 최소 길이(초). 짧은 나레이션 케이스는 15초 규칙을 적용하지 않는다 */
  minSec = 15
): Promise<void> {
  console.log(`\n▶ ${label} (audio=${opts.audio}, horizontalMode=${opts.horizontalMode})`);
  const t0 = Date.now();
  const rendered = await renderEditedVideo(
    clipPaths.map((p, i) => ({
      path: p,
      startSec: 0,
      durationSec: clipMeta?.[i]?.durationSec ?? CLIP_DUR,
      space: clipMeta?.[i]?.space ?? null,
      note: clipMeta?.[i]?.note ?? null,
    })),
    opts
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const mp4File = path.join(OUT_DIR, `yt-edit-${label}.mp4`);
  const posterFile = path.join(OUT_DIR, `yt-edit-${label}-poster.jpg`);
  await fs.writeFile(mp4File, rendered.mp4);
  await fs.writeFile(posterFile, rendered.poster);

  const probe = ffprobe(mp4File);
  const v = probe.streams?.find((s) => s.codec_type === "video");
  const a = probe.streams?.find((s) => s.codec_type === "audio");
  const durSec = parseFloat(probe.format?.duration ?? "0");
  const sizeMB = rendered.mp4.length / 1024 / 1024;

  console.log(`  MP4: ${mp4File}`);
  console.log(`  포스터: ${posterFile} (${elapsed}s 소요)`);
  check("해상도 1080×1920", v?.width === 1080 && v?.height === 1920, `${v?.width}×${v?.height}`);
  check("비디오 코덱 h264", v?.codec_name === "h264", `${v?.codec_name}`);
  check("오디오 코덱 aac", a?.codec_name === "aac", `${a?.codec_name ?? "없음"}`);
  check("프레임레이트 30fps", v?.r_frame_rate === "30/1", `${v?.r_frame_rate}`);
  check(`길이 ${minSec}~180초`, durSec >= minSec && durSec <= 180, `${durSec.toFixed(2)}s`);
  check("용량 200MB 미만", sizeMB < 200, `${sizeMB.toFixed(2)}MB`);
  check("포스터 생성", rendered.poster.length > 0, `${(rendered.poster.length / 1024).toFixed(0)}KB`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log("=== 유튜브 편집 파이프라인 스모크 (DB·R2 없음) ===");
  console.log(`ffmpeg:  ${FFMPEG}`);
  console.log(`ffprobe: ${ffprobeStatic.path}`);

  const workDir = path.join(os.tmpdir(), `yt-edit-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const clipPaths: string[] = [];
    for (const spec of CLIP_SPEC) {
      const p = path.join(workDir, `${spec.name}.mp4`);
      makeClip(spec, p);
      clipPaths.push(p);
    }
    console.log(`테스트 클립 ${clipPaths.length}개 생성: ${CLIP_SPEC.map((s) => `${s.name}(${s.w}×${s.h})`).join(", ")}`);

    const subtitles = [
      { text: "푸꾸옥 프라이빗 풀빌라", fromSec: 2, toSec: 6 },
      { text: "한국어 상담으로 편하게", fromSec: 8, toSec: 13 },
    ];

    await runOne("crop-silent", clipPaths, {
      headline: "물 위에 뜬\n우리 가족 별장",
      villaName: "빌라고 오션뷰",
      subtitles,
      audio: "silent",
      horizontalMode: "crop",
    });

    await runOne("blur-ambient", clipPaths, {
      headline: "노을이 지는\n인피니티 풀",
      villaName: "빌라고 선셋",
      subtitles,
      audio: "ambient",
      horizontalMode: "blur",
    });

    // ── 나레이션 + 컷 속도 조절 + 배경음 (video-pacing-quality) ──
    //   실제 발행 경로와 같은 조합이다: 문장 WAV를 오프셋 배치하고, 실측 세그먼트 길이로
    //   자막·오프셋을 재계산하며, 그 밑에 번들 BGM을 깐다. 필터그래프가 가장 복잡한 경로라
    //   여기가 통과하면 프로덕션 렌더가 문법 오류로 죽지 않는다.
    const narrLines = [
      {
        durationSec: 5.2,
        parts: [
          { clipIndexes: [0], text: "야자수에 둘러싸인 이층 빌라예요" },
          { clipIndexes: [1], text: "안으로 들어가 볼까요" },
        ],
      },
      { durationSec: 3.4, parts: [{ clipIndexes: [2], text: "햇살이 가득 드는 넓은 거실" }] },
      { durationSec: 2.6, parts: [{ clipIndexes: [], text: "카카오톡에서 빌라고를 검색해 보세요" }] },
    ];
    const wavPaths: string[] = [];
    for (let i = 0; i < narrLines.length; i++) {
      const wp = path.join(workDir, `narr-${i}.wav`);
      makeWav(narrLines[i].durationSec, wp);
      wavPaths.push(wp);
    }

    await runOne(
      "narration-pacing-bgm",
      clipPaths,
      {
        headline: "푸꾸옥에서\n하루쯤은 우리끼리",
        villaName: "빌라고 오션뷰",
        audio: "silent",
        horizontalMode: "blur",
        introSpecs: ["침실 세 개", "프라이빗 수영장", "해변 바로 앞"],
        introHoldSec: 4.5,
        bgm: "soft",
        pacing: true,
        // offsetsSec는 재동기화로 덮어써진다 — lines가 있으면 실측 기준으로 다시 계산된다.
        narration: { wavPaths, offsetsSec: [0.15, 6, 10], lines: narrLines },
        ctaDurationSec: 3.0,
      },
      [
        { space: "EXTERIOR", note: "야자수 정원", durationSec: 4 },
        { space: "ETC", note: "현관으로 들어가는 복도", durationSec: 3 },
        { space: "LIVING", note: "통창 거실", durationSec: 4 },
      ],
      10 // 짧은 대본이라 12초대가 정상 — 필터그래프 검증이 목적이다
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n=== 결과: ${failures === 0 ? "전체 PASS ✅" : `${failures}건 FAIL ❌`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("스모크 실패:", e);
  process.exit(1);
});
