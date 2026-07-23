// M villa M1 30컷 투어 쇼츠 재생성 — 정본 스토리보드: docs/marketing/storyboard-m-villa-m1.md
//
//   npx tsx smoke/m1-30cut.mts cut      # 원본에서 30컷 재단 (로컬)
//   npx tsx smoke/m1-30cut.mts audit    # 렌더 전 자동 검수를 **로컬에서 미리** 돌린다
//   npx tsx smoke/m1-30cut.mts upload   # R2 업로드 (키를 state.json에 저장)
//   npx tsx smoke/m1-30cut.mts create   # 대본·메타 생성 → YoutubeShort(PENDING) → cron이 렌더
//   npx tsx smoke/m1-30cut.mts all      # 위 넷을 순서대로(검수 error면 중단)
//
// ★ 왜 검수를 먼저 로컬에서 도는가: 렌더 게이트(edit.ts params.audit)에서 걸리면 cron 한 사이클
//   (업로드 300MB + 렌더 대기)을 통째로 버린다. 재단 직후 프레임 3장만 보면 같은 판정을 몇 분 만에 얻는다.
// ★ 렌더도 발행도 여기서 하지 않는다. 렌더는 cron, 발행은 승인 후 publish cron.
import "dotenv/config";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import ffmpegStatic from "ffmpeg-static";
import { PrismaClient } from "@prisma/client";
import { buildNarrationScript, normalizeScript, type NarrationVillaContext } from "../lib/youtube/narration";
import { generateShortMeta } from "../lib/youtube/meta";
import { auditClips, formatAuditFindings } from "../lib/youtube/clip-audit";
import { resolveClipPace, type ClipPaceOverride } from "../lib/youtube/pacing";

const VILLA_ID = "cmru4fggf02bko80fp3nxkn00"; // M villa M1 · Sonasea
const SOURCE = path.resolve("M villa M1.mp4"); // 540초 1080×1920 세로 워크스루(git 미추적)
const WORK = path.resolve("smoke/m1-cuts");
const STATE = path.join(WORK, "state.json");
const FFMPEG = ffmpegStatic ?? "ffmpeg";
const HEADLINE = "해변 바로 앞\n네 침실 프라이빗 풀빌라";
/**
 * 나레이션에서 부를 이름 — **한글 표기**로 준다.
 * ★ 빌라명을 그대로("M villa M1") 넘기면 모델이 문장에 영문을 그대로 쓰고, 한국어 TTS가
 *   그걸 어색하게 읽는다(대본 규칙에도 "숫자·영문 금지"가 있는데 이름만은 예외가 되어 새어 나온다).
 *   화면(인트로 카드·제목)은 실제 이름을 그대로 쓰므로 표기가 어긋나지 않는다.
 */
const NARRATION_VILLA_NAME = "엠빌라 엠원";

interface Cut {
  label: string;
  src: number;
  len: number;
  pace: ClipPaceOverride;
  space: string;
  note: string;
}

