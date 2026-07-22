// lib/villa-clip.ts — 빌라 영상 클립 정책·검증 (villa-clip-narration P1)
//
// 역할:
//   ① 정책값(크기·길이·개수·해상도) 로드 — AppSetting 오버라이드, 미설정 시 기본값 폴백(무중단)
//   ② 업로드 완료분 **서버 실측 검증** — R2 HeadObject(크기) + ffprobe(길이·해상도)
//   ③ 쿼터 판정 — 순수함수로 분리해 유닛 테스트 가능하게
//
// ★ 왜 실측이 필요한가: presigned PUT은 브라우저→R2 직결이라 서버가 업로드를 중계하지 않는다.
//   presign 단계의 sizeBytes는 **클라 신고값**일 뿐이라, 작게 신고하고 큰 파일을 올릴 수 있다.
//   따라서 커밋(POST /api/villas/[id]/clips)에서 실측하고, 실패하면 R2 객체를 지운다.
// ★ ffprobe: 시스템 설치 가정 금지 — ffprobe-static 정적 바이너리 spawn(edit.ts와 동일 방침).
//   lib/youtube/edit.ts는 다른 세션(wt/marketing-s2) 점유 구역이라 import하지 않고 최소 구현을 둔다.
// ★ 누수 0: 이 모듈은 금액(원가·마진·판매가)을 일절 다루지 않는다.
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import ffprobeStatic from "ffprobe-static";
import { getR2ObjectBuffer, headR2Object } from "@/lib/storage";

const FFPROBE_PATH: string = ffprobeStatic.path;

// ── 정책 기본값 (계약서 villa-clip-narration.md 확정값) ──────────────
export const VILLA_CLIP_POLICY_DEFAULTS = {
  /** 클립 1개 최대 크기 — 80MB. 베트남 공급자 모바일 데이터 기준(ADMIN 500MB와 별개 상한). */
  maxBytes: 80 * 1024 * 1024,
  /** 클립 1개 최대 길이 — 30초. 쇼츠 소재는 짧은 컷이 유리. */
  maxDurationSec: 30,
  /**
   * 빌라당 클립 수 — 16개. lib/youtube/edit.ts CLIP_COUNT_MAX와 정합.
   * ★ 2026-07-22 상향(8→16): 입구·수영장·거실·주방·침실N·욕실·발코니를 다 담으려면 8컷으로 부족하다.
   */
  maxPerVilla: 16,
  /** 최소 짧은 변 — 540px. 9:16 1080×1920으로 업스케일되는 저화질 소재 차단. */
  minShortEdge: 540,
  /** 최소 길이 — 1.5초. 실수 터치로 찍힌 순간 영상 배제. */
  minDurationSec: 1.5,
} as const;

export interface VillaClipPolicy {
  maxBytes: number;
  maxDurationSec: number;
  maxPerVilla: number;
  minShortEdge: number;
  minDurationSec: number;
}

// AppSetting 키 — 코드 배포 없이 상한 조정(킬스위치 패턴 재사용).
export const VILLA_CLIP_SETTING_KEYS = {
  maxBytes: "VILLA_CLIP_MAX_BYTES",
  maxDurationSec: "VILLA_CLIP_MAX_DURATION_SEC",
  maxPerVilla: "VILLA_CLIP_MAX_PER_VILLA",
} as const;

/** AppSetting 조회에 필요한 최소 인터페이스(트랜잭션 클라이언트·테스트 fake 모두 수용). */
interface AppSettingReader {
  appSetting: {
    findMany: (args: {
      where: { key: { in: string[] } };
    }) => Promise<{ key: string; value: string }[]>;
  };
}

