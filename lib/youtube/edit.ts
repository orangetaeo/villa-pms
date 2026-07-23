// lib/youtube/edit.ts — 직접 촬영 클립 자동 편집 파이프라인 (marketing-s2 §A-2)
//
// 흐름(요청→MP4):
//   R2 클립(1~8개) 다운로드(tmp) → ffprobe(크기·회전) → ① 9:16 정규화 1080×1920·30fps
//   (세로=cover-crop / 가로=중앙 crop 기본·blur 패딩 옵션) ② 구간 트림 ③ xfade 크로스페이드 연결
//   ④ villa-go 워드마크 워터마크(satori PNG, 우상단 반투명) ⑤ 인트로 타이틀(헤드라인+빌라명, 첫 1.5s)
//   ⑥ 구간 자막(satori PNG 오버레이) ⑦ 아웃트로 CTA 카드(기존 reel cta 유튜브 문구, 정지 세그먼트)
//   ⑧ 오디오 silent/ambient(reels 패턴) → 15~60s H.264/AAC MP4 → 호출부가 R2 업로드.
//
// ★ ffmpeg/ffprobe: 시스템 설치 가정 금지 — ffmpeg-static·ffprobe-static 정적 바이너리 spawn(크로스플랫폼).
// ★ 텍스트 렌더는 satori 통일(ffmpeg drawtext는 한글 폰트 경로 이슈) — 오버레이는 전부 1080×1920 투명 PNG.
// ★ 디스크 경유(os.tmpdir), 메모리 스트리밍 지양. 모든 임시 파일은 finally에서 정리.
// ★ 누수: 입력은 클립 키·헤드라인·자막(운영자 작성)·빌라명(공개)만 — 원가·마진·판매가 없음.
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import satori from "satori";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import {
  BRAND,
  FONT_SANS,
  FONT_SERIF,
  type SatoriNode,
} from "@/lib/instagram/templates";
import { reelCta916 } from "@/lib/instagram/reel-templates";
import { brandLockup, brandMark } from "@/lib/brand/logo-lockup";
import type { CtaData } from "@/lib/instagram/templates";
import { wrapHeadlineToFit } from "@/lib/instagram/headline-wrap";
import { YOUTUBE_REEL_CTA, INSTAGRAM_REEL_CTA, type ReelAudioMode } from "@/lib/instagram/reels";
import {
  computeNarrationTimeline,
  retimeNarrationTimeline,
  synthesizeNarration,
} from "@/lib/youtube/narration";
import {
  maxScreenSecFor,
  minScreenSecFor,
  pacingFilterChain,
  planClipTiming,
  resolveClipPace,
  type ClipPaceOverride,
} from "@/lib/youtube/pacing";
import {
  getR2ObjectBuffer,
  saveYoutubeRenderedVideo,
  saveYoutubeRenderPoster,
} from "@/lib/storage";
import { readFileSync, existsSync } from "fs";

const FFMPEG_PATH: string = ffmpegStatic ?? "ffmpeg";
const FFPROBE_PATH: string = ffprobeStatic.path;

// ── 인코딩 품질(video-pacing-quality) ────────────────────────────────
// ★ 이 파이프라인은 **3세대 인코딩**이다: 정규화 → xfade 연결 → 오버레이 합성.
//   예전엔 세 단계 모두 `-preset veryfast` + CRF 기본값(23)이라 세대마다 디테일이 깎였다
//   (수영장 물결·나무 질감처럼 고주파가 많은 화면에서 눈에 띈다).
//   → 중간 산출물은 최종보다 한 단계 높은 품질(CRF 19)로 두고, **최종 1회만** 배포 품질로 조인다.
// ★ CRF 16은 과했다(2026-07-23 실측): 30컷 영상의 중간 파일이 120MB를 넘어가며 인코딩이
//   몇 배로 느려졌다. 최종이 CRF 20이므로 중간 19면 세대 손실이 눈에 보이지 않으면서 훨씬 빠르다.
const INTERMEDIATE_CRF = "19";
const INTERMEDIATE_PRESET = "veryfast";
/** 최종 산출물 — 유튜브·인스타가 어차피 재인코딩하므로 소스 화질이 높을수록 결과가 좋다. */
const FINAL_CRF = "20";
const FINAL_PRESET = "fast";
/** 상한 비트레이트 — 3분짜리가 200MB(MAX_MP4_BYTES)를 넘지 않게 묶는다(8Mbps × 180s ≈ 180MB). */
const FINAL_MAXRATE = "8M";
const FINAL_BUFSIZE = "16M";

/** 중간 세그먼트 공통 인코딩 인자. */
const INTERMEDIATE_ENC = [
  "-c:v", "libx264",
  "-preset", INTERMEDIATE_PRESET,
  "-crf", INTERMEDIATE_CRF,
  "-pix_fmt", "yuv420p",
];

const W = 1080;
const H = 1920;
const FPS = 30;

const CLIP_DUR_DEFAULT = 4;
const CLIP_DUR_MIN = 2;
const CLIP_DUR_MAX = 8;
// 빌라 투어는 입구·수영장·거실·주방·침실N·욕실·발코니를 다 보여줘야 설득력이 생긴다.
// 8컷으로는 "맛보기"밖에 안 된다(테오 피드백 2026-07-22) — 16컷까지 허용.
const CLIP_COUNT_MAX = 30;

const TRANSITION_SEC = 0.4; // xfade 크로스페이드 길이(세그먼트가 짧으면 축소)
const CTA_DUR_SEC = 2.8; // 아웃트로 CTA 정지 카드
const INTRO_SEC = 1.5; // 인트로 타이틀 표시 구간
// 유튜브 쇼츠 상한(하드 컷). ★2024-10 이후 60초 → **3분**으로 상향됐다(인스타 릴스도 인앱 3분).
//   60초로 두면 "쇼츠=1분"이라는 낡은 공식에 갇혀 빌라를 제대로 못 보여준다(테오 피드백 2026-07-22).
const TOTAL_MAX_SEC = 180;
// 나레이션 문장 수 상한 — 클립 8개 + CTA 1개. 대본 규칙(3~5문장)보다 넉넉히 두고 구조만 막는다.
const NARRATION_LINES_MAX = CLIP_COUNT_MAX + 1;
const MAX_MP4_BYTES = 200 * 1024 * 1024;

// 클립 저장 키 형식 — presign이 발급한 것만 허용(임의 R2 키 조회 차단).
//   ⑴ `youtube-clips/{hex}.{mp4|mov}` — ADMIN 마법사에서 그때그때 올린 파일
//   ⑵ `villa-clips/{hex}.{mp4|mov}`  — 빌라 자산(VillaClip). 승인된 영상을 재사용하는 경로
//      (youtube-villa-clip-source). 이게 없으면 공급자가 올린 영상을 쇼츠 소재로 쓸 수 없다.
// ★ 접두는 이 **2종으로 한정**한다(와일드카드 금지) — 이 정규식이 임의 R2 키 조회를 막는 방어선이다.
// ★ `villa-clips/` 키는 여기에 더해 edit-jobs 라우트에서 **APPROVED VillaClip 행으로 실재함**까지
//   확인한다(이중 게이트). 형식만 맞는 문자열을 params에 직접 써넣는 우회를 막기 위함.
const CLIP_KEY_RE = /^(youtube-clips|villa-clips)\/[a-zA-Z0-9]+\.(mp4|mov)$/;

// ── 파라미터 스키마 (FE가 그대로 사용 — 반환 보고에 명세) ──
export interface EditClipInput {
  key: string; // presign 발급 R2 키 (youtube-clips/{hex}.{ext})
  startSec?: number; // 트림 시작(기본 0)
  durationSec?: number; // 트림 길이(기본 4, 2~8 클램프)
  /**
   * 촬영 공간(PhotoSpace). **나레이션 대본과 컷 속도 조절이 둘 다 이 값을 쓴다.**
   * ★ 2026-07-23까지 이 필드가 스키마에 없어서 조용히 버려졌다 — 마법사가 보내도 저장되지 않고,
   *   대본 생성기(clipHintsOf)는 항상 "공간 미지정"을 받았다. 그래서 나레이션이 화면과 무관한
   *   일반론이 됐다("아름다운 공간입니다"). 이 한 줄이 대본 품질의 절반이다.
   */
  space?: string | null;
  /** 이 컷의 특징 메모(VillaClip.note) — 같은 공간이 여러 컷일 때 다른 점을 말하게 하는 근거 */
  note?: string | null;
  /**
   * 완급 직접 지정 — "fast"(이동 구간) · "slow"(보여줄 공간) · "auto"(공간·메모로 추론, 기본).
   * ★ 스토리보드가 있는 영상은 추론으로 만들 수 없다: 같은 EXTERIOR라도 "해변에서 입구로
   *   빠르게 돌아간다"와 "입구를 천천히 들어선다"는 정반대 연출이다(테오 2026-07-23).
   */
  pace?: ClipPaceOverride;
}

/** 저장 가능한 공간 코드 화이트리스트 = Prisma PhotoSpace. 임의 문자열 저장을 막는다. */
const PHOTO_SPACES = new Set([
  "EXTERIOR", "LIVING", "KITCHEN", "BEDROOM", "BATHROOM", "BALCONY", "POOL", "ETC",
]);
export interface EditSubtitleInput {
  text: string;
  fromSec: number; // 최종 타임라인 기준 표시 시작(초)
  toSec: number; // 표시 종료(초)
}
/**
 * AI 나레이션 대본 (villa-clip-narration-p2). 있으면 음악·앰비언트 대신 나레이션이 깔리고,
 * 자막은 이 문장들에서 파생된다(단일 진실). 컷 길이도 이 문장들의 TTS 길이로 역산된다.
 */
