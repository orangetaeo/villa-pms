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
import { wrapHeadlineToFit } from "@/lib/instagram/headline-wrap";
import { YOUTUBE_REEL_CTA, type ReelAudioMode } from "@/lib/instagram/reels";
import { computeNarrationTimeline, synthesizeNarration } from "@/lib/youtube/narration";
import {
  getR2ObjectBuffer,
  saveYoutubeRenderedVideo,
  saveYoutubeRenderPoster,
} from "@/lib/storage";
import { readFileSync } from "fs";

const FFMPEG_PATH: string = ffmpegStatic ?? "ffmpeg";
const FFPROBE_PATH: string = ffprobeStatic.path;

const W = 1080;
const H = 1920;
const FPS = 30;

const CLIP_DUR_DEFAULT = 4;
const CLIP_DUR_MIN = 2;
const CLIP_DUR_MAX = 8;
// 빌라 투어는 입구·수영장·거실·주방·침실N·욕실·발코니를 다 보여줘야 설득력이 생긴다.
// 8컷으로는 "맛보기"밖에 안 된다(테오 피드백 2026-07-22) — 16컷까지 허용.
const CLIP_COUNT_MAX = 16;

const TRANSITION_SEC = 0.4; // xfade 크로스페이드 길이(세그먼트가 짧으면 축소)
const CTA_DUR_SEC = 2.8; // 아웃트로 CTA 정지 카드
const INTRO_SEC = 1.5; // 인트로 타이틀 표시 구간
// 유튜브 쇼츠 상한(하드 컷). ★2024-10 이후 60초 → **3분**으로 상향됐다(인스타 릴스도 인앱 3분).
//   60초로 두면 "쇼츠=1분"이라는 낡은 공식에 갇혀 빌라를 제대로 못 보여준다(테오 피드백 2026-07-22).
const TOTAL_MAX_SEC = 180;
// 나레이션 문장 수 상한 — 클립 8개 + CTA 1개. 대본 규칙(3~5문장)보다 넉넉히 두고 구조만 막는다.
const NARRATION_LINES_MAX = CLIP_COUNT_MAX + 1;
const MAX_MP4_BYTES = 200 * 1024 * 1024;

// 클립 저장 키 형식 — presign이 발급한 것만 허용(임의 R2 키 조회 차단). youtube-clips/{hex}.{mp4|mov}
const CLIP_KEY_RE = /^youtube-clips\/[a-zA-Z0-9]+\.(mp4|mov)$/;

// ── 파라미터 스키마 (FE가 그대로 사용 — 반환 보고에 명세) ──
export interface EditClipInput {
  key: string; // presign 발급 R2 키 (youtube-clips/{hex}.{ext})
  startSec?: number; // 트림 시작(기본 0)
  durationSec?: number; // 트림 길이(기본 4, 2~8 클램프)
}
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
    return { key, startSec, durationSec };
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

  return { clips, headline, villaId, subtitles, audio, horizontalMode, narration };
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
async function nodeToJpeg(node: SatoriNode, bg: string): Promise<Buffer> {
  return sharp(Buffer.from(await nodeToSvg(node)))
    .flatten({ background: bg })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

// ── 오버레이 노드(1080×1920 투명) ──
/** 우상단 반투명 워드마크 "VILLA GO" 워터마크 — 전 구간 표시. */
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
        padding: "14px 28px",
      },
      div(
        { fontFamily: FONT_SANS, fontWeight: 700, fontSize: 34, letterSpacing: 6, color: "rgba(255,249,240,0.92)" },
        "VILLA GO"
      )
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
        div({ width: 74, height: 4, backgroundColor: BRAND.sand, marginBottom: 34 }),
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
  "4px 4px 0 #000",
  "-4px 4px 0 #000",
  "4px -4px 0 #000",
  "-4px -4px 0 #000",
  "0 5px 0 #000",
  "0 -5px 0 #000",
  "5px 0 0 #000",
  "-5px 0 0 #000",
  "0 0 18px rgba(0,0,0,0.75)", // 밝은 배경에서 글자 경계를 한 번 더 살린다
].join(",");

const SUBTITLE_FONT_SIZE = 66;
const SUBTITLE_MAX_WIDTH = W - 140; // 좌우 패딩 70px

