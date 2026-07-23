// GET/POST/PUT /api/youtube/shorts/[id]/narration — AI 나레이션 대본 조회·생성·저장
// (villa-clip-narration-p2). admin 전용.
//
// 권한(첫 줄): isOperator만. SUPPLIER/VENDOR/PARTNER 403 (계약 C8).
//
// 왜 별도 라우트인가: Gemini 대본을 그대로 발행하면 사고다. 운영자가 4줄을 읽고 고친 뒤
//   재렌더할 수 있어야 실전에서 쓸 만하다. 대본은 editParamsJson.narration에 저장되고,
//   렌더는 기존 편집 잡(editJobStatus=PENDING → 잡 러너)이 그대로 처리한다.
//
// ★ 재TTS 비용: 문장별 캐시(sha256(text+voice+model))가 있어 **수정한 문장만** 새로 합성된다(C7).
//   따라서 여기서는 "무엇이 바뀌었는지" 추적할 필요가 없다 — 캐시가 알아서 해결한다.
// ★ 누수 0: 대본 입력은 빌라 공개정보(이름·단지·침실 수·수영장·해변거리)만. 금액 없음.
import { NextResponse } from "next/server";
import { YtEditJobStatus, type Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { canRerender } from "@/lib/youtube/rerender-guard";
import { GeminiNotConfiguredError } from "@/lib/gemini";
import { ttsConfig } from "@/lib/gemini-tts";
import { resolveClipPace } from "@/lib/youtube/pacing";
import {
  buildNarrationScript,
  validateNarrationLines,
  normalizeScript,
  NARRATION_RULES,
  type NarrationClipHint,
  type NarrationLine,
  type NarrationVillaContext,
} from "@/lib/youtube/narration";

export const dynamic = "force-dynamic";

interface StoredNarration {
  lines: NarrationLine[];
  voice?: string;
}

/** editParamsJson에서 대본만 안전하게 꺼낸다(형태 신뢰 금지 — 과거 잡은 narration이 없다). */
function readStoredNarration(editParams: Prisma.JsonValue | null): StoredNarration | null {
  if (!editParams || typeof editParams !== "object" || Array.isArray(editParams)) return null;
  const n = (editParams as Record<string, unknown>).narration;
  if (!n || typeof n !== "object" || Array.isArray(n)) return null;
  const linesRaw = (n as Record<string, unknown>).lines;
  if (!Array.isArray(linesRaw)) return null;
  const lines = linesRaw
    .map((l): NarrationLine | null => {
      if (!l || typeof l !== "object") return null;
      const ll = l as Record<string, unknown>;
      const text = typeof ll.text === "string" ? ll.text : "";
      if (!text.trim()) return null;
      const partsRaw = Array.isArray(ll.parts) ? ll.parts : [];
      const parts = partsRaw
        .map((pp) => {
          if (!pp || typeof pp !== "object") return null;
          const p2 = pp as Record<string, unknown>;
          const t = typeof p2.text === "string" ? p2.text : "";
          if (!t.trim()) return null;
          const idx = Array.isArray(p2.clipIndexes) ? p2.clipIndexes : [];
          return {
            clipIndexes: idx
              .filter((v): v is number => typeof v === "number" && v >= 0)
              .map((v) => Math.floor(v)),
            text: t.trim(),
          };
        })
        .filter((p2): p2 is { clipIndexes: number[]; text: string } => p2 !== null);
      return { text: text.trim(), parts: parts.length ? parts : [{ clipIndexes: [], text: text.trim() }] };
    })
    .filter((l): l is NarrationLine => l !== null);
  if (lines.length === 0) return null;
  const voice = (n as Record<string, unknown>).voice;
  return { lines, voice: typeof voice === "string" && voice ? voice : undefined };
}

/** 쇼츠 + 대본 생성에 필요한 빌라 공개정보 로드. */
async function loadShort(id: string) {
  return prisma.youtubeShort.findUnique({
    where: { id },
    select: {
      id: true,
      villaId: true,
      sourceType: true,
      status: true,
      editJobStatus: true,
      editParamsJson: true,
      villa: {
        select: {
          name: true,
          complex: true,
          bedrooms: true,
          hasPool: true,
          beachDistanceM: true,
        },
      },
    },
  });
}

/**
 * 저장된 편집 파라미터에서 컷별 힌트(공간 + 메모)를 뽑는다.
 * ★ note까지 넘겨야 침실이 여러 컷일 때 "또 다른 침실입니다" 같은 무정보 문장을 피한다
 *   (테오 피드백 2026-07-22). note의 원천은 VillaClip.note(공급자·운영자 자유 메모).
 */
function clipHintsOf(editParams: Prisma.JsonValue | null): NarrationClipHint[] {
  if (!editParams || typeof editParams !== "object" || Array.isArray(editParams)) return [];
  const clips = (editParams as Record<string, unknown>).clips;
  if (!Array.isArray(clips)) return [];
  return clips.map((c) => {
    if (!c || typeof c !== "object") return { space: null };
    const cc = c as Record<string, unknown>;
    return {
      space: typeof cc.space === "string" ? cc.space : null,
      note: typeof cc.note === "string" ? cc.note : null,
      pace: cc.pace === "fast" || cc.pace === "slow" ? cc.pace : undefined,
    };
  });
}

// ===================== GET — 현재 대본 + 규칙 =====================
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id } = await params;

  const short = await loadShort(id);
  if (!short) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const stored = readStoredNarration(short.editParamsJson);
  const lines: NarrationLine[] = stored?.lines ?? [];
  return NextResponse.json({
    lines,
    voice: stored?.voice ?? ttsConfig().voice,
    validation: lines.length > 0 ? validateNarrationLines(lines) : null,
    rules: NARRATION_RULES,
    tts: ttsConfig(),
  });
}