export interface EditNarrationInput {
  /** 문장 = TTS 입력(끊김 없이 한 번에 합성). parts = 컷별 절(자막 한 장·컷 길이 산출 단위). */
  lines: { text: string; parts: { clipIndexes: number[]; text: string }[] }[];
  voice?: string; // 미지정 시 GEMINI_TTS_VOICE 기본값
}
export interface EditParams {
  clips: EditClipInput[]; // 1~8개
  headline: string; // 인트로 타이틀(빈 문자열이면 인트로 생략)
  villaId?: string | null;
  subtitles?: EditSubtitleInput[];
  audio: ReelAudioMode; // "silent" | "ambient"
  horizontalMode: "crop" | "blur"; // 가로 클립 처리(기본 crop)
  narration?: EditNarrationInput | null; // null·미지정 = 기존 동작(무변경)
  /**
   * 아웃트로 CTA 문구 변형. 기본 "youtube"(기존 동작 무변경).
   * ★ 인스타는 프로필 링크가 눌리므로 유튜브 문구를 그대로 쓰면 안 된다.
   */
  ctaVariant?: "youtube" | "instagram";
  /**
   * 나레이션 아래 깔리는 배경음악 (video-pacing-quality). 기본 "soft".
   *   "soft" = 번들 CC0 트랙을 아주 낮게(−20dB 수준) 깔아 무음의 어색함을 없앤다
   *   "none" = 나레이션만
   * ★ 나레이션이 없을 때는 기존 `audio` 모드가 그대로 쓰인다(무변경).
   * ★ CC0 음원이라 Content ID 리스크 0 — assets/audio/LICENSE.md.
   */
  bgm?: "soft" | "none";
  /**
   * 컷 속도 조절(페이싱). 기본 켬.
   * 복도·계단 같은 이동 컷은 빠르게 지나가고, 수영장·외관은 살짝 느리게 흘린다(pacing.ts).
   * ★ 화면 길이는 절대 바뀌지 않는다 — 같은 시간에 원본을 얼마나 소비하느냐만 달라진다.
   */
  pacing?: boolean;
}

export class EditValidationError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "EditValidationError";
  }
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 신뢰 불가 입력(JSON) → 검증된 EditParams. 실패 시 EditValidationError(code). */
export function validateEditParams(raw: unknown): EditParams {
  if (!raw || typeof raw !== "object") throw new EditValidationError("PARAMS_REQUIRED");
  const r = raw as Record<string, unknown>;

  const clipsRaw = r.clips;
  if (!Array.isArray(clipsRaw) || clipsRaw.length < 1) {
    throw new EditValidationError("CLIPS_REQUIRED", "클립이 1개 이상이어야 합니다");
  }
  if (clipsRaw.length > CLIP_COUNT_MAX) {
    throw new EditValidationError("CLIPS_TOO_MANY", `클립은 최대 ${CLIP_COUNT_MAX}개입니다`);
  }

  const clips: EditClipInput[] = clipsRaw.map((c, i) => {
    if (!c || typeof c !== "object") throw new EditValidationError("CLIP_INVALID", `clips[${i}]`);
    const cc = c as Record<string, unknown>;
    const key = typeof cc.key === "string" ? cc.key.trim() : "";
    if (!CLIP_KEY_RE.test(key)) throw new EditValidationError("CLIP_KEY_INVALID", `clips[${i}].key`);
    const startSec = Math.max(0, num(cc.startSec) ?? 0);
    const durationSec = Math.min(
      CLIP_DUR_MAX,
      Math.max(CLIP_DUR_MIN, num(cc.durationSec) ?? CLIP_DUR_DEFAULT)
    );
    // 공간·메모는 **화이트리스트 통과분만** 보존한다(임의 문자열 저장 금지).
    const spaceRaw = typeof cc.space === "string" ? cc.space.trim().toUpperCase() : "";
    const space = PHOTO_SPACES.has(spaceRaw) ? spaceRaw : null;
    const note = typeof cc.note === "string" && cc.note.trim() ? cc.note.trim().slice(0, 200) : null;
    const pace: ClipPaceOverride =
      cc.pace === "fast" ? "fast" : cc.pace === "slow" ? "slow" : "auto";
    return { key, startSec, durationSec, space, note, pace };
  });

  const headline = typeof r.headline === "string" ? r.headline.trim().slice(0, 120) : "";

  const audio: ReelAudioMode = r.audio === "ambient" ? "ambient" : "silent";
  const horizontalMode: "crop" | "blur" = r.horizontalMode === "blur" ? "blur" : "crop";

  let subtitles: EditSubtitleInput[] | undefined;
  if (Array.isArray(r.subtitles)) {
    subtitles = r.subtitles
      .map((s) => {
        if (!s || typeof s !== "object") return null;
        const ss = s as Record<string, unknown>;
        const text = typeof ss.text === "string" ? ss.text.trim().slice(0, 120) : "";
        const fromSec = Math.max(0, num(ss.fromSec) ?? 0);
        const toSec = Math.max(0, num(ss.toSec) ?? 0);
        if (!text || toSec <= fromSec) return null;
        return { text, fromSec, toSec };
      })
      .filter((s): s is EditSubtitleInput => s !== null)
      .slice(0, 20);
  }

  const villaId = typeof r.villaId === "string" && r.villaId.trim() ? r.villaId.trim() : null;

  // AI 나레이션 (villa-clip-narration-p2) — 미지정이면 null(기존 동작 완전 무변경).
  //   ★ 여기서 문장 규칙(길이·숫자 금지)까지 강제하지는 않는다. 운영자가 대본을 손으로 고칠 수
  //     있어야 하고(예: 17자 규칙을 1자 넘긴 문장), 규칙 검증은 대본 편집 API가
  //     validateNarrationLines로 별도 수행해 경고와 함께 보여준다. 여기선 구조·상한만 본다.
  let narration: EditNarrationInput | null = null;
  if (r.narration && typeof r.narration === "object") {
    const nr = r.narration as Record<string, unknown>;
    const linesRaw = Array.isArray(nr.lines) ? nr.lines : [];
    type ParsedLine = { text: string; parts: { clipIndexes: number[]; text: string }[] };
    const lines = linesRaw
      .map((l): ParsedLine | null => {
        if (!l || typeof l !== "object") return null;
        const ll = l as Record<string, unknown>;
        const text = typeof ll.text === "string" ? ll.text.trim().slice(0, 200) : "";
        if (!text) return null;
        // 절(자막 한 장) 배열. 없으면 문장 전체를 한 절로 취급(하위호환).
        const partsRaw = Array.isArray(ll.parts) ? ll.parts : [];
        const parts = partsRaw
          .map((p) => {
            if (!p || typeof p !== "object") return null;
            const pp = p as Record<string, unknown>;
            const ptext = typeof pp.text === "string" ? pp.text.trim().slice(0, 120) : "";
            if (!ptext) return null;
            const idxRaw = Array.isArray(pp.clipIndexes) ? pp.clipIndexes : [];
            const clipIndexes = idxRaw
              .map((v) => num(v))
              .filter((v): v is number => v != null && v >= 0)
              .map((v) => Math.floor(v));
            return { clipIndexes, text: ptext };
          })
          .filter((p): p is { clipIndexes: number[]; text: string } => p !== null);
        return { text, parts: parts.length > 0 ? parts : [{ clipIndexes: [], text }] };
      })
      .filter((l): l is ParsedLine => l !== null)
      .slice(0, NARRATION_LINES_MAX);
    if (lines.length > 0) {
      const voice = typeof nr.voice === "string" && nr.voice.trim() ? nr.voice.trim() : undefined;
      narration = { lines, voice };
    }
  }

  const ctaVariant: "youtube" | "instagram" = r.ctaVariant === "instagram" ? "instagram" : "youtube";
  // 기본값을 "켬"으로 둔다 — 기존 잡을 재렌더하면 자동으로 좋아지는 쪽이 맞다(테오 2026-07-23).
  const bgm: "soft" | "none" = r.bgm === "none" ? "none" : "soft";
  const pacing = r.pacing !== false;

  return {
    clips,
    headline,
    villaId,
    subtitles,
    audio,
    horizontalMode,
    narration,
    ctaVariant,
    bgm,
    pacing,
  };
}

// ── satori 폰트 로드(프로세스 캐시) — render.ts와 동일 세트(브랜드 일관성) ──
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
type FontSpec = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };
let _fonts: FontSpec[] | null = null;
function loadFonts(): FontSpec[] {
  if (_fonts) return _fonts;
  _fonts = [
    { name: FONT_SERIF, data: readFileSync(path.join(FONT_DIR, "NanumMyeongjo-Regular.ttf")), weight: 400, style: "normal" },
    { name: FONT_SERIF, data: readFileSync(path.join(FONT_DIR, "NanumMyeongjo-Bold.ttf")), weight: 700, style: "normal" },
    { name: FONT_SANS, data: readFileSync(path.join(FONT_DIR, "NanumGothic-Regular.ttf")), weight: 400, style: "normal" },
    { name: FONT_SANS, data: readFileSync(path.join(FONT_DIR, "NanumGothic-Bold.ttf")), weight: 700, style: "normal" },
    { name: "Noto", data: readFileSync(path.join(FONT_DIR, "NotoSans-Regular.ttf")), weight: 400, style: "normal" },
    { name: "Noto", data: readFileSync(path.join(FONT_DIR, "NotoSans-Bold.ttf")), weight: 700, style: "normal" },
  ];
  return _fonts;
}

