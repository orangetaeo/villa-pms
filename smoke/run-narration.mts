// 나레이션 쇼츠 통합 스모크 (villa-clip-narration-p2) — 실제 Gemini 대본 + 실제 TTS + 실제 ffmpeg 렌더.
//   실행: npx tsx smoke/run-narration.mts
// R2·DB를 건드리지 않는다(renderEditedVideo는 로컬 경로만 다룸). 산출물은 smoke/out.mp4.
import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import {
  buildNarrationScript,
  validateNarrationLines,
  computeNarrationTimeline,
  synthesizeNarration,
  type NarrationVillaContext,
} from "../lib/youtube/narration";
import { renderEditedVideo } from "../lib/youtube/edit";
import { ttsConfig } from "../lib/gemini-tts";

// 빌라 투어 순서 — 입구 → 수영장 → 테라스 → 거실 → 주방 → 침실N → 욕실 → 발코니
// (테오 피드백 2026-07-22: 15초 3컷으로는 "맛보기"밖에 안 된다)
const CLIPS = [
  { file: "smoke/clip-00-entrance.mp4", space: "EXTERIOR" },
  { file: "smoke/clip-01-pool.mp4", space: "POOL" },
  { file: "smoke/clip-02-terrace.mp4", space: "BALCONY" },
  { file: "smoke/clip-03-living.mp4", space: "LIVING" },
  { file: "smoke/clip-04-living2.mp4", space: "LIVING" },
  { file: "smoke/clip-05-kitchen.mp4", space: "KITCHEN" },
  { file: "smoke/clip-06-bed1.mp4", space: "BEDROOM" },
  { file: "smoke/clip-07-bed2.mp4", space: "BEDROOM" },
  { file: "smoke/clip-08-bed3.mp4", space: "BEDROOM" },
  { file: "smoke/clip-09-bath.mp4", space: "BATHROOM" },
  { file: "smoke/clip-10-balcony.mp4", space: "BALCONY" },
];

// 실제 빌라 정보 대신 공개 정보만(누수 0 규약 동일). 이름은 TTS가 읽을 수 있는 한글 표기.
const ctx: NarrationVillaContext = {
  villaName: "엠빌라",
  complex: "쏘나씨",
  bedrooms: 3,
  hasPool: true, // 수영장 컷이 있다
  beachDistanceM: 120,
  clipSpaces: CLIPS.map((c) => c.space),
};

function bar(label: string) {
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 56 - label.length))}`);
}

const t0 = Date.now();

bar("① 대본 생성 (Gemini)");
console.log("TTS 설정:", ttsConfig());
const lines = await buildNarrationScript(ctx);
lines.forEach((l, i) =>
  console.log(`  ${l.clipIndex == null ? "CTA " : `컷${i + 1} `} "${l.text}" (${l.text.length}자)`)
);

bar("② 규칙 검증");
const v = validateNarrationLines(lines);
console.log("  ok:", v.ok, "| 문장별:", JSON.stringify(v.lineIssues), "| 대본:", JSON.stringify(v.scriptIssues));

bar("③ TTS 합성");
const synth = await synthesizeNarration(lines);
synth.forEach((s, i) =>
  console.log(`  ${i + 1}. ${s.durationSec.toFixed(2)}s ${s.cached ? "(캐시)" : "(신규합성)"} "${s.text}"`)
);

bar("④ 타임라인 (오디오 우선)");
const TL = { transitionSec: 0.4, minSegmentSec: 2, ctaMinSec: 2.8 };
const timeline = computeNarrationTimeline({ lineDurations: synth.map((s) => s.durationSec), ...TL });
console.log("  세그먼트 길이:", timeline.segmentDurations.map((d) => d.toFixed(2)).join(", "));
console.log("  오디오 오프셋:", timeline.lineOffsets.map((d) => d.toFixed(2)).join(", "));
console.log("  자막 구간:", timeline.subtitleRanges.map((r) => `${r.fromSec.toFixed(1)}~${r.toSec.toFixed(1)}`).join(", "));
console.log("  ★ 총 길이:", timeline.totalSec.toFixed(2), "초");

bar("⑤ 나레이션 WAV 기록");
const wavDir = "smoke/wav";
await fs.mkdir(wavDir, { recursive: true });
const wavPaths: string[] = [];
for (let i = 0; i < synth.length; i++) {
  const p = path.resolve(wavDir, `narr-${i}.wav`);
  await fs.writeFile(p, synth[i].wav);
  wavPaths.push(p);
}
console.log("  ", wavPaths.length, "개 기록");

bar("⑥ 렌더 (ffmpeg)");
const local = CLIPS.map((c, i) => ({
  path: path.resolve(c.file),
  startSec: 0,
  durationSec: timeline.segmentDurations[i], // ★ 오디오 길이로 역산된 컷 길이
}));
const rendered = await renderEditedVideo(local, {
  headline: "푸꾸옥 엠빌라",
  villaName: "엠빌라",
  audio: "silent", // 나레이션이 대체하므로 음악 없음
  horizontalMode: "crop",
  narration: { wavPaths, offsetsSec: timeline.lineOffsets },
  // CTA 문장은 자막 제외 — 아웃트로 카드가 같은 내용을 큰 글씨로 이미 보여준다(겹침 방지).
  subtitles: synth
    .map((s, i) => ({
      text: s.text,
      fromSec: timeline.subtitleRanges[i].fromSec,
      toSec: timeline.subtitleRanges[i].toSec,
      isCta: s.clipIndex == null,
    }))
    .filter((s) => !s.isCta)
    .map(({ text, fromSec, toSec }) => ({ text, fromSec, toSec })),
});

await fs.writeFile("smoke/out.mp4", rendered.mp4);
await fs.writeFile("smoke/out-poster.jpg", rendered.poster);

bar("완료");
console.log("  출력: smoke/out.mp4");
console.log("  길이:", rendered.durationSec, "초 |", rendered.width + "x" + rendered.height);
console.log("  크기:", (rendered.mp4.length / 1024 / 1024).toFixed(2), "MB");
console.log("  소요:", ((Date.now() - t0) / 1000).toFixed(1), "초");
