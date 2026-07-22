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
import { GeminiNotConfiguredError } from "@/lib/gemini";
import { ttsConfig } from "@/lib/gemini-tts";
import {
  buildNarrationScript,
  validateNarrationLines,
  NARRATION_RULES,
  type NarrationLine,
  type NarrationVillaContext,
} from "@/lib/youtube/narration";

export const dynamic = "force-dynamic";

interface StoredNarration {
  lines: { text: string; clipIndex: number | null }[];
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
    .map((l) => {
      if (!l || typeof l !== "object") return null;
      const ll = l as Record<string, unknown>;
      const text = typeof ll.text === "string" ? ll.text : "";
      if (!text.trim()) return null;
      const ci = ll.clipIndex;
      return { text, clipIndex: typeof ci === "number" && ci >= 0 ? Math.floor(ci) : null };
    })
    .filter((l): l is { text: string; clipIndex: number | null } => l !== null);
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

/** 저장된 편집 파라미터에서 클립별 촬영 공간을 유추(없으면 클립 수만큼 null). */
function clipSpacesOf(editParams: Prisma.JsonValue | null): (string | null)[] {
  if (!editParams || typeof editParams !== "object" || Array.isArray(editParams)) return [];
  const clips = (editParams as Record<string, unknown>).clips;
  if (!Array.isArray(clips)) return [];
  return clips.map((c) => {
    if (!c || typeof c !== "object") return null;
    const s = (c as Record<string, unknown>).space;
    return typeof s === "string" ? s : null;
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

  const spaces = clipSpacesOf(short.editParamsJson);
  const ctx: NarrationVillaContext = {
    villaName: short.villa.name,
    complex: short.villa.complex,
    bedrooms: short.villa.bedrooms,
    hasPool: short.villa.hasPool,
    beachDistanceM: short.villa.beachDistanceM,
    clipSpaces: spaces.length > 0 ? spaces : [null, null, null],
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
    .map((l) => {
      if (!l || typeof l !== "object") return null;
      const ll = l as Record<string, unknown>;
      const text = typeof ll.text === "string" ? ll.text.trim().slice(0, 120) : "";
      if (!text) return null;
      const ci = ll.clipIndex;
      return { text, clipIndex: typeof ci === "number" && ci >= 0 ? Math.floor(ci) : null };
    })
    .filter((l): l is NarrationLine => l !== null);

  if (lines.length === 0) return NextResponse.json({ error: "LINES_REQUIRED" }, { status: 400 });

  // 규칙 위반은 **거부하지 않고 경고로 돌려준다** — 운영자가 의도적으로 1자 넘길 수 있어야 한다.
  //   단 총 길이 상한(쇼츠 60초)은 렌더 단계에서 하드하게 막힌다(edit.ts, 계약 C2).
  const validation = validateNarrationLines(lines);
  const voice = typeof b.voice === "string" && b.voice.trim() ? b.voice.trim() : undefined;
  const rerender = b.rerender === true;

  const short = await loadShort(id);
  if (!short) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // 렌더 중(PROCESSING)에 파라미터를 갈아끼우면 산출물과 대본이 어긋난다.
  if (rerender && short.editJobStatus === YtEditJobStatus.PROCESSING) {
    return NextResponse.json({ error: "RENDER_IN_PROGRESS" }, { status: 409 });
  }

  const prevParams =
    short.editParamsJson && typeof short.editParamsJson === "object" && !Array.isArray(short.editParamsJson)
      ? (short.editParamsJson as Record<string, unknown>)
      : {};
  const nextParams = { ...prevParams, narration: { lines, ...(voice ? { voice } : {}) } };

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
        lineCount: { new: String(lines.length) },
        // 대본 전문을 남긴다 — 발행 문구 분쟁 시 "무엇이 승인됐는지"가 정본이 된다.
        script: { new: lines.map((l) => l.text).join(" / ") },
        rerender: { new: String(rerender) },
        ...(voice ? { voice: { new: voice } } : {}),
      },
    });
  });

  return NextResponse.json({ lines, validation, rerender, tts: ttsConfig() });
}