function div(style: Record<string, unknown>, children?: SatoriNode | string | (SatoriNode | string)[]): SatoriNode {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

async function nodeToSvg(node: SatoriNode): Promise<string> {
  return satori(node as unknown as Parameters<typeof satori>[0], { width: W, height: H, fonts: loadFonts() });
}
async function nodeToTransparentPng(node: SatoriNode): Promise<Buffer> {
  return sharp(Buffer.from(await nodeToSvg(node))).png().toBuffer();
}
/**
 * 오버레이 자산 — 투명 여백을 잘라낸 PNG + 원래 캔버스에서의 위치.
 *
 * ★ 왜 자르나(2026-07-23 성능): satori는 항상 1080×1920 캔버스를 준다. 실제 그림은
 *   워터마크 배지 176×58처럼 **캔버스의 0.5%** 인데, 그대로 overlay하면 ffmpeg가 매 프레임
 *   2백만 픽셀을 합성한다. 60초 영상 × 30fps × 오버레이 20장이면 그 자체가 렌더 시간의 태반이다.
 *   sharp trim으로 그림만 남기고 위치를 좌표로 넘기면 결과 픽셀은 **완전히 동일**하면서
 *   합성 비용만 사라진다.
 * ★ threshold를 낮게(1) 둔다 — 자막의 부드러운 그림자 가장자리까지 잘라내지 않기 위함.
 */
interface OverlayAsset {
  path: string;
  x: number;
  y: number;
}

async function writeOverlay(node: SatoriNode, file: string): Promise<OverlayAsset> {
  const png = await nodeToTransparentPng(node);
  try {
    const { data, info } = await sharp(png)
      .trim({ threshold: 1 })
      .png()
      .toBuffer({ resolveWithObject: true });
    const x = -(info.trimOffsetLeft ?? 0);
    const y = -(info.trimOffsetTop ?? 0);
    // 좌표가 음수이거나 크기가 0이면 잘못 잘린 것 — 원본을 그대로 쓴다(그림이 사라지는 것보다 낫다).
    if (info.width > 0 && info.height > 0 && x >= 0 && y >= 0 && x + info.width <= W && y + info.height <= H) {
      await fs.writeFile(file, data);
      return { path: file, x, y };
    }
  } catch {
    // 전부 투명하거나 trim이 실패하면 원본 캔버스를 쓴다(기존 동작).
  }
  await fs.writeFile(file, png);
  return { path: file, x: 0, y: 0 };
}



/**
 * 한 번의 ffmpeg 호출에 넣을 최대 입력 수(최종 합성).
 *
 * ★ 근거(2026-07-23 프로덕션 실패 2차): 30컷 영상의 최종 합성은 입력이 42개였다
 *   (본편 1 + 워터마크 1 + 인트로 1 + 자막 30 + 나레이션 WAV 9 + 배경음 1).
 *   `auto_scale_20 Failed to configure output pad · code -11 (Resource temporarily unavailable)` —
 *   ffmpeg는 입력·필터마다 스레드를 띄우는데 컨테이너의 스레드·메모리 한도에 걸린다.
 *   **로컬(31개)에서는 통과했다** — 이 한계는 실행 환경에 달렸으므로 여유 있게 낮춰 잡는다.
 */
const MAX_FINAL_INPUTS = 12;

/**
 * 나레이션 + 배경음을 **미리 한 파일로 믹스**한다. 최종 합성의 오디오 입력을 10개에서 1개로 줄인다.
 * ★ 필터 내용은 최종 합성에서 하던 것과 동일하다(narrationFilter → bgmUnderFilter → alimiter).
 */
async function premixNarrationAudio(
  wavPaths: string[],
  offsetsSec: number[],
  totalSec: number,
  bgm: boolean,
  outPath: string
): Promise<void> {
  const inputArgs: string[] = [];
  for (const wp of wavPaths) inputArgs.push("-i", wp);
  let bgmIdx = -1;
  if (bgm && existsSync(REEL_BGM_PATH)) {
    inputArgs.push("-stream_loop", "-1", "-i", REEL_BGM_PATH);
    bgmIdx = wavPaths.length;
  }

  const fParts = [narrationFilter(0, offsetsSec, totalSec)];
  let map = "[aud]";
  if (bgmIdx >= 0) {
    fParts.push(bgmUnderFilter(bgmIdx, totalSec, "[aud]", "[amixed2]"));
    map = "[amixed2]";
  }
  fParts.push(`${map}alimiter=limit=0.95:level=disabled[aout]`);

  await run(FFMPEG_PATH, [
    "-y",
    ...inputArgs,
    "-filter_complex", fParts.join(";"),
    "-map", "[aout]",
    "-c:a", "pcm_s16le",
    "-ar", "44100",
    "-t", totalSec.toFixed(3),
    outPath,
  ]);
}

/** 자막 몇 장을 영상 위에 얹어 중간 파일로 굽는다(비디오 전용·중간 품질). */
async function overlaySubtitlePass(
  inputVideo: string,
  subs: (OverlayAsset & { from: number; to: number })[],
  totalSec: number,
  outPath: string
): Promise<void> {
  const inputArgs: string[] = ["-i", inputVideo];
  subs.forEach((s) => inputArgs.push("-loop", "1", "-i", s.path));

  const fParts: string[] = [];
  let cur = "[0:v]";
  subs.forEach((s, i) => {
    const span = Math.max(0.2, s.to - s.from);
    const fade = Math.min(0.22, span / 4);
    fParts.push(
      `[${i + 1}:v]format=rgba,` +
        `fade=t=in:st=${s.from.toFixed(2)}:d=${fade.toFixed(2)}:alpha=1,` +
        `fade=t=out:st=${(s.to - fade).toFixed(2)}:d=${fade.toFixed(2)}:alpha=1[subf${i}]`
    );
    const out = `[s${i}]`;
    fParts.push(
      `${cur}[subf${i}]overlay=${s.x}:${s.y}:enable='between(t,${s.from.toFixed(2)},${s.to.toFixed(2)})'${out}`
    );
    cur = out;
  });
  fParts.push(`${cur}format=yuv420p[vout]`);

  await run(FFMPEG_PATH, [
    "-y",
    ...inputArgs,
    "-filter_complex", fParts.join(";"),
    "-map", "[vout]",
    "-an",
    ...INTERMEDIATE_ENC,
    "-r", String(FPS),
    // ★ `-t` 필수: `-loop 1` PNG 입력은 **무한 스트림**이라 이게 없으면 ffmpeg가 영원히 인코딩한다.
    //   (2026-07-23: 이 한 줄이 없어서 자막 패스 하나가 24분 넘게 돌았다. 최종 패스에는 원래 있었다.)
    "-t", totalSec.toFixed(3),
    outPath,
  ]);
}

async function nodeToJpeg(node: SatoriNode, bg: string): Promise<Buffer> {
  return sharp(Buffer.from(await nodeToSvg(node)))
    .flatten({ background: bg })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

// ── 오버레이 노드(1080×1920 투명) ──
/**
 * 우상단 브랜드 로고 워터마크 — 전 구간 표시.
 *
 * ★ 2026-07-23 테오 지적: 여기가 "VILLA GO"라는 **글자만** 박혀 있었다. 로고 삽입이 아니었다.
 *   → 실제 브랜드 마크(로케이션 핀 = 빌라) + Villa Go 워드마크 정식 락업으로 교체.
 *   사진 위 어떤 밝기에서도 읽히도록 반투명 알약 배경은 유지한다(마크만 얹으면 밝은 하늘·수영장에서 사라진다).
 */
function watermarkNode(): SatoriNode {
  return div({ position: "relative", width: W, height: H, backgroundColor: "transparent" }, [
    div(
      {
        position: "absolute",
        top: 54,
        right: 54,
        alignItems: "center",
        backgroundColor: "rgba(13,17,20,0.42)",
        borderRadius: 999,
        padding: "12px 26px 12px 22px",
      },
      brandLockup({ variant: "photo", fontSize: 34, markHeight: 46, gap: 14 }) as SatoriNode
    ),
  ]);
}

/** 인트로 타이틀 — 하단 1/3에 헤드라인(세리프)+빌라명(고딕), 가독 스크림. */
/**
 * 오프닝 인트로 — 빌라 이름 + **핵심 스펙**(테오 피드백 2026-07-22).
 *
 * ★ 왜 스펙이 필요한가: 첫 화면에서 "방 몇 개인지·수영장이 있는지·해변이 얼마나 가까운지"가
 *   안 보이면 시청자가 계속 볼 이유를 못 찾는다. 쇼츠는 첫 2~3초에 이탈이 갈린다.
 *   나레이션 첫 문장(훅)과 **같은 정보를 화면에도** 띄워 음소거 시청자에게도 전달한다.
 * ★ specs는 짧은 칩 문자열 배열: ["침실 셋", "프라이빗 수영장", "해변 바로 앞"]
 */
function introNode(
  headline: string,
  villaName?: string | null,
  specs: string[] = []
): SatoriNode {
  // ★ 인트로는 **상단**에 놓는다: 하단 300은 나레이션 자막 자리라 겹치면 둘 다 못 읽는다
  //   (2026-07-22 실제 렌더에서 타이틀과 첫 문장 자막이 포개짐). 스크림도 위에서 내려오게 바꾼다.
  return div({ position: "relative", width: W, height: H, backgroundColor: "transparent" }, [
    // 상단 스크림 — 밝은 하늘·외관 위에서도 흰 글씨가 읽히게
    div({
      position: "absolute",
      left: 0,
      top: 0,
      width: W,
      height: 980,
      backgroundImage: "linear-gradient(to bottom, rgba(10,17,20,0.74) 0%, rgba(10,17,20,0) 100%)",
    }),
    div(
      {
        position: "absolute",
        left: 0,
        top: 250,
        width: W,
        flexDirection: "column",
        alignItems: "center",
        padding: "0 80px",
      },
      [
        // ★ 오프닝 브랜드 마크 — 예전엔 여기가 샌드 색 가로줄 하나였다(브랜드 신호 0).
        //   첫 화면에서 "누가 파는 빌라인가"를 로고로 각인시킨다.
        div({ marginBottom: 30 }, brandMark(104, "photo") as SatoriNode),
        div(
          {
            fontFamily: FONT_SERIF,
            fontWeight: 700,
            fontSize: 76,
            lineHeight: 1.24,
            color: "#FFFFFF",
            textAlign: "center",
            whiteSpace: "pre-line",
            flexDirection: "column",
            textShadow: "0px 2px 16px rgba(10,17,20,0.5)",
          },
          headline
        ),
        ...(villaName
          ? [
              div(
                {
                  fontFamily: FONT_SANS,
                  fontWeight: 700,
                  fontSize: 38,
                  letterSpacing: 3,
                  color: BRAND.cream,
                  marginTop: 28,
                  textAlign: "center",
                },
                villaName
              ),
            ]
          : []),
        // 핵심 스펙 칩 — 첫 화면에서 "방 몇 개·수영장·해변 거리"를 즉시 보여준다.
        ...(specs.length
          ? [
              div(
                {
                  flexDirection: "row",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  marginTop: 34,
                  gap: 14,
                },
                specs.slice(0, 4).map((s) =>
                  div(
                    {
                      backgroundColor: "rgba(255,255,255,0.16)",
                      borderRadius: 999,
                      padding: "14px 28px",
                      fontFamily: FONT_SANS,
                      fontWeight: 700,
                      fontSize: 40,
                      color: "#FFFFFF",
                      textShadow: "0 2px 10px rgba(0,0,0,0.55)",
                    },
                    s
                  )
                )
              ),
            ]
          : []),
      ]
    ),
  ]);
}

/** 구간 자막 — 하단 캡션(반투명 바 + 흰 텍스트). */
/**
 * 나레이션 자막 — 한국 "랜선집구경" 릴스 관례를 따른다(테오 레퍼런스 2026-07-22).
 *   큰 굵은 흰 글씨 + 두꺼운 검정 외곽선, 배경 박스 없음.
 *
 * ★ 왜 박스를 뺐나: 박스는 영상을 가린다. 빌라 영상은 화면 자체가 상품이라 최대한 보여야 한다.
 *   외곽선만으로도 밝은 수영장·해변 위에서 읽힌다(실제 합성 프레임으로 A/B 비교 확인).
 * ★ 크기: 44px(화면 폭 4%)는 모바일에서 너무 작았다 → 66px(6%). 랜선집구경 자막의 통상 크기.
 * ★ bottom 300: 인스타·쇼츠 UI(하단 캡션·버튼)에 가려지지 않는 안전 영역.
 * ★ 외곽선은 satori의 textShadow를 8방향으로 깔아 구현한다(-webkit-text-stroke는 satori 미지원).
 */
const SUBTITLE_OUTLINE = [
  "3px 3px 0 rgba(0,0,0,0.92)",
  "-3px 3px 0 rgba(0,0,0,0.92)",
  "3px -3px 0 rgba(0,0,0,0.92)",
  "-3px -3px 0 rgba(0,0,0,0.92)",
  "0 4px 0 rgba(0,0,0,0.92)",
  "0 -4px 0 rgba(0,0,0,0.92)",
  "4px 0 0 rgba(0,0,0,0.92)",
  "-4px 0 0 rgba(0,0,0,0.92)",
  "0 6px 20px rgba(0,0,0,0.6)", // 알약 밖으로 번지는 부드러운 그림자 — 떠 있는 느낌
].join(",");

const SUBTITLE_FONT_SIZE = 62;
const SUBTITLE_MAX_WIDTH = W - 220; // 알약 좌우 여백(각 34px) + 화면 여백을 뺀 실제 글자 폭

/**
 * 나레이션 자막 (2026-07-23 재디자인 — 테오 "자막을 조금 더 이쁘게").
 *
 * 이전: 화면 폭 전체를 쓰는 흰 글씨 + 두꺼운 검정 외곽선만. 밝은 수영장 위에서 읽히기는 했지만
 *   ⑴ 외곽선이 굵어 글자가 뭉개져 보이고 ⑵ 줄마다 길이가 제각각이라 정렬이 어수선했다.
 *
 * 지금: **줄마다 독립된 반투명 알약(pill)** + 흰 굵은 글씨 + 얇아진 외곽선.
 *   - 알약은 글자 길이에 딱 맞게 줄어든다(가운데 정렬) → 짧은 줄이 화면을 덜 가린다.
 *   - 반투명(0.55) + 살짝 밝은 테두리라 영상이 비쳐 보인다. 상품(빌라 화면)을 가리지 않는다.
 *   - 외곽선을 4px → 3px로 줄여도 알약 덕분에 대비가 충분하다(글자가 훨씬 선명해진다).
 *   - 첫 줄 위에 브랜드 색 짧은 악센트 바 — 자막이 "그냥 텍스트"가 아니라 디자인처럼 보인다.
 * ★ 줄 단위 알약이라 각 줄을 개별 div로 만든다 — 그래서 wrapHeadlineToFit 결과를 \n으로 쪼갠다.
 */
function subtitleNode(rawText: string): SatoriNode {
  // ★ 어절 단위 줄바꿈 필수: satori는 한글을 **글자 단위로** 흘려서 "부/부에게", "친구나 아/이들이"
  //   처럼 단어 한가운데가 끊긴다(2026-07-22 실제 렌더 확인 — 자막을 44→66px로 키우자 재발).
  //   기존 [[satori-korean-orphan-headline-wrap]] 교훈의 동일 클래스라 같은 모듈을 재사용한다.
  const lines = wrapHeadlineToFit(rawText, SUBTITLE_FONT_SIZE, SUBTITLE_MAX_WIDTH)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return div({ position: "relative", width: W, height: H, backgroundColor: "transparent" }, [
    div(
      {
        position: "absolute",
        left: 0,
        bottom: 300,
        width: W,
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "0 60px",
      },
      [
        // 브랜드 악센트 바 — 자막 덩어리의 시작점을 잡아주는 작은 신호
        div({
          width: 84,
          height: 7,
          borderRadius: 999,
          backgroundColor: BRAND.sand,
          marginBottom: 6,
          opacity: 0.95,
        }),
        ...lines.map((line) =>
          div(
            {
              backgroundColor: "rgba(9,14,17,0.55)",
              border: "2px solid rgba(255,255,255,0.16)",
              borderRadius: 26,
              padding: "12px 34px 16px 34px",
              justifyContent: "center",
              maxWidth: W - 120,
            },
            div(
              {
                fontFamily: FONT_SANS,
                fontWeight: 700,
                fontSize: SUBTITLE_FONT_SIZE,
                lineHeight: 1.24,
                letterSpacing: -1,
                color: "#FFFFFF",
                textAlign: "center",
                textShadow: SUBTITLE_OUTLINE,
              },
              line
            )
          )
        ),
      ]
    ),
  ]);
}

// ── ffmpeg/ffprobe 실행 ──
function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 40_000) stdout = stdout.slice(-40_000);
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    proc.on("error", (e) => reject(new Error(`${path.basename(bin)} 실행 실패: ${e.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(bin)} 종료코드 ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

/** ffprobe로 클립/세그먼트 길이(초) 파악. 실패 시 null. */
async function probeDurationSec(file: string): Promise<number | null> {
  try {
    const out = await run(FFPROBE_PATH, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    const d = parseFloat(out.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/** ffprobe로 회전 반영 실제 표시 방향 파악(가로 여부). 실패 시 false(세로 가정). */
async function probeIsHorizontal(file: string): Promise<boolean> {
  try {
    // ★ `stream_side_data=` 셀렉터 금지 — ffprobe-static 번들(4.0.2)이 그 섹션명을 몰라 exit 1로 죽는다.
    //   그러면 catch로 떨어져 **항상 세로로 가정**되고, 가로 클립의 blur 패딩 모드가 영영 켜지지 않는다
    //   (marketing-s2 병합분의 잠재 결함 — villa-clip-narration-p2 작업 중 실측으로 발견).
    //   -show_streams는 4.x·7.x 모두 동작하며 회전 정보가 있으면 어느 형태든 그대로 실려 온다.
    const out = await run(FFPROBE_PATH, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_streams",
      "-of", "json",
      file,
    ]);
    const j = JSON.parse(out) as {
      streams?: { width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
    };
    const s = j.streams?.[0];
    if (!s?.width || !s?.height) return false;
    let rot = 0;
    if (s.tags?.rotate) rot = parseInt(s.tags.rotate, 10) || 0;
    const sd = s.side_data_list?.find((x) => typeof x.rotation === "number");
    if (sd?.rotation != null) rot = sd.rotation;
    const swap = Math.abs(rot) % 180 === 90;
    const dispW = swap ? s.height : s.width;
    const dispH = swap ? s.width : s.height;
    return dispW > dispH;
  } catch {
    return false;
  }
}

// ── 정규화·트림(클립 1개 → 9:16 세그먼트) ──
function normalizeFilter(mode: "crop" | "blur"): string {
  if (mode === "blur") {
    // 가로 원본: 블러 확대 배경 + 원본 폭맞춤 중앙 오버레이(레터박스 대체).
    return (
      `[0:v]split=2[bg][fg];` +
      `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=28[bgb];` +
      `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=${FPS},format=yuv420p[vout]`
    );
  }
  // 세로/기본: cover-crop.
  return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p[vout]`;
}

interface LocalClip {
  path: string; // 로컬 파일 경로
  startSec: number;
  durationSec: number;
  /** 촬영 공간(PhotoSpace) — 속도 조절 판정 입력 */
  space?: string | null;
  /** 특징 메모 — 공간 코드보다 정확한 신호일 때가 많다("침실로 가는 복도") */
  note?: string | null;
  /** 완급 직접 지정 — 추론보다 우선한다 */
  pace?: ClipPaceOverride;
}

/**
 * 클립 1개 → 9:16 세그먼트. **컷 속도 조절(페이싱)이 여기서 걸린다.**
 *
 * ★ durationSec(화면에 나갈 길이)은 나레이션이 정한 값이라 바꾸지 않는다.
 *   페이싱이 바꾸는 건 "그 시간 동안 원본을 얼마나 소비하느냐"뿐이다:
 *     복도(transit) → 원본 1.85초를 화면 1초에 몰아 넣는다(성큼성큼 지나간다)
 *     수영장(hero)  → 원본 0.88초를 화면 1초에 편다(여운)
 *   추가로 이동 컷에는 **감속 램프**를 건다 — 빠르게 들어가 끝에서 정상 속도로 도착한다.
 * ★ 원본이 요청 길이보다 짧으면 예전처럼 감속으로 채운다(planClipTiming이 같은 식으로 처리).
 *   감속 상한에 걸려 짧아진 경우는 호출부가 **실측 길이로 나레이션을 재동기화**한다.
 * @returns 페이싱 진단(로그용)
 */
async function normalizeClip(
  clip: LocalClip,
  outPath: string,
  horizontalMode: "crop" | "blur",
  pacingEnabled: boolean
): Promise<{ kind: string; readSec: number; screenSec: number }> {
  const useBlur = horizontalMode === "blur" && (await probeIsHorizontal(clip.path));
  const baseFilter = normalizeFilter(useBlur ? "blur" : "crop");

  const srcDur = await probeDurationSec(clip.path);
  const avail = srcDur != null ? Math.max(0, srcDur - clip.startSec) : null;

  // 페이싱을 끄면 "원본 부족분만 감속으로 채우는" 기존 동작과 동일해진다(sourceSpeed 1).
  const pace = pacingEnabled
    ? resolveClipPace(clip.space, clip.note, clip.pace)
    : { kind: "feature" as const, sourceSpeed: 1, ramp: false };
  const plan = planClipTiming(clip.durationSec, avail, pace);
  const chain = pacingFilterChain(plan);

  const filter = chain
    ? `[0:v]${chain}[paced];[paced]` + baseFilter.replace(/^\[0:v\]/, "")
    : baseFilter;

  await run(FFMPEG_PATH, [
    "-y",
    "-ss", clip.startSec.toFixed(3),
    "-t", plan.readSec.toFixed(3),
    "-i", clip.path,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-an",
    ...INTERMEDIATE_ENC,
    "-r", String(FPS),
    outPath,
  ]);

  return { kind: pace.sourceSpeed === 1 && !pacingEnabled ? "off" : pace.kind, readSec: plan.readSec, screenSec: plan.screenSec };
}

/** 정지 JPEG → 지정 길이 9:16 세그먼트(CTA 카드). */
async function stillToSegment(jpegPath: string, durationSec: number, outPath: string): Promise<void> {
  await run(FFMPEG_PATH, [
    "-y",
    "-loop", "1",
    "-t", durationSec.toFixed(3),
    "-i", jpegPath,
    "-filter_complex", `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p[vout]`,
    "-map", "[vout]",
    "-an",
    ...INTERMEDIATE_ENC,
    "-r", String(FPS),
    outPath,
  ]);
}

/**
 * 세그먼트들 xfade 크로스페이드 연결(비디오 전용).
 * @returns 최종 길이(초) + **실제로 사용한 전환 길이**(초).
 * ★ 전환 길이를 돌려주는 이유: 세그먼트가 짧으면 T가 0.4에서 줄어드는데, 나레이션 재동기화가
 *   상수 TRANSITION_SEC를 믿고 계산하면 그만큼 어긋난다. 두 곳이 **같은 값**을 쓰게 강제한다.
 */
async function xfadeConcat(
  segPaths: string[],
  durations: number[],
  outPath: string,
  workDir: string
): Promise<{ totalSec: number; transitionSec: number }> {
  // ★ 전환 길이는 **전 구간에서 하나**여야 한다. 청크로 나눠 합치더라도 청크마다 다시 계산하면
  //   경계에서 길이가 어긋난다 — 여기서 한 번 정하고 모든 단계에 그대로 내려보낸다.
  const T = Math.max(0.1, Math.min(TRANSITION_SEC, Math.min(...durations) / 2));
  const totalSec = await xfadeJoin(segPaths, durations, T, outPath, workDir, 0);
  return { totalSec, transitionSec: T };
}

/**
 * 한 번의 ffmpeg 호출에 넣을 최대 입력 수.
 *
 * ★ 왜 필요한가(2026-07-23 프로덕션 실패): 컷 상한을 30으로 올린 뒤 첫 렌더가
 *   `ffmpeg 종료코드 245 · auto_scale_23 Failed to configure output`으로 죽었다.
 *   31개 세그먼트를 **동시에 열고** 30단 xfade 체인을 거는 필터그래프는 컨테이너가 감당하지 못한다.
 *   → 청크로 나눠 합치고, 그 결과들을 다시 합친다. 전환 길이 T를 공유하므로 **총 길이는 동일**하다:
 *     청크 총합 = Σd − (k−1)T, 최종 = Σ청크 − (청크수−1)T = Σd − (m−1)T (한 번에 한 것과 같다).
 */
const MAX_XFADE_INPUTS = 10;

/** 세그먼트들을 xfade로 잇는다. 입력이 많으면 청크로 나눠 재귀 결합. @returns 실측 길이(초) */
async function xfadeJoin(
  paths: string[],
  durs: number[],
  T: number,
  outPath: string,
  workDir: string,
  depth: number
): Promise<number> {
  if (paths.length > MAX_XFADE_INPUTS) {
    const chunkPaths: string[] = [];
    const chunkDurs: number[] = [];
    for (let i = 0; i < paths.length; i += MAX_XFADE_INPUTS) {
      const cp = path.join(workDir, `chunk-${depth}-${String(i).padStart(3, "0")}.mp4`);
      const d = await xfadeJoin(
        paths.slice(i, i + MAX_XFADE_INPUTS),
        durs.slice(i, i + MAX_XFADE_INPUTS),
        T,
        cp,
        workDir,
        depth + 1
      );
      chunkPaths.push(cp);
      chunkDurs.push(d);
    }
    return xfadeJoin(chunkPaths, chunkDurs, T, outPath, workDir, depth + 1);
  }

  const m = paths.length;
  const inputs: string[] = [];
  for (const p of paths) inputs.push("-i", p);

  const parts: string[] = [];
  let prev = "[0:v]";
  let prevOut = durs[0];
  for (let k = 1; k < m; k++) {
    const offset = Math.max(0, prevOut - T);
    const out = k === m - 1 ? "[vout]" : `[x${k}]`;
    parts.push(`${prev}[${k}:v]xfade=transition=fade:duration=${T.toFixed(3)}:offset=${offset.toFixed(3)}${out}`);
    prev = out;
    prevOut = prevOut + durs[k] - T;
  }
  const computed = prevOut;

  const filter = m === 1 ? `[0:v]null[vout]` : parts.join(";");
  await run(FFMPEG_PATH, [
    "-y",
    ...inputs,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-an",
    ...INTERMEDIATE_ENC,
    "-r", String(FPS),
    outPath,
  ]);
  // 청크를 다시 이을 때는 **실측 길이**를 써야 경계 오차가 누적되지 않는다.
  return (await probeDurationSec(outPath)) ?? computed;
}

// ── 나레이션 오디오 (villa-clip-narration-p2) ──────────────────────
/**
 * 나레이션 트랙 입력 — 문장별 WAV를 각자의 오프셋에 배치한다.
 *   wavPaths[i]가 offsetsSec[i] 시점부터 재생된다.
 *
 * ★ 왜 concat이 아니라 adelay+amix인가: 세그먼트는 xfade로 T초씩 겹치므로 오디오를 단순
 *   이어붙이면 뒤로 갈수록 화면과 어긋난다. 절대 오프셋으로 깔면 누적 오차가 0이다.
 * ★ 왜 오디오에 xfade를 쓰지 않는가: 말이 뭉개진다(계약 리스크 항목).
 */
export interface NarrationTrack {
  wavPaths: string[];
  offsetsSec: number[];
  /**
   * 문장별 TTS 길이 + 절 구성. 넘기면 렌더가 **실측 세그먼트 길이로 오프셋·자막을 다시 계산**한다
   * (retimeNarrationTimeline). 안 넘기면 offsetsSec를 그대로 쓴다(예전 동작).
   * ★ 원본이 짧아 감속 상한에 걸린 컷이 하나라도 있으면 계획값은 반드시 어긋난다 —
   *   실전 경로(runYoutubeEditJob)는 항상 넘긴다.
   */
  lines?: { durationSec: number; parts: { clipIndexes: number[]; text: string }[] }[];
}

// 나레이션 아래 깔 배경음(번들 CC0 트랙) — 릴스와 같은 파일을 공유한다.
const REEL_BGM_PATH = path.join(process.cwd(), "assets", "audio", "reel-bgm.mp3");
/** 나레이션 밑에 깔리는 볼륨. 0.10 ≈ −20dB — 있는 줄 모르게 있지만 빠지면 허전하다. */
const BGM_UNDER_VOLUME = 0.1;

/**
 * 나레이션 트랙 밑에 배경음악을 섞는 filter 조각.
 * ★ 말을 절대 덮지 않아야 한다: 고정 저볼륨 + 저역 정리(highpass)로 목소리 대역을 비운다.
 *   사이드체인 덕킹은 문장 경계마다 음악이 펌핑해 오히려 싸구려로 들린다(실측 후 배제).
 */
export function bgmUnderFilter(
  inputIdx: number,
  totalSec: number,
  inLabel: string,
  outLabel: string
): string {
  const fadeOut = Math.max(0, totalSec - 1.6).toFixed(3);
  return (
    `[${inputIdx}:a]atrim=0:${totalSec.toFixed(3)},asetpts=PTS-STARTPTS,` +
    `highpass=f=180,volume=${BGM_UNDER_VOLUME},` +
    `afade=t=in:st=0:d=1.4,afade=t=out:st=${fadeOut}:d=1.6[bgmu];` +
    `${inLabel}[bgmu]amix=inputs=2:normalize=0:duration=first${outLabel}`
  );
}

/**
 * 나레이션 filter_complex 조각 — anullsrc 베이스 위에 문장들을 절대 오프셋으로 깔고 amix.
 * @param startIdx 첫 나레이션 WAV의 ffmpeg 입력 인덱스
 * @param offsetsSec 문장별 시작 오프셋(초) — computeNarrationTimeline 산출값
 * @returns filter 조각(반환 라벨 [aud])
 */
export function narrationFilter(
  startIdx: number,
  offsetsSec: number[],
  totalSec: number
): string {
  // 베이스 무음: 말이 없는 구간에도 오디오 스트림이 끊기지 않게(발행 규격상 AAC 트랙 필수).
  // duration=first로 amix 길이를 이 베이스에 고정 → 마지막 문장이 잘리거나 늘어나지 않는다.
  const parts: string[] = [`anullsrc=r=44100:cl=stereo:d=${totalSec.toFixed(3)}[abase]`];
  const labels = ["[abase]"];
  offsetsSec.forEach((off, i) => {
    const delayMs = Math.max(0, Math.round(off * 1000));
    // TTS는 mono 24kHz — 44.1kHz 스테레오로 맞춘 뒤 지연 배치(all=1: 전 채널 동일 지연).
    parts.push(
      `[${startIdx + i}:a]aresample=44100,aformat=channel_layouts=stereo,` +
        `adelay=delays=${delayMs}:all=1[an${i}]`
    );
    labels.push(`[an${i}]`);
  });
  parts.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=first[amixed]`);
  // 끝 페이드아웃만 — 시작은 LEAD 지연이 이미 있어 페이드인이 불필요하다.
  const fadeOutStart = Math.max(0, totalSec - 0.6).toFixed(3);
  parts.push(`[amixed]afade=t=out:st=${fadeOutStart}:d=0.6[aud]`);
  return parts.join(";");
}

/** 오디오 입력 인자(무음 or 합성 앰비언트) — reels.ts 패턴 재사용. */
function audioInputArgs(mode: ReelAudioMode, totalSec: number): string[] {
  if (mode === "ambient") {
    const expr = `aevalsrc=0.09*sin(2*PI*196*t)+0.06*sin(2*PI*261.63*t)+0.045*sin(2*PI*329.63*t):s=44100:d=${totalSec.toFixed(3)}`;
    return ["-f", "lavfi", "-i", expr];
  }
  return ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
}

export interface RenderedEdit {
  mp4: Buffer;
  poster: Buffer;
  durationSec: number;
  width: number;
  height: number;
  clipCount: number;
  audio: ReelAudioMode;
}

export interface RenderOpts {
  headline: string;
  villaName?: string | null;
  subtitles?: EditSubtitleInput[];
  audio: ReelAudioMode;
  horizontalMode: "crop" | "blur";
  /**
   * AI 나레이션 트랙 (villa-clip-narration-p2). 지정 시 `audio` 모드를 **대체**한다(음악·앰비언트 없음).
   * ★ 이 모드에서는 클립 길이 균등 축소(scale)를 하지 않는다 — 축소하면 오디오와 어긋난다.
   *   호출부(narration.ts computeNarrationTimeline)가 이미 오디오 길이에 맞춰 durationSec를 정했으므로,
   *   예산 초과는 조용히 줄이지 말고 **에러로 드러내야** 한다(계약 C2).
   */
  narration?: NarrationTrack;
  /**
   * 오프닝 스펙 칩 — ["침실 셋", "프라이빗 수영장", "해변 바로 앞"] 같은 짧은 문구 최대 4개.
   * 나레이션 첫 문장(훅)과 같은 정보를 화면에도 띄워 음소거 시청자에게 전달한다.
   */
  introSpecs?: string[];
  /** 인트로 유지 시간(초). 미지정 시 INTRO_SEC(1.5). 나레이션 첫 문장 종료까지 잡아주면 자연스럽다. */
  introHoldSec?: number;
  /**
   * 아웃트로 CTA 문구 교체. 미지정 시 유튜브 문구(기존 동작 무변경).
   * ★ 인스타는 프로필 링크가 눌리므로 유튜브 문구("유튜브에선 링크가 안 눌려요")를 쓰면 안 된다.
   */
  ctaOverride?: CtaData;
  /**
   * 아웃트로 CTA 카드 길이(초). 미지정 시 CTA_DUR_SEC(2.8).
   * ★ 나레이션 사용 시 반드시 넘겨라 — 마지막 문장이 이 카드 위에서 재생되므로,
   *   기본값보다 문장이 길면 말이 끝나기 전에 영상이 끝난다.
   */
  ctaDurationSec?: number;
  /** 나레이션 밑 배경음. 기본 "soft"(깐다). 나레이션이 없으면 무시된다. */
  bgm?: "soft" | "none";
  /** 컷 속도 조절(페이싱). 기본 켬(undefined = 켬). false면 원본 속도 그대로. */
  pacing?: boolean;
}

/**
 * 로컬 클립 경로들 → 편집된 1080×1920 H.264/AAC MP4 + 포스터 버퍼. R2·DB 미접촉(스모크가 직접 호출).
 * @throws ffmpeg 실패·산출물 200MB 초과.
 */
export async function renderEditedVideo(clips: LocalClip[], opts: RenderOpts): Promise<RenderedEdit> {
  if (clips.length < 1 || clips.length > CLIP_COUNT_MAX) {
    throw new Error(`클립 수 범위 밖(${clips.length})`);
  }
  const workDir = path.join(os.tmpdir(), `yt-edit-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    // 상한 예산: 클립 길이 합이 (60 - CTA - 전이여유)를 넘으면 균등 축소.
    // ★ 나레이션 모드는 축소 금지 — 컷 길이가 이미 오디오 길이에서 역산된 값이라, 줄이면 말과 화면이
    //   어긋난다. 예산을 넘으면 조용히 줄이지 말고 에러로 드러낸다(계약 C2).
    const reqDurs = clips.map((c) => c.durationSec);
    const clipBudget = TOTAL_MAX_SEC - CTA_DUR_SEC - clips.length * TRANSITION_SEC;
    const reqSum = reqDurs.reduce((a, b) => a + b, 0);
    if (opts.narration && reqSum > clipBudget) {
      throw new Error(
        `나레이션 길이가 쇼츠 상한을 넘습니다(필요 ${reqSum.toFixed(1)}s > 예산 ${clipBudget.toFixed(1)}s). 대본을 줄여주세요.`
      );
    }
    const scale = !opts.narration && reqSum > clipBudget && clipBudget > 0 ? clipBudget / reqSum : 1;

    // 1) 정규화·트림(+ 컷 속도 조절).
    const segPaths: string[] = [];
    const segDurs: number[] = [];
    const paceLog: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const seg = path.join(workDir, `seg-${String(i).padStart(2, "0")}.mp4`);
      const want = Math.max(CLIP_DUR_MIN * 0.5, clips[i].durationSec * scale);
      const info = await normalizeClip(
        { ...clips[i], durationSec: want },
        seg,
        opts.horizontalMode,
        opts.pacing !== false
      );
      // ★ probe 실패 시 요청 길이로 폴백하면 **조용히 깨진 영상**이 나온다:
      //   실제 세그먼트는 더 짧은데 xfade 오프셋은 요청 길이를 믿어, 마지막 프레임이 정지한 채
      //   나레이션만 흐른다(2026-07-22 실발행 영상에서 확인. 원인은 ffprobe-static 번들 누락).
      //   폴백은 유지하되(렌더 자체는 살린다) 반드시 로그로 드러낸다.
      const probed = await probeDurationSec(seg);
      if (probed == null) {
        console.error(
          `[yt-edit] ffprobe 실패 — 세그먼트 ${i} 길이를 계획값(${info.screenSec.toFixed(2)}s)으로 폴백합니다. ` +
            `xfade 타이밍이 어긋나 화면이 정지할 수 있습니다. next.config serverExternalPackages에 ffprobe-static이 있는지 확인하세요.`
        );
      }
      const d = probed ?? info.screenSec;
      segPaths.push(seg);
      segDurs.push(d);
      paceLog.push(
        `#${i}(${clips[i].space ?? "?"}/${info.kind}) 원본${info.readSec.toFixed(1)}s→화면${d.toFixed(1)}s`
      );
    }
    console.info(`[yt-edit] 페이싱: ${paceLog.join(", ")}`);

    // 2) 아웃트로 CTA 정지 카드 세그먼트.
    const ctaJpeg = await nodeToJpeg(reelCta916(opts.ctaOverride ?? YOUTUBE_REEL_CTA), BRAND.teal);
    const ctaJpegPath = path.join(workDir, "cta.jpg");
    await fs.writeFile(ctaJpegPath, ctaJpeg);
    const ctaSeg = path.join(workDir, "seg-cta.mp4");
    // ★ CTA 카드 길이는 고정이 아니다: 나레이션 마지막 문장(카카오톡 안내)이 이 카드 위에서 재생된다.
    //   2.8초로 못박아두면 3초 넘는 CTA 문장이 **끝나기 전에 영상이 끝난다**
    //   (테오 2026-07-22 "마지막 화면의 나레이션이 끝나지도 않았는데 화면이 끝나버린다").
    //   호출부(잡 러너)가 computeNarrationTimeline의 마지막 세그먼트 길이를 넘겨준다.
    const ctaDur = Math.max(CTA_DUR_SEC, opts.ctaDurationSec ?? CTA_DUR_SEC);
    await stillToSegment(ctaJpegPath, ctaDur, ctaSeg);
    segPaths.push(ctaSeg);
    segDurs.push((await probeDurationSec(ctaSeg)) ?? ctaDur);

    // 3) xfade 연결(비디오).
    const concatPath = path.join(workDir, "concat.mp4");
    const { totalSec: concatTotal, transitionSec: actualT } = await xfadeConcat(
      segPaths,
      segDurs,
      concatPath,
      workDir
    );
    const total = Math.min(concatTotal, TOTAL_MAX_SEC);

    // 3-b) ★ 나레이션 실측 재동기화(video-pacing-quality).
    //   계획 길이와 실제 세그먼트 길이는 어긋날 수 있다(원본 부족 → 감속 상한에 걸림).
    //   계획값 그대로 오디오를 깔면 그 오차가 **누적**돼 뒤로 갈수록 다른 방을 설명하게 된다.
    //   여기서 실측 길이로 다시 계산하면 드리프트가 구조적으로 0이 된다.
    //   덤으로 자막이 컷 경계에 정확히 붙는다(화면이 바뀌는 순간 자막도 바뀐다).
    let narrationOffsets = opts.narration?.offsetsSec ?? [];
    let subtitleList = opts.subtitles ?? [];
    if (opts.narration?.lines && opts.narration.lines.length > 0) {
      const ctaActual = segDurs[segDurs.length - 1];
      const retimed = retimeNarrationTimeline(
        opts.narration.lines,
        segDurs.slice(0, clips.length),
        ctaActual,
        actualT // ★ 상수가 아니라 xfade가 실제로 쓴 값 — 두 계산이 어긋나면 드리프트가 생긴다
      );
      narrationOffsets = retimed.lineOffsets;
      // CTA 절은 자막에서 제외 — 아웃트로 카드가 같은 내용을 큰 글씨로 이미 보여준다(겹침 방지).
      subtitleList = retimed.subtitles
        .filter((s) => !s.isCta)
        .map(({ text, fromSec, toSec }) => ({ text, fromSec, toSec }));
      const drift = retimed.totalSec - concatTotal;
      if (Math.abs(drift) > 0.15) {
        console.warn(
          `[yt-edit] 재동기화 잔차 ${drift.toFixed(2)}s — 세그먼트 합(${retimed.totalSec.toFixed(2)}s)과 ` +
            `xfade 결과(${concatTotal.toFixed(2)}s)가 다릅니다. 타이밍 수식을 확인하세요.`
        );
      }
    }

    // 4) 오버레이 PNG 준비(워터마크·인트로·자막) — 전부 투명 여백을 잘라 합성 비용을 없앤다.
    const wm = await writeOverlay(watermarkNode(), path.join(workDir, "wm.png"));

    let intro: OverlayAsset | null = null;
    if (opts.headline) {
      intro = await writeOverlay(
        introNode(opts.headline, opts.villaName, opts.introSpecs ?? []),
        path.join(workDir, "intro.png")
      );
    }

    // ★ 인트로가 떠 있는 동안에는 자막을 띄우지 않는다(2026-07-23 실빌라 렌더 교훈).
    //   인트로(헤드라인 + 빌라명 + 스펙 칩)와 자막이 동시에 뜨면 화면이 빽빽해져 **둘 다 안 읽힌다.**
    //   훅은 음성이 전달하고, 화면은 인트로가 맡는다 — 자막은 인트로가 사라진 뒤부터.
    const introEnd =
      opts.headline && opts.introHoldSec != null
        ? Math.max(INTRO_SEC, opts.introHoldSec)
        : opts.headline
          ? INTRO_SEC
          : 0;
    const subs = subtitleList
      .map((s) => ({ ...s, fromSec: Math.max(s.fromSec, introEnd) }))
      // 인트로에 거의 다 가려진 자막은 깜빡이기만 하므로 아예 버린다
      .filter((s) => s.fromSec < total && s.toSec - s.fromSec >= 0.6);
    const subPaths: (OverlayAsset & { from: number; to: number })[] = [];
    for (let i = 0; i < subs.length; i++) {
      const asset = await writeOverlay(subtitleNode(subs[i].text), path.join(workDir, `sub-${i}.png`));
      subPaths.push({ ...asset, from: subs[i].fromSec, to: Math.min(subs[i].toSec, total) });
    }

    // 5) 최종 합성(오버레이 + 오디오).
    //
    // ── 입력 수 줄이기(2026-07-23 프로덕션 실패 2차) ──────────────────
    // ffmpeg는 입력·필터마다 스레드를 띄운다. 30컷 영상의 최종 합성은 입력이 42개였고
    // 컨테이너 한도에 걸려 죽었다(code -11). 두 가지로 줄인다:
    //   ⑴ 나레이션 WAV들 + 배경음을 **미리 한 파일로 믹스**(10개 → 1개)
    //   ⑵ 자막이 많으면 앞부분을 **사전 패스로 얹어** 최종에는 일부만 남긴다
    // 자막이 적은 기존 영상은 사전 패스가 없어 경로가 그대로다.
    const narrationPathsAll = opts.narration?.wavPaths ?? [];
    let premixedAudio: string | null = null;
    if (narrationPathsAll.length > 0) {
      premixedAudio = path.join(workDir, "audio.wav");
      await premixNarrationAudio(
        narrationPathsAll,
        narrationOffsets,
        total,
        opts.bgm !== "none",
        premixedAudio
      );
    }

    // 최종 패스에 남길 자막 수 = 상한 − (본편 1 + 워터마크 1 + 인트로 1 + 오디오 1)
    const subsInFinal = Math.max(1, MAX_FINAL_INPUTS - 4);
    let baseVideo = concatPath;
    let pending = subPaths;
    let preIdx = 0;
    while (pending.length > subsInFinal) {
      const take = Math.min(subsInFinal, pending.length - subsInFinal);
      const batch = pending.slice(0, take);
      pending = pending.slice(take);
      const stage = path.join(workDir, `ov-${preIdx++}.mp4`);
      await overlaySubtitlePass(baseVideo, batch, total, stage);
      baseVideo = stage;
    }
    const finalSubs = pending;
    if (preIdx > 0) {
      console.info(`[yt-edit] 자막 사전 패스 ${preIdx}회 · 최종 패스 자막 ${finalSubs.length}장`);
    }

    const outPath = path.join(workDir, "final.mp4");
    const inputArgs: string[] = ["-i", baseVideo, "-loop", "1", "-i", wm.path];
    let idx = 2; // 0=concat, 1=wm
    let introIdx = -1;
    if (intro) {
      inputArgs.push("-loop", "1", "-i", intro.path);
      introIdx = idx++;
    }
    const subIdx: number[] = [];
    for (const s of finalSubs) {
      inputArgs.push("-loop", "1", "-i", s.path);
      subIdx.push(idx++);
    }
    // 오디오 입력 — 나레이션은 이미 한 파일로 믹스됐다(입력 1개). 없으면 기존 무음/앰비언트 소스.
    if (premixedAudio) {
      inputArgs.push("-i", premixedAudio);
    } else {
      inputArgs.push(...audioInputArgs(opts.audio, total));
    }
    const audioIdx = idx;
    idx += 1;

    const fParts: string[] = [];
    let cur = "[0:v]";
    // 워터마크(전 구간)
    fParts.push(`${cur}[1:v]overlay=${wm.x}:${wm.y}[wm]`);
    cur = "[wm]";
    // 인트로(0~introHold)
    if (introIdx >= 0) {
      // ★ 인트로 표시 시간: 나레이션이 있으면 **첫 문장이 끝날 때까지** 유지한다.
      //   고정 1.5초로 두면 스펙("침실 셋·수영장·해변 앞")이 사라진 뒤에도 그 설명이 계속 들려
      //   화면과 말이 어긋난다(테오 피드백 2026-07-22). 음소거 시청자에게도 스펙이 남아야 한다.
      const introHold = opts.introHoldSec != null ? Math.max(INTRO_SEC, opts.introHoldSec) : INTRO_SEC;
      // 부드럽게 사라진다 — 예전엔 오버레이가 프레임 하나 만에 뚝 꺼져 "깜빡"거렸다.
      const introFade = Math.min(0.6, introHold / 3);
      fParts.push(
        `[${introIdx}:v]format=rgba,fade=t=out:st=${(introHold - introFade).toFixed(2)}:d=${introFade.toFixed(2)}:alpha=1[introf]`
      );
      fParts.push(
        `${cur}[introf]overlay=${intro!.x}:${intro!.y}:enable='between(t,0,${introHold.toFixed(2)})'[intro]`
      );
      cur = "[intro]";
    }
    // 자막 구간별 — 팝인/팝아웃 대신 **페이드**로 뜨고 진다(video-pacing-quality).
    //   ★ 오버레이 PNG는 `-loop 1` 무한 스트림이라 자체 타임스탬프가 본편과 같은 시간축을 쓴다.
    //     그래서 fade의 st에 **절대 시각**을 그대로 넣으면 된다.
    finalSubs.forEach((s, i) => {
      const out = `[s${i}]`;
      const span = Math.max(0.2, s.to - s.from);
      const fade = Math.min(0.22, span / 4);
      fParts.push(
        `[${subIdx[i]}:v]format=rgba,` +
          `fade=t=in:st=${s.from.toFixed(2)}:d=${fade.toFixed(2)}:alpha=1,` +
          `fade=t=out:st=${(s.to - fade).toFixed(2)}:d=${fade.toFixed(2)}:alpha=1[subf${i}]`
      );
      fParts.push(
        `${cur}[subf${i}]overlay=${s.x}:${s.y}:enable='between(t,${s.from.toFixed(2)},${s.to.toFixed(2)})'${out}`
      );
      cur = out;
    });
    // 최종 비디오 라벨 정리
    fParts.push(`${cur}format=yuv420p[vout]`);

    let audioMap = `${audioIdx}:a`;
    if (premixedAudio) {
      // 나레이션·배경음·리미터는 프리믹스에서 이미 끝났다 — 여기선 그대로 싣기만 한다.
      audioMap = `${audioIdx}:a`;
    } else if (opts.audio === "ambient") {
      const fadeOutStart = Math.max(0, total - 1.2).toFixed(3);
      fParts.push(`[${audioIdx}:a]afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOutStart}:d=1.2[aud]`);
      audioMap = "[aud]";
    }

    await run(FFMPEG_PATH, [
      "-y",
      ...inputArgs,
      "-filter_complex", fParts.join(";"),
      "-map", "[vout]",
      "-map", audioMap,
      "-c:v", "libx264",
      "-preset", FINAL_PRESET,
      "-crf", FINAL_CRF,
      "-maxrate", FINAL_MAXRATE,
      "-bufsize", FINAL_BUFSIZE,
      "-profile:v", "high",
      "-level", "4.0",
      "-pix_fmt", "yuv420p",
      "-r", String(FPS),
      "-g", String(FPS * 2),
      "-c:a", "aac",
      "-b:a", "160k",
      "-ar", "44100",
      "-movflags", "+faststart",
      "-t", total.toFixed(3),
      outPath,
    ]);

    const mp4 = await fs.readFile(outPath);
    if (mp4.length > MAX_MP4_BYTES) {
      throw new Error(`편집 MP4가 200MB를 초과했습니다(${(mp4.length / 1024 / 1024).toFixed(1)}MB)`);
    }

    // 6) 포스터(인트로가 보이는 프레임 추출).
    const posterPath = path.join(workDir, "poster.jpg");
    const posterAt = Math.min(1.0, total / 2);
    await run(FFMPEG_PATH, [
      "-y",
      "-ss", posterAt.toFixed(3),
      "-i", outPath,
      "-frames:v", "1",
      // 포스터는 유튜브·인스타 썸네일로 그대로 쓰인다 — 인코딩 품질을 아끼지 않는다.
      "-q:v", "2",
      posterPath,
    ]);
    const poster = await fs.readFile(posterPath);

    return {
      mp4,
      poster,
      durationSec: Math.round(total),
      width: W,
      height: H,
      clipCount: clips.length,
      audio: opts.audio,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface EditJobRenderResult {
  videoUrl: string;
  posterUrl: string;
  durationSec: number;
}

/**
 * 편집 잡 실행(프로덕션 진입점): R2 클립 다운로드 → renderEditedVideo → R2 업로드(비디오+포스터).
 * @param params 검증된 EditParams
 * @param ctx villaName(공개·표시용) — 인트로 부제
 */
export async function runYoutubeEditJob(
  params: EditParams,
  ctx: { villaName?: string | null; baseName: string; introSpecs?: string[] }
): Promise<EditJobRenderResult> {
  const dlDir = path.join(os.tmpdir(), `yt-edit-dl-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(dlDir, { recursive: true });
  try {
    // 클립 다운로드(tmp).
    const local: LocalClip[] = [];
    for (let i = 0; i < params.clips.length; i++) {
      const c = params.clips[i];
      const ext = c.key.endsWith(".mov") ? "mov" : "mp4";
      const fp = path.join(dlDir, `clip-${String(i).padStart(2, "0")}.${ext}`);
      const buf = await getR2ObjectBuffer(c.key);
      await fs.writeFile(fp, buf);
      local.push({
        path: fp,
        startSec: c.startSec ?? 0,
        durationSec: c.durationSec ?? CLIP_DUR_DEFAULT,
        // 페이싱 판정 입력 — 여기가 비면 모든 컷이 정속으로 돌아간다.
        space: c.space ?? null,
        note: c.note ?? null,
        pace: c.pace,
      });
    }

    // ── AI 나레이션 (villa-clip-narration-p2) ──────────────────────
    // 대본 → TTS → **실제 오디오 길이로 컷 길이를 역산** → 자막도 같은 문장에서 파생.
    // TTS 실패 시엔 렌더 전체를 죽이지 않고 기존 audio 모드로 폴백한다(계약 C5) —
    // 나레이션 없는 영상이 "영상 없음"보다 낫다.
    let narrationTrack: NarrationTrack | undefined;
    let narrationCtaSec: number | undefined;
    let narrationIntroHoldSec: number | undefined;
    let subtitles = params.subtitles;
    if (params.narration && params.narration.lines.length > 0) {
      try {
        const synth = await synthesizeNarration(params.narration.lines, {
          voice: params.narration.voice,
        });
        const timeline = computeNarrationTimeline({
          lines: synth.map((s) => ({ durationSec: s.durationSec, parts: s.parts })),
          transitionSec: TRANSITION_SEC,
          minSegmentSec: CLIP_DUR_MIN,
          // 이동 컷만 화면 점유 하한을 낮춘다 — 공통 2초를 복도에도 걸면 배속을 해도
          // "빠르게 지나간다"는 느낌이 안 산다(pacing.ts TRANSIT_MIN_SCREEN_SEC).
          minSegmentSecByClip:
            params.pacing !== false
              ? params.clips.map((c) =>
                  minScreenSecFor(resolveClipPace(c.space, c.note, c.pace), CLIP_DUR_MIN)
                )
              : undefined,
          // 이동 컷은 화면 점유 시간에 **상한**도 씌운다 — 배속만으로는 "빠르게 지나가되
          // 오래 머무는" 컷이 나온다. 깎인 시간은 같은 문장의 보여줄 컷들이 가져간다.
          maxSegmentSecByClip:
            params.pacing !== false
              ? params.clips.map((c) => maxScreenSecFor(resolveClipPace(c.space, c.note, c.pace)))
              : undefined,
          ctaMinSec: CTA_DUR_SEC,
        });

        // 문장 WAV를 tmp에 기록(ffmpeg 입력).
        const wavPaths: string[] = [];
        for (let i = 0; i < synth.length; i++) {
          const wp = path.join(dlDir, `narr-${String(i).padStart(2, "0")}.wav`);
          await fs.writeFile(wp, synth[i].wav);
          wavPaths.push(wp);
        }
        narrationTrack = {
          wavPaths,
          offsetsSec: timeline.lineOffsets,
          // 실측 재동기화용 원본 구조 — 이게 있어야 감속 상한에 걸린 컷의 오차가 누적되지 않는다.
          lines: synth.map((s) => ({ durationSec: s.durationSec, parts: s.parts })),
        };

        // 컷 길이 역산 — 절(節) 단위로 산출된 값을 그대로 쓴다.
        for (let i = 0; i < local.length; i++) {
          const d = timeline.clipDurations[i];
          if (typeof d === "number" && Number.isFinite(d)) local[i].durationSec = d;
        }
        // CTA 카드 길이 — 안 넘기면 2.8초 고정이라 마지막 문장이 잘린다.
        narrationCtaSec = timeline.ctaDurationSec;
        // 인트로(스펙 칩)는 첫 문장이 끝날 때까지 유지 — 고정 1.5초면 설명이 남았는데 칩이 사라진다.
        narrationIntroHoldSec = timeline.lineOffsets[0] + synth[0].durationSec + 0.4;
        // 자막 = 나레이션과 같은 소스(단일 진실), **절 단위**라 컷마다 바뀐다.
        // ★ CTA 절은 자막에서 제외 — 아웃트로 카드가 같은 내용을 큰 글씨로 이미 보여준다(겹침 방지).
        subtitles = timeline.subtitles
          .filter((s) => !s.isCta)
          .map(({ text, fromSec, toSec }) => ({ text, fromSec, toSec }));
      } catch (e) {
        // 키 미설정·API 실패·상한 초과 — 나레이션 없이 진행(무음/앰비언트 기존 경로).
        // ★ 조용히 삼키면 "왜 나레이션이 없지?"를 아무도 추적할 수 없다. 사유를 반드시 남긴다.
        console.error(
          `[yt-edit] 나레이션 합성 실패 — 무음/앰비언트로 폴백합니다: ${e instanceof Error ? e.message : String(e)}`
        );
        narrationTrack = undefined;
      }
    }

    const rendered = await renderEditedVideo(local, {
      headline: params.headline,
      villaName: ctx.villaName,
      subtitles,
      audio: params.audio,
      horizontalMode: params.horizontalMode,
      narration: narrationTrack,
      // 나레이션 마지막 문장이 CTA 카드 위에서 재생된다 — 카드 길이를 그 문장에 맞춘다.
      ctaDurationSec: narrationCtaSec,
      // ★ 오프닝 스펙 칩·인트로 유지시간(QA M-6): 예전엔 스모크 스크립트에만 배선돼 있어
      //   **운영 렌더에서는 스펙 칩이 절대 표시되지 않았다.** 음소거 시청자에게 침실 수·수영장·
      //   해변 거리를 전달하는 게 오프닝 훅의 핵심이라 여기서도 넘긴다.
      ctaOverride: params.ctaVariant === "instagram" ? INSTAGRAM_REEL_CTA : undefined,
      introSpecs: ctx.introSpecs,
      introHoldSec: narrationIntroHoldSec,
      bgm: params.bgm,
      pacing: params.pacing,
    });

    const { url: videoUrl } = await saveYoutubeRenderedVideo(rendered.mp4, ctx.baseName);
    const { url: posterUrl } = await saveYoutubeRenderPoster(rendered.poster, ctx.baseName);

    return { videoUrl, posterUrl, durationSec: rendered.durationSec };
  } finally {
    await fs.rm(dlDir, { recursive: true, force: true }).catch(() => {});
  }
}
