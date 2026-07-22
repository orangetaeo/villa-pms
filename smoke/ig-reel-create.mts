// 인스타 릴스 등록 — 캡션 생성 → InstagramPost(REELS) 생성. 발행은 별도 단계.
import "dotenv/config";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { generateCaption } from "../lib/instagram/caption";

const prisma = new PrismaClient();
const VILLA_ID = "cmru4fggf02bko80fp3nxkn00"; // M villa M1
const videoUrl = readFileSync("smoke/ig-url.txt", "utf8").trim();

const v = await prisma.villa.findUniqueOrThrow({
  where: { id: VILLA_ID },
  select: {
    name: true, nameVi: true, complex: true, bedrooms: true, maxGuests: true,
    beachDistanceM: true, hasPool: true, breakfastAvailable: true,
    features: { select: { featureKey: true } },
  },
});

const publicInfo = {
  name: v.name, nameVi: v.nameVi, complex: v.complex, bedrooms: v.bedrooms,
  maxGuests: v.maxGuests, beachDistanceM: v.beachDistanceM, hasPool: v.hasPool,
  breakfastAvailable: v.breakfastAvailable, featureKeys: v.features.map((f) => f.featureKey),
};

console.log("빌라:", v.name, "| 침실", v.bedrooms, "| 해변", v.beachDistanceM + "m");
console.log("영상:", videoUrl.slice(-60));

const cap = await generateCaption(publicInfo as never, "REELS");
console.log("\n=== 캡션 ===");
console.log(cap.caption);
console.log("\n금칙어:", cap.flaggedTerms?.length ? cap.flaggedTerms.join(", ") : "없음");

const post = await prisma.instagramPost.create({
  data: {
    villaId: VILLA_ID,
    kind: "REELS",
    status: "PENDING_APPROVAL",
    scheduledAt: new Date(Date.now() - 60_000), // 즉시 발행 대상
    caption: cap.caption,
    // 릴스 미디어 — publish 경로가 videoUrl을 읽는다(사진 캐러셀과 동일 구조)
    mediaJson: [
      {
        templateId: "reel",
        srcPhotoId: null,
        renderedUrl: "",
        overlayText: null,
        videoUrl,
        durationSec: 43,
        frameCount: 11,
        audio: "narration",
      },
    ] as never,
    flaggedTerms: (cap.flaggedTerms?.length ? cap.flaggedTerms : undefined) as never,
    createdBy: "manual:ig-reel",
  },
  select: { id: true, status: true, kind: true },
});
console.log("\nInstagramPost 생성:", post.id, "|", post.kind, "/", post.status);
require("fs").writeFileSync("smoke/ig-post-id.txt", post.id, "utf8");

await prisma.$disconnect();
