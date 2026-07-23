// lib/youtube/clip-audit.ts — 렌더 전 소재 자동 검수 (clip-audit)
//
// 왜 만들었나(테오 2026-07-23): 완성된 영상을 사람이 보고
//   "식탁이 절반만 나온다" · "여기서 갑자기 변기가 왜 나오냐" · "나레이션은 침대인데 화면은 샤워실"
// 을 매번 짚어 주고 있었다. **그건 사람이 할 일이 아니다.** 이 셋 중 둘은 기계가 잡을 수 있다.
//
// 이 모듈이 잡는 것:
//   ⑴ 선언한 공간과 **실제로 화면에 보이는 공간**이 다른 컷
//      (예: `space: ETC`(이동)로 잘랐는데 그 3초 안에 변기가 크게 잡힘)
//   ⑵ 메모에 적은 피사체가 **실제로 안 보이거나 반만 보이는** 컷
//      (예: note "식탁과 다이닝"인데 화면엔 사이드보드만)
//
// ★ 핵심 통찰(이 검수의 전제): 클립 파일이 8초여도 **실제로 쓰이는 건 앞 3초 남짓**이다.
//   화면 길이는 나레이션이 정하고(보통 3~4초), 페이싱이 원본을 0.88~1.85배로 읽기 때문이다.
//   그래서 "8초짜리 클립 어딘가에 식탁이 있다"는 건 아무 의미가 없다 —
//   **쓰이는 창 안에** 있어야 한다. 검수도 정확히 그 창만 본다.
//
// ★ 누수 0: Gemini에 보내는 건 빌라 영상 프레임과 공간 코드·메모뿐. 금액·재고 정보 없음.
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import ffmpegStatic from "ffmpeg-static";
import { z } from "zod";
import { extractJsonFromAIResponse } from "@/lib/ai-utils";
import { GeminiNotConfiguredError } from "@/lib/gemini";
import { resolveClipPace, type ClipPaceOverride } from "@/lib/youtube/pacing";

const FFMPEG_PATH: string = ffmpegStatic ?? "ffmpeg";
const GEMINI_MODEL = process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const TIMEOUT_MS = 90_000;

/**
 * 검수할 원본 창(초). 화면 길이 3.5초 × 이동 컷 배속 1.85 ≈ 6.5초가 최악이지만,
 * 실제로 시청자 눈에 남는 건 앞부분이라 4초를 본다(프레임 3장).
 */
const AUDIT_WINDOW_SEC = 4;

/** PhotoSpace 한국어 이름 — 모델 응답을 코드로 되돌릴 때와 리포트 표시에 쓴다. */
export const SPACE_LABEL: Record<string, string> = {
  EXTERIOR: "외관·정원",
  LIVING: "거실",
  KITCHEN: "주방·다이닝",
  BEDROOM: "침실",
  BATHROOM: "욕실·화장실",
  BALCONY: "베란다·테라스",
  POOL: "수영장",
  ETC: "복도·계단·기타",
};

export interface AuditClipInput {
  /** 로컬 파일 경로(이미 내려받은 클립) */
  path: string;
  /** 몇 번째 컷인지(1-base, 리포트용) */
  index: number;
  /** 트림 시작(초) */
  startSec: number;
  /** 운영자가 선언한 공간 */
  space: string | null;
  /** 운영자가 적은 피사체 메모 */
  note: string | null;
  /** 완급 지정 */
  pace?: ClipPaceOverride;
}

export type AuditSeverity = "error" | "warn";

export interface AuditFinding {
  index: number;
  severity: AuditSeverity;
  /** 무엇이 잘못됐는지 한 줄 */
  message: string;
  /** 어떻게 고치면 되는지 */
  hint: string;
}