function subtitleNode(rawText: string): SatoriNode {
  // ★ 어절 단위 줄바꿈 필수: satori는 한글을 **글자 단위로** 흘려서 "부/부에게", "친구나 아/이들이"
  //   처럼 단어 한가운데가 끊긴다(2026-07-22 실제 렌더 확인 — 자막을 44→66px로 키우자 재발).
  //   기존 [[satori-korean-orphan-headline-wrap]] 교훈의 동일 클래스라 같은 모듈을 재사용한다.
  const text = wrapHeadlineToFit(rawText, SUBTITLE_FONT_SIZE, SUBTITLE_MAX_WIDTH);
  return div({ position: "relative", width: W, height: H, backgroundColor: "transparent" }, [
    div(
      {
        position: "absolute",
        left: 0,
        bottom: 300,
        width: W,
        justifyContent: "center",
        padding: "0 70px",
      },
      div(
        {
          fontFamily: FONT_SANS,
          fontWeight: 700,
          fontSize: SUBTITLE_FONT_SIZE,
          lineHeight: 1.28,
          color: "#FFFFFF",
          textAlign: "center",
          textShadow: SUBTITLE_OUTLINE,
          whiteSpace: "pre-line",
          flexDirection: "column",
          maxWidth: SUBTITLE_MAX_WIDTH,
        },
        text
      )
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
}

async function normalizeClip(
  clip: LocalClip,
  outPath: string,
  horizontalMode: "crop" | "blur"
): Promise<void> {
  const useBlur = horizontalMode === "blur" && (await probeIsHorizontal(clip.path));
  const filter = normalizeFilter(useBlur ? "blur" : "crop");
  await run(FFMPEG_PATH, [
    "-y",
    "-ss", clip.startSec.toFixed(3),
    "-t", clip.durationSec.toFixed(3),
    "-i", clip.path,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    outPath,
  ]);
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
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    outPath,
  ]);
}

/** 세그먼트들 xfade 크로스페이드 연결(비디오 전용). @returns 최종 길이(초). */
async function xfadeConcat(segPaths: string[], durations: number[], outPath: string): Promise<number> {
  const m = segPaths.length;
  const minDur = Math.min(...durations);
  const T = Math.max(0.1, Math.min(TRANSITION_SEC, minDur / 2));

  const inputs: string[] = [];
  for (const p of segPaths) inputs.push("-i", p);

  const parts: string[] = [];
  let prev = "[0:v]";
  let prevOut = durations[0];
  for (let k = 1; k < m; k++) {
    const offset = Math.max(0, prevOut - T);
    const out = k === m - 1 ? "[vout]" : `[x${k}]`;
    parts.push(`${prev}[${k}:v]xfade=transition=fade:duration=${T.toFixed(3)}:offset=${offset.toFixed(3)}${out}`);
    prev = out;
    prevOut = prevOut + durations[k] - T;
  }
  const total = prevOut;

  const filter = m === 1 ? `[0:v]null[vout]` : parts.join(";");
  await run(FFMPEG_PATH, [
    "-y",
    ...inputs,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    outPath,
  ]);
  return total;
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
   * 아웃트로 CTA 카드 길이(초). 미지정 시 CTA_DUR_SEC(2.8).
   * ★ 나레이션 사용 시 반드시 넘겨라 — 마지막 문장이 이 카드 위에서 재생되므로,
   *   기본값보다 문장이 길면 말이 끝나기 전에 영상이 끝난다.
   */
  ctaDurationSec?: number;
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

    // 1) 정규화·트림.
    const segPaths: string[] = [];
    const segDurs: number[] = [];
    for (let i = 0; i < clips.length; i++) {
      const seg = path.join(workDir, `seg-${String(i).padStart(2, "0")}.mp4`);
      await normalizeClip(
        { ...clips[i], durationSec: Math.max(CLIP_DUR_MIN * 0.5, clips[i].durationSec * scale) },
        seg,
        opts.horizontalMode
      );
      const d = (await probeDurationSec(seg)) ?? clips[i].durationSec * scale;
      segPaths.push(seg);
      segDurs.push(d);
    }

    // 2) 아웃트로 CTA 정지 카드 세그먼트.
    const ctaJpeg = await nodeToJpeg(reelCta916(YOUTUBE_REEL_CTA), BRAND.teal);
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
    const concatTotal = await xfadeConcat(segPaths, segDurs, concatPath);
    const total = Math.min(concatTotal, TOTAL_MAX_SEC);

    // 4) 오버레이 PNG 준비(워터마크·인트로·자막).
    const wmPath = path.join(workDir, "wm.png");
    await fs.writeFile(wmPath, await nodeToTransparentPng(watermarkNode()));

    let introPath: string | null = null;
    if (opts.headline) {
      introPath = path.join(workDir, "intro.png");
      await fs.writeFile(
        introPath,
        await nodeToTransparentPng(introNode(opts.headline, opts.villaName, opts.introSpecs ?? []))
      );
    }

    const subs = (opts.subtitles ?? []).filter((s) => s.fromSec < total);
    const subPaths: { path: string; from: number; to: number }[] = [];
    for (let i = 0; i < subs.length; i++) {
      const sp = path.join(workDir, `sub-${i}.png`);
      await fs.writeFile(sp, await nodeToTransparentPng(subtitleNode(subs[i].text)));
      subPaths.push({ path: sp, from: subs[i].fromSec, to: Math.min(subs[i].toSec, total) });
    }

    // 5) 최종 합성(오버레이 + 오디오).
    const outPath = path.join(workDir, "final.mp4");
    const inputArgs: string[] = ["-i", concatPath, "-loop", "1", "-i", wmPath];
    let idx = 2; // 0=concat, 1=wm
    let introIdx = -1;
    if (introPath) {
      inputArgs.push("-loop", "1", "-i", introPath);
      introIdx = idx++;
    }
    const subIdx: number[] = [];
    for (const s of subPaths) {
      inputArgs.push("-loop", "1", "-i", s.path);
      subIdx.push(idx++);
    }
    // 오디오 입력 — 나레이션이 있으면 문장 WAV들을, 없으면 기존 무음/앰비언트 소스를 넣는다.
    const narrationPaths = opts.narration?.wavPaths ?? [];
    if (narrationPaths.length > 0) {
      for (const wp of narrationPaths) inputArgs.push("-i", wp);
    } else {
      inputArgs.push(...audioInputArgs(opts.audio, total));
    }
    const audioIdx = idx;

    const fParts: string[] = [];
    let cur = "[0:v]";
    // 워터마크(전 구간)
    fParts.push(`${cur}[1:v]overlay=0:0[wm]`);
    cur = "[wm]";
    // 인트로(0~1.5s)
    if (introIdx >= 0) {
      // ★ 인트로 표시 시간: 나레이션이 있으면 **첫 문장이 끝날 때까지** 유지한다.
      //   고정 1.5초로 두면 스펙("침실 셋·수영장·해변 앞")이 사라진 뒤에도 그 설명이 계속 들려
      //   화면과 말이 어긋난다(테오 피드백 2026-07-22). 음소거 시청자에게도 스펙이 남아야 한다.
      const introHold = opts.introHoldSec != null ? Math.max(INTRO_SEC, opts.introHoldSec) : INTRO_SEC;
      fParts.push(
        `${cur}[${introIdx}:v]overlay=0:0:enable='between(t,0,${introHold.toFixed(2)})'[intro]`
      );
      cur = "[intro]";
    }
    // 자막 구간별
    subPaths.forEach((s, i) => {
      const out = `[s${i}]`;
      fParts.push(
        `${cur}[${subIdx[i]}:v]overlay=0:0:enable='between(t,${s.from.toFixed(2)},${s.to.toFixed(2)})'${out}`
      );
      cur = out;
    });
    // 최종 비디오 라벨 정리
    fParts.push(`${cur}format=yuv420p[vout]`);

    let audioMap = `${audioIdx}:a`;
    if (narrationPaths.length > 0) {
      // 나레이션: 무음 베이스 + 문장별 절대 오프셋 배치(adelay) + amix. 음악 없음.
      fParts.push(narrationFilter(audioIdx, opts.narration!.offsetsSec, total));
      audioMap = "[aud]";
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
      "-preset", "veryfast",
      "-profile:v", "high",
      "-level", "4.0",
      "-pix_fmt", "yuv420p",
      "-r", String(FPS),
      "-c:a", "aac",
      "-b:a", "128k",
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
      "-q:v", "3",
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
      local.push({ path: fp, startSec: c.startSec ?? 0, durationSec: c.durationSec ?? CLIP_DUR_DEFAULT });
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
          ctaMinSec: CTA_DUR_SEC,
        });

        // 문장 WAV를 tmp에 기록(ffmpeg 입력).
        const wavPaths: string[] = [];
        for (let i = 0; i < synth.length; i++) {
          const wp = path.join(dlDir, `narr-${String(i).padStart(2, "0")}.wav`);
          await fs.writeFile(wp, synth[i].wav);
          wavPaths.push(wp);
        }
        narrationTrack = { wavPaths, offsetsSec: timeline.lineOffsets };

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
      } catch {
        // 키 미설정·API 실패·상한 초과 — 나레이션 없이 진행(무음/앰비언트 기존 경로)
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
      introSpecs: ctx.introSpecs,
      introHoldSec: narrationIntroHoldSec,
    });

    const { url: videoUrl } = await saveYoutubeRenderedVideo(rendered.mp4, ctx.baseName);
    const { url: posterUrl } = await saveYoutubeRenderPoster(rendered.poster, ctx.baseName);

    return { videoUrl, posterUrl, durationSec: rendered.durationSec };
  } finally {
    await fs.rm(dlDir, { recursive: true, force: true }).catch(() => {});
  }
}
