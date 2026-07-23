// scripts/make-villa-short.mts — 컷 계획서 → 쇼츠 (재단·검수·업로드·대본·생성)
//
//   npx tsx scripts/plan-villa-cuts.mts "<원본.mp4>" --out plan.json     # ① 컷 자동 설계
//   npx tsx scripts/make-villa-short.mts <villaId> "<원본.mp4>" --plan plan.json   # ② 여기
//     단계만 돌리기: --only cut|audit|upload|create  ·  특정 컷만: --cuts 11,28
//
// 이 스크립트는 **빌라와 무관**하다(M villa M1 전용이던 smoke/m1-30cut.mts의 일반화).
// 렌더도 발행도 하지 않는다 — 렌더는 cron, 발행은 승인 후 publish cron.
//
// ★ 절차·함정은 docs/marketing/video-production-runbook.md 참조.
import "dotenv/config";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import ffmpegStatic from "ffmpeg-static";
import { PrismaClient } from "@prisma/client";
import {
  buildNarrationScript,
  normalizeScript,
  toKoreanReading,
  type NarrationVillaContext,
} from "../lib/youtube/narration";
import { generateShortMeta } from "../lib/youtube/meta";
import { auditClips, formatAuditFindings } from "../lib/youtube/clip-audit";
import { resolveClipPace, type ClipPaceOverride } from "../lib/youtube/pacing";
import { trimOverlaps, type PlannedCut } from "../lib/youtube/cut-planner";