export interface ClipAuditResult {
  findings: AuditFinding[];
  /** 컷별 모델 판정(디버깅·리포트용) */
  seen: { index: number; space: string | null; summary: string }[];
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on("error", (e) => reject(new Error(`ffmpeg 실행 실패: ${e.message}`)));
    proc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${stderr.slice(-500)}`))));
  });
}

/**
 * 실제로 쓰이는 창에서 프레임 3장(앞·중간·끝)을 뽑아 base64 JPEG로 돌려준다.
 *
 * ★ 프레임 하나가 안 나와도 계속한다(2026-07-23): 클립이 검수 창(4초)보다 짧으면 뒤쪽 프레임이
 *   존재하지 않아 ffmpeg가 파일을 안 만든다. 예전엔 그 예외가 위로 던져져 **그 컷 검수가 통째로
 *   건너뛰어졌다** — 짧게 자른 이동 컷이 아무 검사 없이 통과한다는 뜻이라 게이트에 구멍이 된다.
 *   한 장이라도 나오면 그걸로 판정한다.
 */
async function sampleFrames(clip: AuditClipInput, workDir: string): Promise<string[]> {
  const offsets = [0.2, AUDIT_WINDOW_SEC / 2, AUDIT_WINDOW_SEC - 0.3];
  const out: string[] = [];
  for (let i = 0; i < offsets.length; i++) {
    const f = path.join(workDir, `c${clip.index}-${i}.jpg`);
    try {
      await run(FFMPEG_PATH, [
        "-y",
        "-ss", (clip.startSec + offsets[i]).toFixed(2),
        "-i", clip.path,
        "-frames:v", "1",
        // 판정에 충분하면서 토큰을 아끼는 크기
        "-vf", "scale=360:-1",
        "-q:v", "5",
        f,
      ]);
      out.push((await fs.readFile(f)).toString("base64"));
    } catch {
      // 클립 길이를 넘는 지점 — 이 프레임만 건너뛴다
    }
  }
  if (out.length === 0) throw new Error("프레임을 한 장도 추출하지 못했습니다");
  return out;
}

const verdictSchema = z.object({
  space: z.string(),
  summary: z.string(),
  subjectVisible: z.boolean(),
  problems: z.array(z.string()).max(5).optional(),
});

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** 프레임 3장 → 모델 판정. 실패 시 null(검수 자체가 렌더를 막지는 않는다). */
async function judgeClip(
  clip: AuditClipInput,
  frames: string[],
  fetchFn: typeof fetch
): Promise<z.infer<typeof verdictSchema> | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiNotConfiguredError();

  const prompt = [
    "너는 빌라 홍보 영상의 편집 검수자다. 아래 세 장은 **한 컷에서 실제로 사용되는 구간**의 처음·중간·끝 프레임이다.",
    "",
    `편집자가 이 컷에 선언한 공간: ${clip.space ? `${clip.space}(${SPACE_LABEL[clip.space] ?? clip.space})` : "미지정"}`,
    `편집자가 적은 피사체 메모: ${clip.note?.trim() || "(없음)"}`,
    "",
    "판정할 것:",
    "1. space — 이 세 프레임에 **실제로** 보이는 공간을 아래 중 하나로 고른다.",
    `   ${Object.keys(SPACE_LABEL).join(" / ")}`,
    "   여러 공간이 스쳐 지나가면 **가장 오래·크게 보이는** 것을 고른다.",
    "2. summary — 화면에 보이는 것을 한 문장으로(한국어).",
    "3. subjectVisible — 메모에 적힌 것 중 **핵심 하나 이상**이 알아볼 수 있게 보이면 true.",
    "   메모가 '~로 이동'처럼 동작 서술이면 그 동선이 화면에 나타나면 true.",
    "   **완벽하게 전체가 보일 필요는 없다.** 시청자가 '아 이게 그거구나' 하면 true.",
    "   메모의 것이 아예 안 나오거나 다른 공간이 나오면 false.",
    "4. problems — **홍보 영상에 나가면 곤란한 것**만 적는다(한국어, 없으면 빈 배열).",
    "   적을 것: 변기, 쓰레기통·청소도구, 거울에 비친 촬영자, 식별 가능한 사람 얼굴,",
    "            심한 흔들림·초점 나감, 공사 자재·어질러진 물건",
    "   ★ 적지 말 것: 구도가 아쉽다·일부가 잘렸다 같은 **취향 평가**. 그건 문제가 아니다.",
    "",
    "출력은 JSON만:",
    '{"space":"KITCHEN","summary":"원목 식탁과 의자가 정면으로 보인다","subjectVisible":true,"problems":[]}',
  ].join("\n");

  const res = await fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              ...frames.map((data) => ({ inlineData: { mimeType: "image/jpeg", data } })),
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini Vision HTTP ${res.status}`);

  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const raw = extractJsonFromAIResponse<Record<string, unknown>>(text);
  if (!raw) return null;
  const parsed = verdictSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * 선언한 공간과 모델이 본 공간이 "같은 것으로 봐줄 만한가".
 * ★ 이동 컷(ETC)은 정의상 여러 공간을 스쳐 지나가므로 공간 불일치 자체는 문제가 아니다.
 *   문제는 **머물면 안 되는 것이 크게 보이는 것**(변기 등)이라 problems로 따로 잡는다.
 */
