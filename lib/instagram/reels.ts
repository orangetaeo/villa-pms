// lib/instagram/reels.ts — 릴스(사진 슬라이드쇼 MP4) 생성 파이프라인 (instagram-marketing-p2 §B)
//
// 흐름:
//   렌더 프레임(1080×1920 JPEG 버퍼, render.ts renderReelFrameBuffers)
//   → sharp로 정확히 1080×1920 정규화(임의 크기 입력도 안전)
//   → 임시 파일 기록 → ffmpeg(ffmpeg-static)로 xfade 크로스페이드 슬라이드쇼 H.264/AAC MP4 합성
//   → MP4 버퍼 반환(호출부가 saveInstagramVideo로 R2 업로드).
//
// ★ ffmpeg 확보: 시스템 ffmpeg 존재 가정 금지 — ffmpeg-static npm 정적 바이너리(크로스 플랫폼, 로컬 Windows·
//   Railway Linux 모두 동작)를 spawn. 실행파일 경로는 패키지 default export.
// ★ BGM(§B): 기본은 **무음 AAC 트랙**(컨테이너에 항상 AAC 존재 → 발행 규격 충족, 운영자가 인스타 앱에서
//   트렌드 음원을 얹기 좋음). 옵션 "ambient"는 ffmpeg aevalsrc로 **직접 합성한** 부드러운 패드(번들 음원 파일
//   없음 → 저작권 리스크 0). 라이선스 근거: assets/audio/LICENSE.md.
import { spawn } from "child_process";
import { promises as fs, existsSync } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";
import { renderReelFrameBuffers, type SlideInput } from "@/lib/instagram/render";
import { REEL_CANVAS } from "@/lib/instagram/reel-templates";
import type { CtaData } from "@/lib/instagram/templates";
import { saveInstagramVideo, saveInstagramRender } from "@/lib/storage";

/**
 * 유튜브 쇼츠용 엔딩 CTA(youtube-shorts-s1) — 유튜브 설명·영상엔 링크가 클릭되지 않으므로
 * "프로필 링크" 대신 카카오톡 채널 검색을 안내한다. renderAndBuildReel({ ctaOverride: YOUTUBE_REEL_CTA }).
 * ★ 인스타 경로는 이 옵션 미지정이 기본값 → 기존 동작 완전 동일.
 */
export const YOUTUBE_REEL_CTA: CtaData = {
  headline: "예약 · 견적 문의는\n카카오톡 채널\n'빌라고' 검색",
  kakaoLabel: "카카오톡 채널 '빌라고' 검색",
  helper: "유튜브에선 링크가 안 눌려요 — 카카오톡에서 '빌라고'를 검색해 주세요",
};

/**
 * 인스타그램 릴스용 엔딩 CTA — 인스타는 **프로필 링크가 눌린다**.
 * ★ 유튜브 문구("유튜브에선 링크가 안 눌려요")를 그대로 인스타에 올리면 엉뚱한 안내가 된다
 *   (2026-07-22 실측: edit.ts가 YOUTUBE_REEL_CTA를 하드코딩하고 있었다).
 *   문구는 사진 캐러셀 CTA(lib/instagram/draft.ts CTA_DATA)와 통일한다.
 *   kakaoLabel·helper는 템플릿 기본값(카카오톡으로 상담하기 / 프로필 링크를 눌러…) 사용.
 */
export const INSTAGRAM_REEL_CTA: CtaData = {
  headline: "예약 · 견적 문의는\n프로필 링크 →\n카카오톡 상담",
};

const FFMPEG_PATH: string = ffmpegStatic ?? "ffmpeg";

// 저작권 프리 라운지 배경음(합성) — C–Am–F–G 코드 진행(2초/코드, 8초 루프) + 부드러운 스웰.
//   번들 음원 파일 없이 ffmpeg aevalsrc로 100% 생성 → 저작권·Content ID 리스크 0(assets/audio/LICENSE.md).
//   각 코드 경계(2/4/6/8s)에서 스웰 ENV=0 → 주파수 전환 클릭 없음.
// ★ exprs='...' 작은따옴표로 콤마 보호 — ffmpeg -i lavfi 필터그래프 구분자(,) 충돌 방지(따옴표 없으면 파싱 실패, 실측).
const LOUNGE_ENV = "(0.5-0.5*cos(2*PI*(mod(t,2)/2)))";
const LOUNGE_ROOT = "if(lt(mod(t,8),2),130.81,if(lt(mod(t,8),4),110.0,if(lt(mod(t,8),6),87.31,98.0)))";
const LOUNGE_THIRD = "if(lt(mod(t,8),2),164.81,if(lt(mod(t,8),4),130.81,if(lt(mod(t,8),6),110.0,123.47)))";
const LOUNGE_FIFTH = "if(lt(mod(t,8),2),196.0,if(lt(mod(t,8),4),164.81,if(lt(mod(t,8),6),130.81,146.83)))";
const LOUNGE_VOICE = `0.10*${LOUNGE_ENV}*(sin(2*PI*(${LOUNGE_ROOT})*t)+sin(2*PI*(${LOUNGE_THIRD})*t)+sin(2*PI*(${LOUNGE_FIFTH})*t))`;