/** 정본 스토리보드 30컷. src/len은 원본 `M villa M1.mp4` 기준 초. */
const CUTS: Cut[] = [
  { label: "beach", src: 6, len: 6, pace: "slow", space: "EXTERIOR", note: "야자수 너머 해변, 빌라 바로 앞이 바다" },
  { label: "to-gate", src: 17, len: 8, pace: "fast", space: "EXTERIOR", note: "해변에서 빌라 입구로 이동" },
  { label: "gate", src: 25, len: 6, pace: "slow", space: "EXTERIOR", note: "빌라 정문으로 들어서는 순간" },
  { label: "to-pool", src: 33, len: 8, pace: "fast", space: "ETC", note: "진입로를 지나 안뜰로 이동" },
  { label: "pool", src: 43, len: 8, pace: "slow", space: "POOL", note: "단독 사용 프라이빗 수영장과 이 층 건물 전체가 한눈에" },
  { label: "to-indoor", src: 70, len: 8, pace: "fast", space: "ETC", note: "수영장에서 실내로 이동" },
  // ★ 컷7·8은 2026-07-23 완성본 지적으로 시작 지점을 옮겼다(88→80, 120→96). 스토리보드 참조.
  { label: "dining", src: 80, len: 8, pace: "slow", space: "KITCHEN", note: "원목 식탁과 다이닝 공간" },
  { label: "to-living", src: 96, len: 7, pace: "fast", space: "ETC", note: "주방 조리대를 지나 거실로 이동" },
  // ★ len 6(=137초까지): 이 컷이 최대로 읽을 수 있는 원본을 컷10 시작 지점 앞에서 끊는다.
  //   안 그러면 나레이션이 길 때 컷9가 137초 뒤까지 읽어 컷10과 **같은 장면이 두 번** 나간다.
  { label: "living", src: 131, len: 6, pace: "slow", space: "LIVING", note: "큰 소파와 티브이, 천장 선풍기가 있는 거실" },
  // ★ 변기 회피(자동 검수 오류): 이 욕실은 143.5초부터 프레임 하단에 변기가 들어온다
  //   (144.3초 프레임에서 검수가 잡아냈다) → 문을 들어서는 139.6~143.8만 쓴다.
  // ★ 겹침 수정(테오 2026-07-23 "26~27초 영상 중복"): 컷10이 138~141.5를 읽고 컷11이 139.6부터
  //   시작해 1.9초가 두 번 나갔다. 이동 컷은 화면 1.9초 상한(원본 ≈3.5초)이므로
  //   **끝 지점이 다음 컷 시작(139.6)을 넘지 않도록** 137.0~139.6만 준다.
  { label: "to-bath1", src: 137, len: 2.6, pace: "fast", space: "ETC", note: "거실에서 일 층 방 욕실로 이동" },
  { label: "bath1", src: 139.6, len: 4.2, pace: "slow", space: "BATHROOM", note: "일 층 방에 딸린 욕실, 대리석 세면대와 거울" },
  { label: "to-room1", src: 167, len: 6, pace: "fast", space: "ETC", note: "욕실에서 일 층 침실로 이동" },
  { label: "room1", src: 174, len: 7, pace: "slow", space: "BEDROOM", note: "일 층 침실, 통창 밖이 바로 수영장" },
  { label: "to-laundry", src: 195, len: 6, pace: "fast", space: "ETC", note: "일 층 방에서 세탁실로 이동" },
  { label: "laundry", src: 203, len: 5, pace: "slow", space: "ETC", note: "세탁기와 빨래 바구니가 있는 세탁실" },
  { label: "stairs", src: 211, len: 8, pace: "fast", space: "ETC", note: "계단을 올라 이 층으로 이동" },
  { label: "vanity2", src: 223, len: 7, pace: "slow", space: "BEDROOM", note: "이 층 안방 화장대와 붙박이 옷장" },
  // ★ 240~261초는 변기 구간 → 욕조·샤워가 나오는 262부터. 이동 컷도 실제 퇴장 시점(270)으로 옮김.
  { label: "bath2", src: 262, len: 8, pace: "slow", space: "BATHROOM", note: "이 층 안방 욕실, 샤워부스와 욕조" },
  { label: "out-bath2", src: 270, len: 6, pace: "fast", space: "ETC", note: "욕실에서 나와 침실로 이동" },
  { label: "bed2", src: 291, len: 7, pace: "slow", space: "BEDROOM", note: "이 층 안방 킹베드와 티브이" },
  { label: "balcony2", src: 328, len: 8, pace: "slow", space: "BALCONY", note: "베란다를 열면 내려다보이는 수영장과 바다" },
  { label: "to-room3", src: 357, len: 7, pace: "fast", space: "ETC", note: "복도를 지나 다른 방으로 이동" },
  // ★ 373초는 파란 휴지통·초점 흐림, 379초부터 변기 → 세면대가 또렷한 369~372를 쓴다.
  { label: "bath3", src: 369, len: 6, pace: "slow", space: "BATHROOM", note: "둘째 방 욕실, 대리석 세면대와 어메니티" },
  { label: "to-bed3", src: 388, len: 6, pace: "fast", space: "ETC", note: "욕실에서 침실로 이동" },
  { label: "bed3", src: 395, len: 7, pace: "slow", space: "BEDROOM", note: "둘째 방 티브이 선반과 침대" },
  { label: "terrace3", src: 424, len: 8, pace: "slow", space: "BALCONY", note: "둘째 방 테라스에서도 바로 앞이 수영장과 바다" },
  // ★ 450~461초·474초는 변기, 462초는 거울 속 촬영자 → 이동은 444부터, 욕실은 욕조 구간(466)으로.
  { label: "to-twin", src: 444, len: 6, pace: "fast", space: "ETC", note: "복도를 지나 다른 방으로 이동" },
  { label: "bath4", src: 467, len: 5.5, pace: "slow", space: "BATHROOM", note: "셋째 방 욕실, 욕조와 샤워 시설" },
  { label: "twin", src: 482, len: 7, pace: "slow", space: "BEDROOM", note: "싱글 침대 두 개인 트윈룸, 아이들이 쓰기 좋은 방" },
  { label: "final-view", src: 519, len: 8, pace: "slow", space: "BALCONY", note: "마지막으로 베란다에서 내려다본 수영장과 해변" },
];