const FFMPEG = ffmpegStatic ?? "ffmpeg";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function bar(s: string) {
  console.log(`\n── ${s} ${"─".repeat(Math.max(0, 56 - s.length))}`);
}
function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 8000) err = err.slice(-8000);
    });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-500)}`))));
  });
}

const villaId = process.argv[2];
const source = process.argv[3];
const planPath = arg("plan") ?? "cut-plan.json";
if (!villaId || !source) {
  console.error('사용법: npx tsx scripts/make-villa-short.mts <villaId> "<원본.mp4>" [--plan plan.json] [--only 단계] [--cuts 1,2]');
  process.exit(1);
}
const only = arg("only");
const onlyCuts = (arg("cuts") ?? "")
  .split(",")
  .map((s) => Number(s.trim()) - 1)
  .filter((n) => Number.isInteger(n) && n >= 0);

const plan = JSON.parse(await fs.readFile(planPath, "utf8")) as { cuts: PlannedCut[] };
// ★ 계획서를 그대로 믿지 않는다 — 손으로 고친 표가 들어올 수 있으므로 겹침을 여기서 다시 깎는다.
const CUTS = trimOverlaps(plan.cuts);
if (CUTS.length !== plan.cuts.length) {
  console.log(`※ 겹치거나 너무 짧은 컷 ${plan.cuts.length - CUTS.length}개를 제외했다(화면 중복 방지)`);
}

const WORK = path.resolve(`cuts-${villaId.slice(-6)}`);
const STATE = path.join(WORK, "state.json");
const fileOf = (i: number) => path.join(WORK, `${String(i + 1).padStart(2, "0")}-${CUTS[i].label}.mp4`);
const targets = () => (onlyCuts.length ? onlyCuts.filter((i) => i < CUTS.length) : CUTS.map((_, i) => i));

interface State {
  keys?: (string | null)[];
  shortId?: string;
}
const loadState = async (): Promise<State> => {
  try {
    return JSON.parse(await fs.readFile(STATE, "utf8")) as State;
  } catch {
    return {};
  }
};
const saveState = async (s: State) => {
  await fs.mkdir(WORK, { recursive: true });
  await fs.writeFile(STATE, JSON.stringify(s, null, 2));
};

// ── ① 재단 ────────────────────────────────────────────────
async function phaseCut() {
  bar(`① 재단 (${CUTS.length}컷)`);
  await fs.access(source);
  await fs.mkdir(WORK, { recursive: true });
  const list = targets();
  let next = 0;
  const worker = async () => {
    for (let t = next++; t < list.length; t = next++) {
      const i = list[t];
      const c = CUTS[i];
      await run(FFMPEG, [
        "-y", "-ss", String(c.src), "-i", source, "-t", String(c.len),
        "-an", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", fileOf(i),
      ]);
      console.log(`  ${String(i + 1).padStart(2)} ${c.label.padEnd(12)} src ${String(c.src).padStart(5)}s +${c.len}s`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

// ── ② 검수(렌더 게이트와 동일) ────────────────────────────
async function phaseAudit(): Promise<number> {
  bar("② 소재 자동 검수");
  const list = targets();
  const { findings, seen } = await auditClips(
    list.map((i) => ({
      path: fileOf(i),
      index: i + 1,
      startSec: 0,
      space: CUTS[i].space,
      note: CUTS[i].note,
      pace: CUTS[i].pace as ClipPaceOverride,
    }))
  );
  for (const s of seen) console.log(`  ${String(s.index).padStart(2)} [${(s.space ?? "?").padEnd(9)}] ${s.summary}`);
  const errors = findings.filter((f) => f.severity === "error");
  console.log(findings.length ? `\n  발견 ${findings.length}건(오류 ${errors.length}):\n${formatAuditFindings(findings)}` : "\n  ✅ 발견 없음");
  return errors.length;
}

// ── ③ R2 업로드 ──────────────────────────────────────────
async function phaseUpload() {
  bar("③ R2 업로드");
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.STORAGE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
    },
  });
  const state = await loadState();
  const keys = state.keys ?? new Array(CUTS.length).fill(null);
  for (let i = 0; i < CUTS.length; i++) {
    if (onlyCuts.length && onlyCuts.includes(i)) keys[i] = null; // 다시 자른 컷은 다시 올린다
    if (keys[i]) continue;
    const key = `youtube-clips/${randomUUID().replace(/-/g, "")}.mp4`;
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.STORAGE_BUCKET_NAME!,
        Key: key,
        Body: await fs.readFile(fileOf(i)),
        ContentType: "video/mp4",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    keys[i] = key;
    await saveState({ ...state, keys });
    console.log(`  ${String(i + 1).padStart(2)} ${CUTS[i].label.padEnd(12)} ${key}`);
  }
}

// ── ④ 대본·메타 → YoutubeShort ────────────────────────────
async function phaseCreate() {
  const prisma = new PrismaClient();
  try {
    const state = await loadState();
    const keys = state.keys ?? [];
    if (keys.length !== CUTS.length || keys.some((k) => !k)) throw new Error("업로드 키가 없다 — upload 먼저");

    const villa = await prisma.villa.findUniqueOrThrow({
      where: { id: villaId },
      select: {
        name: true, nameVi: true, complex: true, bedrooms: true, maxGuests: true,
        beachDistanceM: true, hasPool: true, breakfastAvailable: true,
        features: { select: { featureKey: true } },
      },
    });

    bar("④ 나레이션 대본");
    // 이름은 buildNarrationScript 안에서 한글 읽기로 변환된다(toKoreanReading) — 여기선 원본 그대로 넘긴다.
    const ctx: NarrationVillaContext = {
      villaName: villa.name,
      complex: villa.complex,
      bedrooms: villa.bedrooms,
      hasPool: villa.hasPool,
      beachDistanceM: villa.beachDistanceM,
      clips: CUTS.map((c) => ({ space: c.space, note: c.note, pace: c.pace })),
    };
    const draft = await buildNarrationScript(ctx);
    // 이동 컷 흡수는 clipKinds를 줘야 걸린다(buildNarrationScript는 모르고 정규화한다).
    const clipKinds = CUTS.map((c) => resolveClipPace(c.space, c.note, c.pace).kind);
    const lines = normalizeScript(
      draft.map((l) => ({
        text: l.text,
        parts: l.parts.map((p) => ({ cut: p.clipIndexes.length ? p.clipIndexes[0] + 1 : 0, text: p.text })),
      })),
      CUTS.length,
      clipKinds
    );
    lines.forEach((l, i) => console.log(`  문장${i + 1} "${l.text}"`));

    bar("⑤ 제목·설명·태그");
    const meta = await generateShortMeta({
      name: villa.name, nameVi: villa.nameVi, complex: villa.complex,
      bedrooms: villa.bedrooms, maxGuests: villa.maxGuests, beachDistanceM: villa.beachDistanceM,
      hasPool: villa.hasPool, breakfastAvailable: villa.breakfastAvailable,
      featureKeys: villa.features.map((f) => f.featureKey),
    });
    console.log("  제목:", meta.title);

    bar("⑥ YoutubeShort 생성 (editJobStatus=PENDING)");
    const headline = arg("headline") ?? villa.name;
    const editParams = {
      clips: CUTS.map((c, i) => ({
        key: keys[i]!, startSec: 0, durationSec: Math.min(8, Math.max(2, c.len)),
        space: c.space, note: c.note, pace: c.pace,
      })),
      headline,
      villaId,
      audio: "silent",
      horizontalMode: "crop",
      pacing: true,
      bgm: "soft",
      audit: true,
      narration: { lines },
    };
    const short = await prisma.youtubeShort.create({
      data: {
        villaId, sourceType: "UPLOADED", status: "DRAFT", editJobStatus: "PENDING",
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
        title: meta.title, description: meta.description, tags: meta.tags,
        videoUrl: "", editParamsJson: editParams as never, createdBy: "manual:make-villa-short",
      },
      select: { id: true, status: true, editJobStatus: true },
    });
    await saveState({ ...state, shortId: short.id });
    console.log("  생성:", short.id, "|", short.status, "/", short.editJobStatus);
    console.log("\n다음: cron이 5분 내 픽업 → 렌더 3~7분. 검수 error면 editError에 컷 번호가 남는다.");
  } finally {
    await prisma.$disconnect();
  }
}

if (!only || only === "cut") await phaseCut();
if (!only || only === "audit") {
  const errs = await phaseAudit();
  if (errs > 0 && !only) {
    console.error("\n★ 검수 오류 — 업로드·생성을 중단한다. 계획서에서 그 컷의 src를 옮기고 다시 실행하라.");
    process.exit(1);
  }
}
if (!only || only === "upload") await phaseUpload();
if (!only || only === "create") await phaseCreate();