// 번들 배경음(실음원) — CC0 밝은 트랙 "Happy Whistling Ukulele"(FreePD, CC0-1.0, 출처표기 불필요).
//   파일 경로. 없으면 buildReelVideo가 무음으로 폴백(안전). 볼륨은 영상 배경용으로 낮춘다.
const REEL_BGM_PATH = path.join(process.cwd(), "assets", "audio", "reel-bgm.mp3");
const REEL_BGM_VOLUME = 0.7; // 원곡 피크 0dB → 잘 들리는 배경 레벨(피크 ≈-6dB, 클리핑 없음). 영상에 다른 소리 없어 음악이 주가 됨.

// 타이밍: 프레임당 기준 2.6s, 전환 0.5s, 총 길이는 [10s, 16s]로 클램프(§B "총 10~16초").
//   총 길이를 먼저 클램프한 뒤 프레임당 표시시간 d를 역산 → 프레임 수 4~7에서 항상 10~16초에 안착.
const TRANSITION_SEC = 0.5;
const PER_FRAME_BASE_SEC = 2.6;
const MIN_TOTAL_SEC = 10;
const MAX_TOTAL_SEC = 16;
const FPS = 30;

const MIN_FRAMES = 2;
const MAX_FRAMES = 10; // buildReelVideo 하드 상한
const REEL_TARGET_MAX = 7; // §B 권장 상한(4~7장) — selectReelSlides 기준
const MAX_MP4_BYTES = 100 * 1024 * 1024; // §B "100MB 미만"

export type ReelAudioMode = "silent" | "ambient" | "lounge" | "bundled";

export interface BuildReelOptions {
  audio?: ReelAudioMode; // 기본 "silent"
  transitionSec?: number;
  perFrameBaseSec?: number;
  /**
   * 엔딩 CTA 슬라이드 데이터 교체(유튜브 변형 등). 미지정이면 슬라이드 원본 CTA 유지(인스타 기본, 무변경).
   * renderAndBuildReel에서만 적용된다(buildReelVideo는 프레임 버퍼만 다루므로 무시).
   */
  ctaOverride?: CtaData;
}

