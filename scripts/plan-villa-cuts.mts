// scripts/plan-villa-cuts.mts — 워크스루 원본 하나 → 컷 표 자동 설계 (Vision 샘플링)
//
//   npx tsx scripts/plan-villa-cuts.mts "<원본.mp4>" [--step 2] [--cuts 30] [--out plan.json]
//
// 하는 일: 원본을 step초 간격으로 훑어 각 프레임의 공간·피사체·문제(변기·촬영자·쓰레기통)를 판정하고,
//   lib/youtube/cut-planner.ts 규칙으로 컷 표를 만든다. 사람이 콘택트시트를 넘겨보며 고르던 일을 대체한다.
//
// ★ 왜 필요한가: M villa M1 한 편에서 컷을 손으로 고르다 변기 4건·화면 중복 1건·피사체 누락 2건이 나왔다.
//   원본이 바뀌면 그 노동과 실수가 그대로 반복된다.
// ★ 비용: 9분 영상을 2초 간격이면 270프레임. 8장씩 묶어 34회 호출(gemini-2.5-flash) — 편당 몇 센트.
import "dotenv/config";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { z } from "zod";
import { extractJsonFromAIResponse } from "../lib/ai-utils";
import { SPACE_LABEL } from "../lib/youtube/clip-audit";
import { planCuts, cutsToMarkdown, type FrameVerdict } from "../lib/youtube/cut-planner";

const FFMPEG = ffmpegStatic ?? "ffmpeg";
const FFPROBE = ffprobeStatic.path;
const MODEL = process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const BATCH = 8; // 한 번에 판정할 프레임 수(토큰·정확도 균형)

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString().slice(-2000)));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} ${c}: ${err.slice(-400)}`))));
  });
}

const verdictSchema = z.object({
  frames: z.array(
    z.object({
      i: z.number(),
      space: z.string(),
      summary: z.string(),
      problems: z.array(z.string()).max(4).optional(),
    })
  ),
});

async function judgeBatch(frames: { i: number; b64: string; atSec: number }[]): Promise<FrameVerdict[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");

  const prompt = [
    "너는 빌라 홍보 영상 편집자다. 아래 프레임들은 한 빌라 워크스루 영상에서 순서대로 뽑은 것이다.",
    "각 프레임마다 판정해라.",
    "",
    "1. space — 실제로 보이는 공간을 하나 고른다:",
    `   ${Object.keys(SPACE_LABEL).join(" / ")}`,
    "   복도·계단·문간·이동 중이면 ETC.",
    "2. summary — 보이는 것을 한국어 한 문장으로(그대로 자막 메모로 쓴다). 예: '원목 식탁과 다이닝 공간'",
    "3. problems — **홍보 영상에 나가면 곤란한 것**만(한국어). 없으면 빈 배열.",
    "   적을 것: 변기, 쓰레기통·청소도구, 거울에 비친 촬영자, 식별 가능한 사람 얼굴, 심한 흔들림·초점 나감",
    "   ★ 적지 말 것: 구도가 아쉽다 같은 취향 평가.",
    "",
    `출력은 JSON만: {"frames":[{"i":0,"space":"KITCHEN","summary":"원목 식탁","problems":[]}]}`,
    `i는 아래 순서(0부터 ${frames.length - 1}까지) 그대로.`,
  ].join("\n");

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            ...frames.map((f) => ({ inlineData: { mimeType: "image/jpeg", data: f.b64 } })),
          ],
        },
      ],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = extractJsonFromAIResponse<Record<string, unknown>>(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  if (!raw) throw new Error("판정 JSON 추출 실패");
  const parsed = verdictSchema.parse(raw);

  return parsed.frames
    .filter((f) => f.i >= 0 && f.i < frames.length)
    .map((f) => ({
      atSec: frames[f.i].atSec,
      space: Object.keys(SPACE_LABEL).includes(f.space.toUpperCase()) ? f.space.toUpperCase() : null,
      summary: f.summary.trim(),
      problems: f.problems ?? [],
    }));
}

// ── 실행 ──────────────────────────────────────────────────
const source = process.argv[2];
if (!source) {
  console.error('사용법: npx tsx scripts/plan-villa-cuts.mts "<원본.mp4>" [--step 2] [--cuts 30] [--out plan.json]');
  process.exit(1);
}
const step = Number(arg("step", "2"));
const maxCuts = Number(arg("cuts", "30"));
const outPath = arg("out", "cut-plan.json")!;

const durOut = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source]);
const duration = Number(durOut.trim());
console.log(`원본 ${path.basename(source)} — ${duration.toFixed(0)}초, ${step}초 간격 샘플링`);

const workDir = path.join(os.tmpdir(), `cut-plan-${randomUUID().slice(0, 8)}`);
await fs.mkdir(workDir, { recursive: true });

try {
  // ① 프레임 추출 — 한 번의 ffmpeg 호출로 전부(fps 필터)
  await run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", source,
    "-vf", `fps=1/${step},scale=360:-1`,
    "-q:v", "6",
    path.join(workDir, "f-%05d.jpg"),
  ]);
  const files = (await fs.readdir(workDir)).filter((f) => f.endsWith(".jpg")).sort();
  console.log(`프레임 ${files.length}장 추출 → 판정 시작(${Math.ceil(files.length / BATCH)}회 호출)`);

  // ② Vision 판정 — 배치로
  const verdicts: FrameVerdict[] = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH);
    const frames = await Promise.all(
      chunk.map(async (f, k) => ({
        i: k,
        atSec: Number((((i + k) * step) + step / 2).toFixed(2)),
        b64: (await fs.readFile(path.join(workDir, f))).toString("base64"),
      }))
    );
    try {
      verdicts.push(...(await judgeBatch(frames)));
    } catch (e) {
      console.error(`  배치 ${i / BATCH + 1} 판정 실패(건너뜀): ${(e as Error).message}`);
    }
    process.stdout.write(`\r  판정 ${Math.min(i + BATCH, files.length)}/${files.length}`);
  }
  console.log("");

  // ③ 컷 표 설계
  const cuts = planCuts(verdicts, { stepSec: step, maxCuts });
  const dirty = verdicts.filter((v) => v.problems.length > 0);
  console.log(`\n문제 구간 ${dirty.length}곳 회피(변기·촬영자·쓰레기통 등) → 컷 ${cuts.length}개 설계\n`);
  console.log(cutsToMarkdown(cuts));

  await fs.writeFile(
    outPath,
    JSON.stringify({ source: path.basename(source), durationSec: duration, stepSec: step, cuts, dirty }, null, 2)
  );
  console.log(`\n계획 저장: ${outPath}`);
  console.log("다음: scripts/make-villa-short.mts <villaId> <원본> --plan " + outPath);
} finally {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
}
