// GET/PUT /api/agreement — 이용 동의서 콘텐츠 조회·발행 (ADMIN 전용, T-admin-agreement-editor)
// 전 빌라 공용 단일 동의서. 운영자는 한국어만 입력하고, 발행(PUT) 시 서버가 나머지 4개 언어를
// Gemini로 자동 번역해 저장한다(별도 번역 버튼 없음). 발행마다 rev +1, 직전본 이력 보존, 감사 로그.
// 저장소: AppSetting JSON (스키마 무변경) — lib/agreement-store.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { getAgreementContent, saveAgreementContent } from "@/lib/agreement-store";
import { normalizeAgreementContent, validateAgreementContent } from "@/lib/agreement";
import { translateText, GeminiNotConfiguredError, type TranslateTarget } from "@/lib/gemini";

// 한국어 원문 → 자동 번역 대상 (ko 제외, AGREEMENT_LANGS와 정합)
const TRANSLATE_TARGETS: TranslateTarget[] = ["vi", "en", "zh", "ru"];

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  }
  if (!isSystemAdmin(session.user.role)) {
    return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
  return { userId: session.user.id };
}

export async function GET() {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  const content = await getAgreementContent();
  return NextResponse.json({ content });
}

export async function PUT(req: Request) {
  // 권한 검사 — ADMIN 전용
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  // 운영자 입력은 한국어만 신뢰 — 나머지 언어는 서버가 번역으로 채운다(클라 전달 무시)
  const obj = (body ?? {}) as { docTitle?: { ko?: unknown }; body?: { ko?: unknown } };
  const koTitle = String(obj.docTitle?.ko ?? "").trim();
  const koBody = String(obj.body?.ko ?? "").trim();
  if (!koTitle || !koBody) {
    return NextResponse.json({ error: "INCOMPLETE" }, { status: 400 });
  }

  const current = await getAgreementContent();

  // 한국어 → vi·en·zh·ru 자동 번역 (제목·본문 각각, 병렬). 번호·줄바꿈은 numbersPreserved 가드.
  let docTitle: Record<string, string>;
  let bodyMap: Record<string, string>;
  try {
    const translated = await Promise.all(
      TRANSLATE_TARGETS.map(async (lang) => {
        const [t, b] = await Promise.all([translateText(koTitle, lang), translateText(koBody, lang)]);
        return { lang, t, b };
      })
    );
    docTitle = { ko: koTitle };
    bodyMap = { ko: koBody };
    for (const r of translated) {
      docTitle[r.lang] = r.t;
      bodyMap[r.lang] = r.b;
    }
  } catch (e) {
    if (e instanceof GeminiNotConfiguredError) {
      return NextResponse.json({ error: "GEMINI_NOT_CONFIGURED" }, { status: 503 });
    }
    return NextResponse.json({ error: "TRANSLATE_FAILED" }, { status: 502 });
  }

  // 정규화(+1)·법적 완결성 검증 — 번역이 한 언어라도 비면 발행 차단(재시도 유도)
  const next = normalizeAgreementContent({ docTitle, body: bodyMap }, current.rev);
  const check = validateAgreementContent(next);
  if (!check.ok) {
    return NextResponse.json({ error: "TRANSLATE_FAILED", missing: check.missing }, { status: 502 });
  }

  await saveAgreementContent(prisma, next);

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: g.userId,
    action: "UPDATE",
    entity: "Agreement",
    entityId: `rev-${next.rev}`,
    changes: { rev: { old: current.rev, new: next.rev } },
  });

  return NextResponse.json({ content: next });
}
