// POST /api/agreement/translate — 이용 동의서 한국어 원문 → 나머지 언어 번역 (ADMIN 전용).
// 운영자는 한국어 docTitle+body만 입력하고, 이 엔드포인트로 vi·en·zh·ru를 일괄 생성한다.
// 번역만 수행(저장 X) — 운영자가 결과를 확인하고 발행(PUT /api/agreement)할 때 저장된다.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isSystemAdmin } from "@/lib/permissions";
import { translateText, GeminiNotConfiguredError, type TranslateTarget } from "@/lib/gemini";

// 한국어를 제외한 발행 언어 — lib/agreement AGREEMENT_LANGS와 정합 (ko는 원문이라 제외)
const TARGET_LANGS: TranslateTarget[] = ["vi", "en", "zh", "ru"];

export async function POST(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const { docTitle, body: agreementBody } = (body ?? {}) as {
    docTitle?: unknown;
    body?: unknown;
  };
  const koTitle = String(docTitle ?? "").trim();
  const koBody = String(agreementBody ?? "").trim();
  if (!koTitle || !koBody) {
    return NextResponse.json({ error: "EMPTY_SOURCE" }, { status: 400 });
  }

  try {
    // 언어별 제목·본문 병렬 번역 (Gemini flash, 줄바꿈·번호 보존은 translateText의 numbersPreserved 가드)
    const results = await Promise.all(
      TARGET_LANGS.map(async (lang) => {
        const [title, text] = await Promise.all([
          translateText(koTitle, lang),
          translateText(koBody, lang),
        ]);
        return { lang, title, text };
      })
    );

    const titleOut: Record<string, string> = {};
    const bodyOut: Record<string, string> = {};
    for (const r of results) {
      titleOut[r.lang] = r.title;
      bodyOut[r.lang] = r.text;
    }
    return NextResponse.json({ docTitle: titleOut, body: bodyOut });
  } catch (e) {
    if (e instanceof GeminiNotConfiguredError) {
      // GEMINI_API_KEY 미설정 — 운영자에게 키 설정 안내 (.env)
      return NextResponse.json({ error: "GEMINI_NOT_CONFIGURED" }, { status: 503 });
    }
    return NextResponse.json({ error: "TRANSLATE_FAILED" }, { status: 502 });
  }
}