/** 양의 정수 문자열만 채택 — 쓰레기 값은 기본값으로 조용히 폴백(운영 중 잘못된 설정이 업로드를 막지 않게). */
function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 정책 로드 — AppSetting 오버라이드 + 기본값 폴백. 설정 행이 하나도 없어도 정상 동작(무중단). */
export async function loadVillaClipPolicy(db: AppSettingReader): Promise<VillaClipPolicy> {
  const keys = Object.values(VILLA_CLIP_SETTING_KEYS);
  let rows: { key: string; value: string }[] = [];
  try {
    rows = await db.appSetting.findMany({ where: { key: { in: [...keys] } } });
  } catch {
    // 설정 조회 실패는 정책 부재로 간주 — 기본값으로 진행.
    rows = [];
  }
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    maxBytes:
      parsePositiveInt(map.get(VILLA_CLIP_SETTING_KEYS.maxBytes)) ??
      VILLA_CLIP_POLICY_DEFAULTS.maxBytes,
    maxDurationSec:
      parsePositiveInt(map.get(VILLA_CLIP_SETTING_KEYS.maxDurationSec)) ??
      VILLA_CLIP_POLICY_DEFAULTS.maxDurationSec,
    maxPerVilla:
      parsePositiveInt(map.get(VILLA_CLIP_SETTING_KEYS.maxPerVilla)) ??
      VILLA_CLIP_POLICY_DEFAULTS.maxPerVilla,
    minShortEdge: VILLA_CLIP_POLICY_DEFAULTS.minShortEdge,
    minDurationSec: VILLA_CLIP_POLICY_DEFAULTS.minDurationSec,
  };
}

// ── 검증 (순수함수 — 유닛 테스트 대상) ──────────────────────────────
export interface ClipProbe {
  sizeBytes: number;
  durationSec: number;
  /** 회전 메타를 반영한 **표시** 가로 픽셀 */
  width: number;
  /** 회전 메타를 반영한 **표시** 세로 픽셀 */
  height: number;
}

export type ClipRejectReason =
  | "TOO_LARGE"
  | "TOO_LONG"
  | "TOO_SHORT"
  | "RESOLUTION_TOO_LOW"
  | "QUOTA_EXCEEDED";

export type ClipCheck = { ok: true } | { ok: false; reason: ClipRejectReason };

/**
 * 업로드 실측값이 정책을 만족하는지 판정.
 * @param existingCount 이 빌라의 기존 클립 수(UPLOADING 제외 — 커밋된 것만 센다)
 */
export function checkClipAgainstPolicy(
  probe: ClipProbe,
  policy: VillaClipPolicy,
  existingCount: number
): ClipCheck {
  if (existingCount >= policy.maxPerVilla) return { ok: false, reason: "QUOTA_EXCEEDED" };
  if (probe.sizeBytes > policy.maxBytes) return { ok: false, reason: "TOO_LARGE" };
  if (probe.durationSec > policy.maxDurationSec) return { ok: false, reason: "TOO_LONG" };
  if (probe.durationSec < policy.minDurationSec) return { ok: false, reason: "TOO_SHORT" };
  if (Math.min(probe.width, probe.height) < policy.minShortEdge) {
    return { ok: false, reason: "RESOLUTION_TOO_LOW" };
  }
  return { ok: true };
}

/** 거부 사유 → HTTP 상태. 쿼터는 409(충돌), 나머지는 400(잘못된 소재). */
export function rejectStatus(reason: ClipRejectReason): number {
  return reason === "QUOTA_EXCEEDED" ? 409 : 400;
}

// ── ffprobe 실측 ────────────────────────────────────────────────────
function runProbe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on("error", (e) => reject(new Error(`ffprobe 실행 실패: ${e.message}`)));
    proc.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`ffprobe 종료코드 ${code}: ${stderr.slice(-600)}`))
    );
  });
}

interface FfprobeJson {
  streams?: {
    width?: number;
    height?: number;
    duration?: string;
    codec_type?: string;
    tags?: { rotate?: string };
    side_data_list?: { rotation?: number }[];
  }[];
  format?: { duration?: string };
}

/**
 * 로컬 파일 1개의 길이·표시 해상도 측정. 비디오 스트림이 없으면 null(오디오 파일·손상 파일 차단).
 * ★ 회전 메타(side_data rotation / tags.rotate)를 반영한 **표시** 해상도를 돌려준다 —
 *   아이폰 세로 촬영은 컨테이너상 1920×1080 + rotation:90 인 경우가 흔해, 무시하면 가로로 오판한다.
 */