function spaceCompatible(declared: string | null, seen: string): boolean {
  if (!declared) return true;
  if (declared === seen) return true;
  // 주방과 거실은 오픈 구조에서 한 프레임에 같이 잡힌다 — 서로 인정한다.
  const pairs: [string, string][] = [
    ["KITCHEN", "LIVING"],
    ["EXTERIOR", "POOL"],
    ["BALCONY", "EXTERIOR"],
    ["BALCONY", "POOL"],
  ];
  return pairs.some(([a, b]) => (declared === a && seen === b) || (declared === b && seen === a));
}

/** 홍보 영상에 나오면 안 되는 것 — problems 문자열에서 찾는다. */
const HARD_PROBLEM_RE = /변기|양변기|toilet/i;

/**
 * 컷들을 렌더 전에 검수한다.
 *
 * @returns 발견 목록. **비어 있으면 통과**.
 * @throws GeminiNotConfiguredError 키 미설정. 그 밖의 개별 컷 실패는 삼키고 계속한다
 *   (검수가 렌더를 막는 유일한 이유는 "실제로 문제를 찾았을 때"여야 한다).
 */
export async function auditClips(
  clips: AuditClipInput[],
  opts: { fetchFn?: typeof fetch } = {}
): Promise<ClipAuditResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const workDir = path.join(os.tmpdir(), `clip-audit-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });

  const findings: AuditFinding[] = [];
  const seen: ClipAuditResult["seen"] = [];

  try {
    for (const clip of clips) {
      let verdict: z.infer<typeof verdictSchema> | null = null;
      try {
        verdict = await judgeClip(clip, await sampleFrames(clip, workDir), fetchFn);
      } catch (e) {
        if (e instanceof GeminiNotConfiguredError) throw e;
        console.error(`[clip-audit] 컷 ${clip.index} 검수 실패(건너뜀): ${(e as Error).message}`);
        continue;
      }
      if (!verdict) continue;

      seen.push({ index: clip.index, space: verdict.space, summary: verdict.summary });
      const pace = resolveClipPace(clip.space, clip.note, clip.pace);

      // ⑴ 선언 공간 ≠ 실제 공간 (이동 컷은 제외 — 정의상 여러 공간을 지난다)
      if (pace.kind !== "transit" && !spaceCompatible(clip.space, verdict.space)) {
        findings.push({
          index: clip.index,
          severity: "error",
          message: `선언은 ${SPACE_LABEL[clip.space ?? ""] ?? clip.space}인데 화면은 ${SPACE_LABEL[verdict.space] ?? verdict.space} — ${verdict.summary}`,
          hint: "이 컷의 시작 지점(startSec)을 옮기거나 공간 선언을 실제 화면에 맞추세요.",
        });
      }

      // ⑵ 메모에 적은 피사체가 아예 안 보임
      //   ★ 이동 컷은 제외한다: 메모가 "~로 이동"처럼 동작 서술이라 피사체 판정 자체가 성립하지 않는다.
      if (pace.kind !== "transit" && clip.note?.trim() && !verdict.subjectVisible) {
        findings.push({
          index: clip.index,
          severity: "error",
          message: `메모의 피사체("${clip.note.trim()}")가 쓰이는 구간에 또렷이 보이지 않음 — ${verdict.summary}`,
          hint: `클립 파일이 길어도 **앞 ${AUDIT_WINDOW_SEC}초만** 화면에 나갑니다. 피사체가 그 안에 오도록 시작 지점을 당기세요.`,
        });
      }

      // ⑶ 홍보 영상에 부적절한 것
      for (const p of verdict.problems ?? []) {
        findings.push({
          index: clip.index,
          severity: HARD_PROBLEM_RE.test(p) ? "error" : "warn",
          message: p,
          hint: "그 장면을 피해 시작 지점을 옮기거나 이 컷을 빼세요.",
        });
      }
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  return { findings, seen };
}

/** 발견 목록 → 운영자가 읽을 한 덩어리 텍스트(알림·editError용). */
export function formatAuditFindings(findings: AuditFinding[]): string {
  if (findings.length === 0) return "";
  return findings
    .map((f) => `컷 ${f.index} [${f.severity === "error" ? "오류" : "경고"}] ${f.message} → ${f.hint}`)
    .join("\n");
}