interface State {
  keys?: (string | null)[];
  shortId?: string;
}

function bar(s: string) {
  console.log(`\n── ${s} ${"─".repeat(Math.max(0, 56 - s.length))}`);
}
const fileOf = (i: number) => path.join(WORK, `${String(i + 1).padStart(2, "0")}-${CUTS[i].label}.mp4`);

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(STATE, "utf8")) as State;
  } catch {
    return {};
  }
}
async function saveState(s: State) {
  await fs.mkdir(WORK, { recursive: true });
  await fs.writeFile(STATE, JSON.stringify(s, null, 2));
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
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-600)}`))));
  });
}

// ── ① 재단 ────────────────────────────────────────────────
async function phaseCut(only: number[]) {
  bar("① 30컷 재단");
  await fs.access(SOURCE); // 없으면 공급자에게 원본 재요청해야 한다
  await fs.mkdir(WORK, { recursive: true });

  const targets = only.length ? only : CUTS.map((_, i) => i);
  const LANES = 4; // 로컬 CPU 기준. 늘려도 인코딩이 병목이라 이득이 적다
  let next = 0;
  const worker = async () => {
    for (let t = next++; t < targets.length; t = next++) {
      const i = targets[t];
      const c = CUTS[i];
      const out = fileOf(i);
      await run(FFMPEG, [
        "-y",
        "-ss", String(c.src), // 재인코딩이므로 -i 앞 -ss여도 프레임 정확
        "-i", SOURCE,
        "-t", String(c.len),
        "-an", // 원본 소리는 쓰지 않는다(나레이션이 대체)
        "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out,
      ]);
      const { size } = await fs.stat(out);
      console.log(`  ${String(i + 1).padStart(2)} ${c.label.padEnd(11)} src ${String(c.src).padStart(3)}s +${c.len}s  ${(size / 1024 / 1024).toFixed(1)}MB`);
    }
  };
  await Promise.all(Array.from({ length: LANES }, worker));
}

// ── ② 로컬 사전 검수 ──────────────────────────────────────
async function phaseAudit(only: number[]): Promise<number> {
  bar("② 소재 자동 검수 (렌더 게이트와 동일 로직)");
  const { findings, seen } = await auditClips(
    CUTS.map((c, i) => ({ c, i }))
      .filter(({ i }) => !only.length || only.includes(i))
      .map(({ c, i }) => ({
      path: fileOf(i),
      index: i + 1,
      startSec: 0, // 이미 잘린 파일이라 파일 첫 프레임이 곧 컷 시작
      space: c.space,
      note: c.note,
      pace: c.pace,
    }))
  );
  for (const s of seen) console.log(`  ${String(s.index).padStart(2)} [${(s.space ?? "?").padEnd(9)}] ${s.summary}`);
  const errors = findings.filter((f) => f.severity === "error");
  if (findings.length) {
    console.log(`\n  발견 ${findings.length}건 (오류 ${errors.length}):\n${formatAuditFindings(findings)}`);
  } else {
    console.log("\n  ✅ 발견 없음");
  }
  return errors.length;
}

// ── ③ R2 업로드 ──────────────────────────────────────────
async function phaseUpload(only: number[]) {
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
    // 컷 번호를 지정하면 그 컷은 **다시 올린다**(재단을 고쳤다는 뜻이므로 기존 키는 낡았다).
    if (only.length && only.includes(i)) keys[i] = null;
    if (keys[i]) {
      console.log(`  ${String(i + 1).padStart(2)} (이미 업로드) ${keys[i]}`);
      continue;
    }
    // 키 형식은 edit.ts CLIP_KEY_RE와 일치해야 한다.
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
    await saveState({ ...state, keys }); // 중간에 끊겨도 이어서 올린다
    console.log(`  ${String(i + 1).padStart(2)} ${CUTS[i].label.padEnd(11)} ${key}`);
  }
}

// ── ④ 대본·메타 → YoutubeShort ────────────────────────────
async function phaseCreate() {
  const prisma = new PrismaClient();
  try {
    const state = await loadState();
    const keys = state.keys ?? [];
    if (keys.length !== CUTS.length || keys.some((k) => !k)) throw new Error("업로드 키가 없습니다 — upload 먼저");

    const villa = await prisma.villa.findUniqueOrThrow({
      where: { id: VILLA_ID },
      select: {
        name: true, nameVi: true, complex: true, bedrooms: true, maxGuests: true,
        beachDistanceM: true, hasPool: true, breakfastAvailable: true,
        features: { select: { featureKey: true } },
      },
    });

    bar("④ 나레이션 대본 (Gemini)");
    const ctx: NarrationVillaContext = {
      villaName: NARRATION_VILLA_NAME, // 음성용 한글 표기(화면 표기는 villa.name 그대로)
      complex: villa.complex,
      bedrooms: villa.bedrooms,
      hasPool: villa.hasPool,
      beachDistanceM: villa.beachDistanceM,
      clips: CUTS.map((c) => ({ space: c.space, note: c.note, pace: c.pace === "auto" ? undefined : c.pace })),
    };
    const draft = await buildNarrationScript(ctx);
    // ★ buildNarrationScript는 clipKinds 없이 정규화한다 → 이동 컷 흡수(absorbTransitParts)가 안 걸린다.
    //   narration 저장 라우트와 같은 방식으로 컷 완급을 넘겨 한 번 더 정규화한다.
    const clipKinds = CUTS.map((c) => resolveClipPace(c.space, c.note, c.pace).kind);
    const lines = normalizeScript(
      draft.map((l) => ({
        text: l.text,
        parts: l.parts.map((p) => ({ cut: p.clipIndexes.length ? p.clipIndexes[0] + 1 : 0, text: p.text })),
      })),
      CUTS.length,
      clipKinds
    );
    lines.forEach((l, i) => {
      console.log(`  문장${i + 1} "${l.text}"`);
      l.parts.forEach((p) =>
        console.log(`      [${p.clipIndexes.length ? p.clipIndexes.map((x) => x + 1).join(",") : "CTA"}] ${p.text}`)
      );
    });

    bar("⑤ 제목·설명·태그 (Gemini)");
    const meta = await generateShortMeta({
      name: villa.name,
      nameVi: villa.nameVi,
      complex: villa.complex,
      bedrooms: villa.bedrooms,
      maxGuests: villa.maxGuests,
      beachDistanceM: villa.beachDistanceM,
      hasPool: villa.hasPool,
      breakfastAvailable: villa.breakfastAvailable,
      featureKeys: villa.features.map((f) => f.featureKey),
    });
    console.log("  제목:", meta.title);
    console.log("  태그:", meta.tags.join(", "));

    bar("⑥ YoutubeShort 생성 (DRAFT / editJobStatus=PENDING)");
    const editParams = {
      clips: CUTS.map((c, i) => ({
        key: keys[i]!,
        startSec: 0,
        durationSec: c.len, // 나레이션 타임라인이 렌더 시 덮어쓴다
        space: c.space,
        note: c.note,
        pace: c.pace,
      })),
      headline: HEADLINE,
      villaId: VILLA_ID,
      audio: "silent",
      horizontalMode: "crop",
      pacing: true,
      bgm: "soft",
      audit: true,
      narration: { lines },
    };
    const short = await prisma.youtubeShort.create({
      data: {
        villaId: VILLA_ID,
        sourceType: "UPLOADED",
        status: "DRAFT",
        editJobStatus: "PENDING", // ← cron(/api/cron/youtube-edit-jobs)이 집어간다
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        videoUrl: "",
        editParamsJson: editParams as never,
        createdBy: "manual:m1-30cut",
      },
      select: { id: true, title: true, status: true, editJobStatus: true },
    });
    await saveState({ ...state, shortId: short.id });
    console.log("  생성:", short.id, "|", short.status, "/", short.editJobStatus);
    console.log("\n다음: cron이 5분 내 픽업 → 렌더 3~7분. 검수 error면 editError에 컷 번호가 남는다.");
  } finally {
    await prisma.$disconnect();
  }
}

const phase = process.argv[2] ?? "all";
// 두 번째 인자로 컷 번호(1-base, 쉼표)를 주면 그 컷만 재단·검수한다 — 한 컷 고치고 전체를 다시 돌리지 않기 위함.
const only = (process.argv[3] ?? "")
  .split(",")
  .map((s) => Number(s.trim()) - 1)
  .filter((n) => Number.isInteger(n) && n >= 0 && n < CUTS.length);
if (phase === "cut" || phase === "all") await phaseCut(only);
if (phase === "audit" || phase === "all") {
  const errs = await phaseAudit(only);
  if (errs > 0 && phase === "all") {
    console.error("\n★ 검수 오류가 있어 업로드·생성을 중단한다. 해당 컷의 src를 옮기고 다시 실행하라.");
    process.exit(1);
  }
}
if (phase === "upload" || phase === "all") await phaseUpload(only);
if (phase === "create" || phase === "all") await phaseCreate();