export async function probeVideoFile(
  filePath: string
): Promise<{ durationSec: number; width: number; height: number } | null> {
  let json: FfprobeJson;
  try {
    // ★ -show_entries의 `stream_side_data=` 셀렉터를 쓰지 않는다: ffprobe-static이 번들하는
    //   4.0.2는 그 섹션명을 모르고 **exit 1로 죽는다**("No match for section 'stream_side_data'").
    //   그러면 probe가 null → 커밋 라우트가 모든 업로드를 거부한다(실측 확인 2026-07-22).
    //   -show_streams는 4.x·7.x 모두에서 동작하고, 회전 정보(tags.rotate / side_data_list)가
    //   존재하면 어느 쪽이든 그대로 실려 온다 — 버전 차이를 호출부가 흡수한다.
    const out = await runProbe([
      "-v", "error",
      "-select_streams", "v:0",
      "-show_streams",
      "-show_format",
      "-of", "json",
      filePath,
    ]);
    json = JSON.parse(out) as FfprobeJson;
  } catch {
    return null;
  }

  const s = json.streams?.[0];
  if (!s || !s.width || !s.height) return null; // 비디오 스트림 없음 = 영상이 아님

  let rot = 0;
  if (s.tags?.rotate) rot = Number.parseInt(s.tags.rotate, 10) || 0;
  const sd = s.side_data_list?.find((x) => typeof x.rotation === "number");
  if (sd?.rotation != null) rot = sd.rotation;
  const swap = Math.abs(rot) % 180 === 90;

  const duration = Number.parseFloat(s.duration ?? json.format?.duration ?? "");
  if (!Number.isFinite(duration) || duration <= 0) return null;

  return {
    durationSec: duration,
    width: swap ? s.height : s.width,
    height: swap ? s.width : s.height,
  };
}

/** probeR2Clip 결과 — 크기 초과는 다운로드 없이 즉시 판별되므로 별도 사유로 돌려준다. */
export type ProbeR2Result =
  | { ok: true; probe: ClipProbe }
  | { ok: false; reason: "NOT_FOUND" | "TOO_LARGE" | "INVALID" };

/**
 * R2에 업로드된 클립을 실측 — HeadObject(크기) + tmp 다운로드 후 ffprobe(길이·해상도).
 *
 * ★ maxBytes를 반드시 넘겨라(QA H-2): presigned PUT에는 content-length 제약이 없어
 *   클라가 신고한 크기와 **무관하게 임의 크기**를 올릴 수 있다. 크기 검사를 다운로드 뒤에 하면
 *   수 GB 파일이 서버 메모리로 먼저 들어와 OOM·egress 비용 폭탄이 된다.
 *   → HeadObject 크기로 **다운로드 전에** 끊는다.
 */
export async function probeR2Clip(key: string, maxBytes: number): Promise<ProbeR2Result> {
  const head = await headR2Object(key);
  if (!head || head.sizeBytes <= 0) return { ok: false, reason: "NOT_FOUND" }; // 업로드 미완료
  if (head.sizeBytes > maxBytes) return { ok: false, reason: "TOO_LARGE" }; // ★ 다운로드 전 차단

  const workDir = path.join(os.tmpdir(), `villa-clip-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });
  const localPath = path.join(workDir, `clip${path.extname(key) || ".mp4"}`);
  try {
    await fs.writeFile(localPath, await getR2ObjectBuffer(key));
    const meta = await probeVideoFile(localPath);
    if (!meta) return { ok: false, reason: "INVALID" };
    return {
      ok: true,
      probe: {
        sizeBytes: head.sizeBytes, // 크기는 R2 실측값이 정본(로컬 파일 크기와 동일하지만 출처를 명확히)
        durationSec: meta.durationSec,
        width: meta.width,
        height: meta.height,
      },
    };
  } catch {
    return { ok: false, reason: "INVALID" };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