// ===================== POST — Gemini 대본 초안 생성 =====================
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id } = await params;

  const short = await loadShort(id);
  if (!short) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!short.villa) {
    // 빌라 연결이 없으면 대본에 넣을 사실이 없다 — 운영자가 직접 쓰게 한다.
    return NextResponse.json({ error: "VILLA_REQUIRED" }, { status: 400 });
  }

  const hints = clipHintsOf(short.editParamsJson);
  const ctx: NarrationVillaContext = {
    villaName: short.villa.name,
    complex: short.villa.complex,
    bedrooms: short.villa.bedrooms,
    hasPool: short.villa.hasPool,
    beachDistanceM: short.villa.beachDistanceM,
    clips: hints.length > 0 ? hints : [{ space: null }, { space: null }, { space: null }],
  };

  let lines: NarrationLine[];
  try {
    lines = await buildNarrationScript(ctx);
  } catch (e) {
    if (e instanceof GeminiNotConfiguredError) {
      return NextResponse.json({ error: "GEMINI_NOT_CONFIGURED" }, { status: 503 });
    }
    return NextResponse.json({ error: "SCRIPT_GENERATION_FAILED" }, { status: 502 });
  }

  // 초안은 저장하지 않는다 — 운영자가 확인·수정한 뒤 PUT으로 확정한다(승인 큐 정본 원칙).
  return NextResponse.json({
    lines,
    validation: validateNarrationLines(lines),
    rules: NARRATION_RULES,
    tts: ttsConfig(),
  });
}

