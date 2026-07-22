// 프로덕션 나레이션 쇼츠 생성 (M villa M1) — 클립 R2 업로드 → 대본·메타 생성 → YoutubeShort(PENDING).
//   실행: npx tsx smoke/prod-create-short.mts
// ★ 여기서는 **렌더도 발행도 하지 않는다.** 렌더는 cron이, 발행은 승인 후 publish cron이 한다.
import "dotenv/config";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { buildNarrationScript, type NarrationVillaContext } from "../lib/youtube/narration";
import { generateShortMeta } from "../lib/youtube/meta";

const prisma = new PrismaClient();
const VILLA_ID = "cmru4fggf02bko80fp3nxkn00"; // M villa M1

// 투어 컷 — smoke/에 잘라둔 파일 재사용(입구→수영장→외관→거실→다이닝→주방→침실3→욕실→발코니)
const CLIPS = [
  { file: "smoke/clip-00-entrance.mp4", space: "EXTERIOR", note: "빌라 정문과 진입로" },
  { file: "smoke/clip-01-pool.mp4", space: "POOL", note: "단독 사용 프라이빗 수영장, 잔디 정원" },
  { file: "smoke/clip-02-facade.mp4", space: "EXTERIOR", note: "이 층 건물 외관과 넓은 통창" },
  { file: "smoke/clip-03-living.mp4", space: "LIVING", note: "거실, 큰 소파와 천장 선풍기, 정원으로 이어지는 통창" },
  { file: "smoke/clip-04-dining.mp4", space: "LIVING", note: "다이닝 공간, 원목 식탁" },
  { file: "smoke/clip-05-kitchen.mp4", space: "KITCHEN", note: "조리대와 인덕션, 조리도구 갖춘 주방" },
  { file: "smoke/clip-06-bed1.mp4", space: "BEDROOM", note: "마스터 침실, 킹베드에 소파까지 있는 가장 넓은 방" },
  { file: "smoke/clip-07-bed2.mp4", space: "BEDROOM", note: "둘째 침실, 화장대와 큰 창, 부부나 커플에게 알맞음" },
  { file: "smoke/clip-08-twin.mp4", space: "BEDROOM", note: "트윈룸, 싱글 침대 두 개라 아이들이나 친구끼리 쓰기 좋음" },
  { file: "smoke/clip-09-bath.mp4", space: "BATHROOM", note: "욕조가 있는 욕실" },
  { file: "smoke/clip-10-balcony.mp4", space: "BALCONY", note: "발코니에서 내려다보이는 수영장과 정원" },
];

function bar(s: string) {
  console.log(`\n── ${s} ${"─".repeat(Math.max(0, 52 - s.length))}`);
}

// R2 직접 업로드(presign 없이 서버 자격증명 사용) — 키 형식은 edit.ts CLIP_KEY_RE와 일치해야 한다.
async function uploadClip(localPath: string): Promise<string> {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.STORAGE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
    },
  });
  const key = `youtube-clips/${randomUUID().replace(/-/g, "")}.mp4`;
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.STORAGE_BUCKET_NAME!,
      Key: key,
      Body: await fs.readFile(localPath),
      ContentType: "video/mp4",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  return key;
}

const villa = await prisma.villa.findUniqueOrThrow({
  where: { id: VILLA_ID },
  select: {
    name: true,
    nameVi: true,
    complex: true,
    bedrooms: true,
    maxGuests: true,
    beachDistanceM: true,
    hasPool: true,
    breakfastAvailable: true,
    features: { select: { featureKey: true } },
  },
});
console.log("빌라:", villa.name, "| 침실", villa.bedrooms, "| 풀", villa.hasPool, "| 해변", villa.beachDistanceM, "m");

bar("① 클립 R2 업로드");
const keys: string[] = [];
for (const c of CLIPS) {
  const key = await uploadClip(c.file);
  keys.push(key);
  console.log("  ", c.space.padEnd(9), key);
}

bar("② 나레이션 대본 (Gemini)");
const ctx: NarrationVillaContext = {
  villaName: villa.name,
  complex: villa.complex,
  bedrooms: villa.bedrooms,
  hasPool: villa.hasPool,
  beachDistanceM: villa.beachDistanceM,
  clips: CLIPS.map((c) => ({ space: c.space, note: c.note })),
};
const lines = await buildNarrationScript(ctx);
lines.forEach((l, i) => {
  console.log(`  문장${i + 1} "${l.text}"`);
  l.parts.forEach((p) =>
    console.log(`      [${p.clipIndexes.length ? p.clipIndexes.map((x) => x + 1).join(",") : "CTA"}] ${p.text}`)
  );
});

bar("③ 제목·설명·태그 (Gemini)");
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

bar("④ YoutubeShort 생성 (DRAFT / editJobStatus=PENDING)");
const editParams = {
  clips: keys.map((key, i) => ({
    key,
    startSec: 0,
    durationSec: 4, // 나레이션 타임라인이 렌더 시 덮어쓴다
    space: CLIPS[i].space, // clipHintsOf가 읽는다(validateEditParams는 무시)
    note: CLIPS[i].note,
  })),
  headline: villa.name,
  villaId: VILLA_ID,
  audio: "silent",
  horizontalMode: "crop",
  narration: { lines },
};

const short = await prisma.youtubeShort.create({
  data: {
    villaId: VILLA_ID,
    sourceType: "UPLOADED",
    status: "DRAFT", // 렌더 완료 시 cron이 PENDING_APPROVAL로 올린다
    editJobStatus: "PENDING", // ← cron이 집어간다
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    videoUrl: "", // 렌더 후 채워짐
    editParamsJson: editParams as never,
    createdBy: "manual:prod-e2e",
  },
  select: { id: true, title: true, editJobStatus: true, status: true },
});

console.log("  생성:", short.id);
console.log("  상태:", short.status, "/", short.editJobStatus);
console.log("\n다음: cron(/api/cron/youtube-edit-jobs)이 렌더한다. 최대 5분 내 픽업.");

await prisma.$disconnect();