export interface ReelVideo {
  mp4: Buffer;
  durationSec: number;
  width: number;
  height: number;
  frameCount: number;
  audio: ReelAudioMode;
  perFrameSec: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 프레임 수 → (총 길이, 프레임당 표시시간). 총 길이를 [10,16]로 클램프 후 d 역산. */
export function computeReelTiming(
  frameCount: number,
  transitionSec = TRANSITION_SEC,
  perFrameBase = PER_FRAME_BASE_SEC
): { totalSec: number; perFrameSec: number; transitionSec: number } {
  const n = frameCount;
  const total = clamp(n * perFrameBase, MIN_TOTAL_SEC, MAX_TOTAL_SEC);
  // total = n*d - (n-1)*T  →  d = (total + (n-1)*T) / n
  const perFrame = (total + (n - 1) * transitionSec) / n;
  return { totalSec: total, perFrameSec: perFrame, transitionSec };
}

/**
 * 임의 크기 입력을 정확히 1080×1920 cover-crop PNG로 정규화(EXIF 회전 반영).
 * ★ PNG 사용 이유: ffmpeg image2 demuxer(-loop 1)는 mozjpeg progressive JPEG를
 *   "Invalid data / unspecified size"로 거부하는 경우가 있다(정적 빌드 실측). PNG는 무손실·무결점 디코드.
 */
async function normalizeFrame(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .rotate()
    .resize(REEL_CANVAS.width, REEL_CANVAS.height, { fit: "cover", position: "attention" })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/** ffmpeg 오디오 입력 인자(무음 / 합성 앰비언트·라운지 / 번들 실음원). infinite 소스는 -t로 트림. */
function audioInputArgs(mode: ReelAudioMode, totalSec: number): string[] {
  if (mode === "bundled") {
    // 실음원 파일을 영상 길이만큼 반복(-stream_loop -1) 입력. 트림·볼륨·페이드는 filter_complex에서.
    return ["-stream_loop", "-1", "-i", REEL_BGM_PATH];
  }
  if (mode === "lounge") {
    // C–Am–F–G 코드 진행 라운지 배경음(합성). exprs='...' 따옴표로 콤마 보호.
    const src = `aevalsrc=exprs='${LOUNGE_VOICE}|${LOUNGE_VOICE}':c=stereo:s=44100:d=${totalSec.toFixed(3)}`;
    return ["-f", "lavfi", "-i", src];
  }
  if (mode === "ambient") {
    // C장조풍 저음 패드(G3·C4·E4) 직접 합성 — 번들 음원 없음, 저작권 리스크 0.
    const expr = `aevalsrc=0.09*sin(2*PI*196*t)+0.06*sin(2*PI*261.63*t)+0.045*sin(2*PI*329.63*t):s=44100:d=${totalSec.toFixed(3)}`;
    return ["-f", "lavfi", "-i", expr];
  }
  return ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
}

/** filter_complex 문자열 구성 — 프레임 정규화 + xfade 크로스페이드 체인 + (앰비언트 시) 오디오 페이드. */
function buildFilterComplex(
  n: number,
  perFrameSec: number,
  transitionSec: number,
  totalSec: number,
  audio: ReelAudioMode
): { filter: string; audioMap: string } {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:v]scale=${REEL_CANVAS.width}:${REEL_CANVAS.height}:force_original_aspect_ratio=increase,` +
        `crop=${REEL_CANVAS.width}:${REEL_CANVAS.height},setsar=1,fps=${FPS},format=yuv420p[v${i}]`
    );
  }

  if (n === 1) {
    parts.push(`[v0]null[vout]`);
  } else {
    let prev = `[v0]`;
    for (let i = 1; i < n; i++) {
      const offset = i * (perFrameSec - transitionSec);
      const out = i === n - 1 ? `[vout]` : `[x${i}]`;
      parts.push(`${prev}[v${i}]xfade=transition=fade:duration=${transitionSec.toFixed(3)}:offset=${offset.toFixed(3)}${out}`);
      prev = out;
    }
  }

  let audioMap = `${n}:a`;
  const fadeOutStart = Math.max(0, totalSec - 1.2).toFixed(3);
  if (audio === "bundled") {
    // 실음원: 영상 길이로 트림 → 배경 볼륨 감쇠 → 시작/끝 페이드.
    parts.push(
      `[${n}:a]atrim=0:${totalSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${REEL_BGM_VOLUME},` +
        `afade=t=in:st=0:d=1.0,afade=t=out:st=${fadeOutStart}:d=1.2[aud]`
    );
    audioMap = `[aud]`;
  } else if (audio !== "silent") {
    // 합성 오디오(앰비언트·라운지)는 시작/끝 1.2s 페이드로 매끄럽게.
    parts.push(`[${n}:a]afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOutStart}:d=1.2[aud]`);
    audioMap = `[aud]`;
  }

  return { filter: parts.join(";"), audioMap };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000); // tail만 보존
    });
    proc.on("error", (e) => reject(new Error(`ffmpeg 실행 실패: ${e.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 종료코드 ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

/**
 * 프레임(JPEG 버퍼 4~7장 권장) → 1080×1920 H.264/AAC 30fps MP4 슬라이드쇼(xfade 크로스페이드).
 * @throws 프레임 수 범위 밖·ffmpeg 실패·100MB 초과.
 */
export async function buildReelVideo(frames: Buffer[], opts: BuildReelOptions = {}): Promise<ReelVideo> {
  const n = frames.length;
  if (n < MIN_FRAMES) throw new Error(`릴스 프레임이 부족합니다(${n} < ${MIN_FRAMES})`);
  if (n > MAX_FRAMES) throw new Error(`릴스 프레임이 너무 많습니다(${n} > ${MAX_FRAMES})`);

  // 번들 실음원 요청인데 파일이 없으면 무음으로 폴백(배포 누락 안전망).
  let audio: ReelAudioMode = opts.audio ?? "silent";
  if (audio === "bundled" && !existsSync(REEL_BGM_PATH)) audio = "silent";
  const { totalSec, perFrameSec, transitionSec } = computeReelTiming(
    n,
    opts.transitionSec ?? TRANSITION_SEC,
    opts.perFrameBaseSec ?? PER_FRAME_BASE_SEC
  );

  const workDir = path.join(os.tmpdir(), `ig-reel-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });
  const outPath = path.join(workDir, "reel.mp4");

  try {
    // 1) 프레임 정규화 + 기록.
    const framePaths: string[] = [];
    for (let i = 0; i < n; i++) {
      const norm = await normalizeFrame(frames[i]);
      const fp = path.join(workDir, `frame-${String(i).padStart(3, "0")}.png`);
      await fs.writeFile(fp, norm);
      framePaths.push(fp);
    }

    // 2) ffmpeg 인자.
    const inputArgs: string[] = [];
    for (let i = 0; i < n; i++) {
      inputArgs.push("-loop", "1", "-t", perFrameSec.toFixed(3), "-i", framePaths[i]);
    }
    inputArgs.push(...audioInputArgs(audio, totalSec));

    const { filter, audioMap } = buildFilterComplex(n, perFrameSec, transitionSec, totalSec, audio);

    const args = [
      "-y",
      ...inputArgs,
      "-filter_complex",
      filter,
      "-map",
      "[vout]",
      "-map",
      audioMap,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-profile:v",
      "high",
      "-level",
      "4.0",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(FPS),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      "-t",
      totalSec.toFixed(3),
      outPath,
    ];

    await runFfmpeg(args);

    const mp4 = await fs.readFile(outPath);
    if (mp4.length > MAX_MP4_BYTES) {
      throw new Error(`릴스 MP4가 100MB를 초과했습니다(${(mp4.length / 1024 / 1024).toFixed(1)}MB)`);
    }

    return {
      mp4,
      durationSec: totalSec,
      width: REEL_CANVAS.width,
      height: REEL_CANVAS.height,
      frameCount: n,
      audio,
      perFrameSec,
    };
  } finally {
    // 임시 파일 정리(실패해도 무시).
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── 슬라이드 → 릴스 프레임 선별 ──────────────────────────
/** 캐러셀 슬라이드(cover, info, raw…, cta)에서 릴스 프레임을 4~7장으로 선별(커버 → 중간 사진 → 엔딩 CTA). */
export function selectReelSlides(slides: SlideInput[]): SlideInput[] {
  const cover = slides.find((s) => s.templateId === "cover");
  const cta = slides.find((s) => s.templateId === "cta");
  const middles = slides.filter((s) => s.templateId !== "cover" && s.templateId !== "cta");

  const reserved = (cover ? 1 : 0) + (cta ? 1 : 0);
  const maxMiddles = Math.max(0, REEL_TARGET_MAX - reserved); // 커버+CTA 포함 총 ≤7장
  const chosen: SlideInput[] = [];
  if (cover) chosen.push(cover);
  chosen.push(...middles.slice(0, maxMiddles));
  if (cta) chosen.push(cta);
  return chosen;
}

// ── 오케스트레이션: 슬라이드 → 렌더 → MP4 → 업로드 ──────
export interface ReelMediaEntry {
  templateId: "reel";
  srcPhotoId: string | null;
  renderedUrl: string; // 포스터(첫 프레임 JPEG) 공개 URL — admin 썸네일·serialize 호환
  overlayText: string | null;
  videoUrl: string; // 발행용 MP4 공개 URL (publish cron REELS 경로가 읽음)
  durationSec: number;
  frameCount: number;
  audio: ReelAudioMode;
}

export interface ReelBuildResult {
  videoUrl: string;
  posterUrl: string;
  durationSec: number;
  frameCount: number;
  audio: ReelAudioMode;
  mediaJson: ReelMediaEntry[];
}

/**
 * 빌라 슬라이드 → 릴스 프레임 렌더 → MP4 합성 → R2 업로드(비디오+포스터) → mediaJson 반환.
 * draft cron이 kind=REELS 포스트 생성 시 호출.
 */
export async function renderAndBuildReel(
  slides: SlideInput[],
  baseName: string,
  opts: BuildReelOptions = {}
): Promise<ReelBuildResult> {
  // 엔딩 CTA 교체(유튜브 변형): ctaOverride 지정 시 cta 슬라이드 data만 교체. 미지정=인스타 기본(무변경).
  const reelSlides = selectReelSlides(slides).map((s) =>
    s.templateId === "cta" && opts.ctaOverride ? { ...s, data: opts.ctaOverride } : s
  );
  const frames = await renderReelFrameBuffers(reelSlides);
  const video = await buildReelVideo(frames, opts);

  const { url: videoUrl } = await saveInstagramVideo(video.mp4, baseName);
  const { url: posterUrl } = await saveInstagramRender(frames[0], `${baseName}-poster`);

  const cover = reelSlides.find((s) => s.templateId === "cover");
  const overlayText = cover && cover.templateId === "cover" ? cover.data.headline : null;

  const entry: ReelMediaEntry = {
    templateId: "reel",
    srcPhotoId: null,
    renderedUrl: posterUrl,
    overlayText,
    videoUrl,
    durationSec: video.durationSec,
    frameCount: video.frameCount,
    audio: video.audio,
  };

  return {
    videoUrl,
    posterUrl,
    durationSec: video.durationSec,
    frameCount: video.frameCount,
    audio: video.audio,
    mediaJson: [entry],
  };
}