// ===================== PUT — 대본 저장 (+ 선택적 재렌더) =====================
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const linesRaw = Array.isArray(b.lines) ? b.lines : null;
  if (!linesRaw) return NextResponse.json({ error: "LINES_REQUIRED" }, { status: 400 });

  const lines: NarrationLine[] = linesRaw
    .map((l): NarrationLine | null => {
      if (!l || typeof l !== "object") return null;
      const ll = l as Record<string, unknown>;
      const text = typeof ll.text === "string" ? ll.text.trim().slice(0, 200) : "";
      if (!text) return null;
      // 절(자막 한 장) 배열. 운영자가 절 없이 문장만 고쳤으면 문장 전체를 한 절로 취급.
      const partsRaw = Array.isArray(ll.parts) ? ll.parts : [];
      const parts = partsRaw
        .map((p) => {
          if (!p || typeof p !== "object") return null;
          const pp = p as Record<string, unknown>;
          const t = typeof pp.text === "string" ? pp.text.trim().slice(0, 120) : "";
          if (!t) return null;
          const idx = Array.isArray(pp.clipIndexes) ? pp.clipIndexes : [];
          return {
            clipIndexes: idx
              .filter((v): v is number => typeof v === "number" && v >= 0)
              .map((v) => Math.floor(v)),
            text: t,
          };
        })
        .filter((p): p is { clipIndexes: number[]; text: string } => p !== null);
      return { text, parts: parts.length ? parts : [{ clipIndexes: [], text }] };
    })
    .filter((l): l is NarrationLine => l !== null);

  if (lines.length === 0) return NextResponse.json({ error: "LINES_REQUIRED" }, { status: 400 });

  const voice = typeof b.voice === "string" && b.voice.trim() ? b.voice.trim() : undefined;
  const rerender = b.rerender === true;

  const short = await loadShort(id);
  if (!short) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // ★ 저장 직전 컷 커버리지 재보정(QA M-3): 편집기가 문장을 추가·삭제하면 절 배정이 깨진다
  //   (새 문장은 parts가 없어 CTA로 저장되고, 문장을 지우면 그 문장이 덮던 컷이 미배정으로 남는다).
  //   미배정 컷은 clipDurations에 구멍을 남겨 렌더가 기본 4초를 쓰고 **타임라인 전체가 밀린다**.
  //   → 서버가 normalizeScript로 모든 컷이 정확히 한 번씩 쓰이도록 항상 다시 맞춘다(컷 순서 정렬 포함).
  const hints = clipHintsOf(short.editParamsJson);
  const clipCount = hints.length;
  // ★ 컷 완급을 함께 넘긴다 — 이동 컷이 자기 자막을 갖지 못하게 재편성한다.
  //   안 넘기면 "침대 나레이션이 나오는데 화면은 샤워실"이 다시 생긴다(테오 2026-07-23).
  const clipKinds = hints.map((h) => resolveClipPace(h.space, h.note, h.pace).kind);
  const normalized =
    clipCount > 0
      ? normalizeScript(
          lines.map((l) => ({
            text: l.text,
            parts: l.parts.map((p) => ({
              // normalizeScript는 1-base cut을 받는다. CTA(빈 배열)는 0.
              cut: p.clipIndexes.length ? p.clipIndexes[0] + 1 : 0,
              text: p.text,
            })),
          })),
          clipCount,
          clipKinds
        )
      : lines;

  // 규칙 위반은 **거부하지 않고 경고로 돌려준다** — 운영자가 의도적으로 1자 넘길 수 있어야 한다.
  //   단 총 길이 상한은 렌더 단계에서 하드하게 막힌다(edit.ts, 계약 C2).
  const validation = validateNarrationLines(normalized);
  // 렌더 중(PROCESSING)에 파라미터를 갈아끼우면 산출물과 대본이 어긋난다.
  if (rerender && short.editJobStatus === YtEditJobStatus.PROCESSING) {
    return NextResponse.json({ error: "RENDER_IN_PROGRESS" }, { status: 409 });
  }
  // ★ 발행 축 가드(QA H-1) — run 라우트와 같은 이유. 이미 발행 파이프라인에 오른 쇼츠를 재렌더하면
  //   status가 PENDING_APPROVAL로 되돌아가 재승인 → 유튜브 중복 업로드로 이어진다.
  //   대본 "저장"만은 허용한다(기록용) — 막는 건 재렌더뿐.
  if (rerender && !canRerender(short.status)) {
    return NextResponse.json({ error: "ALREADY_PUBLISHED", status: short.status }, { status: 409 });
  }

  const prevParams =
    short.editParamsJson && typeof short.editParamsJson === "object" && !Array.isArray(short.editParamsJson)
      ? (short.editParamsJson as Record<string, unknown>)
      : {};
  const nextParams = { ...prevParams, narration: { lines: normalized, ...(voice ? { voice } : {}) } };

  await prisma.$transaction(async (tx) => {
    await tx.youtubeShort.update({
      where: { id },
      data: {
        // NarrationLine[]는 인덱스 시그니처가 없어 InputJsonValue와 직접 겹치지 않는다 —
        // 실제 값은 평범한 JSON이므로 unknown 경유 캐스팅(다른 라우트의 Json 컬럼 처리와 동일 패턴).
        editParamsJson: nextParams as unknown as Prisma.InputJsonValue,
        // 재렌더 요청 시에만 잡을 다시 PENDING으로 — 잡 러너가 픽업한다.
        ...(rerender ? { editJobStatus: YtEditJobStatus.PENDING, editError: null } : {}),
      },
    });
    await writeAuditLog({
      db: tx,
      userId: session.user.id,
      action: "UPDATE",
      entity: "YoutubeShortNarration",
      entityId: id,
      changes: {
        lineCount: { new: String(normalized.length) },
        // 대본 전문을 남긴다 — 발행 문구 분쟁 시 "무엇이 승인됐는지"가 정본이 된다.
        script: { new: normalized.map((l) => l.text).join(" / ") },
        rerender: { new: String(rerender) },
        ...(voice ? { voice: { new: voice } } : {}),
      },
    });
  });

  return NextResponse.json({ lines: normalized, validation, rerender, tts: ttsConfig() });
}
