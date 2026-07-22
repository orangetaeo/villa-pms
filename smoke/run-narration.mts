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
  buildIntroSpecs,
  type NarrationVillaContext,
} from "../lib/youtube/narration";
import { renderEditedVideo } from "../lib/youtube/edit";
import { ttsConfig } from "../lib/gemini-tts";

// 빌라 투어 — 입구 → 수영장 → 외관 → 거실 → 다이닝 → 주방 → 침실3 → 욕실 → 발코니.
// ★ note는 실제 파이프라인의 VillaClip.note 자리다. 침실이 3컷이라 note 없이는
//   "또 다른 침실입니다" 같은 무정보 문장이 나온다(테오 피드백 2026-07-22).
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

// 실제 빌라 정보 대신 공개 정보만(누수 0 규약 동일). 이름은 TTS가 읽을 수 있는 한글 표기.
const ctx: NarrationVillaContext = {
  villaName: "엠빌라",
  complex: "쏘나씨",
  bedrooms: 3,
  hasPool: true, // 수영장 컷이 있다
  beachDistanceM: 120,
  clips: CLIPS.map((c) => ({ space: c.space, note: c.note })),
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
  headline: "엠빌라", // 빌라명이 곧 타이틀 — villaName과 중복 표기하지 않는다
  villaName: "푸꾸옥 쏘나씨",
  audio: "silent", // 나레이션이 대체하므로 음악 없음
  horizontalMode: "crop",
  // 오프닝 스펙 칩 + 첫 문장이 끝날 때까지 인트로 유지(음소거 시청자에게도 스펙 전달)
  introSpecs: buildIntroSpecs(ctx),
  introHoldSec: timeline.lineOffsets[0] + synth[0].durationSec + 0.4,
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
