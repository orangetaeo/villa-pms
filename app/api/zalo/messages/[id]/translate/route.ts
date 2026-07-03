// POST /api/zalo/messages/[id]/translate — 수신 텍스트 메시지 on-demand 번역 (2026-06-30)
//
// 배경: 수신 텍스트는 보통 자동번역(maybeTranslateInbound)되지만, 간혹 번역이 비어 있는
//       메시지가 생긴다(키 일시 오류·한국어 오탐 등). 운영자가 채팅 버블의 "번역" 버튼을
//       눌렀을 때 해당 메시지 본문을 ko로 번역해 translatedText에 저장하고 반환한다(사진 translate-photo 미러).
//
// 보안: ADMIN 전용 + 본인(ownerAdminId) 대화의 메시지만(누수 0 — 스코프 가드). credential·마진 무관.
//       Gemini 비용 폭주 방어로 사용자별 costThrottle 적용(P1-S11, /translate 미리보기와 동일).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GeminiNotConfiguredError, translateText } from "@/lib/gemini";
import { isProbablyKorean } from "@/lib/zalo-inbound";
import { publish as publishRealtime } from "@/lib/realtime-bus";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { costThrottle } from "@/lib/cost-throttle";

// 번역 대상 텍스트류 — 본문(text)이 사람이 읽는 문장인 타입만. 음성은 STT 경로.
// photo는 캡션(text)을 번역하되 captionTranslated에 저장 — translatedText는 이미지 OCR(translate-photo) 전용.
const TRANSLATABLE_TYPES = new Set(["text", "link", "location", "photo"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 — ADMIN 전용 (route handler 첫 줄 role 검사)
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;

  // 비용 폭주 방어(Gemini 호출) — 사용자별 스로틀 (보안 P1-S11, /translate와 동일)
  const throttled = await costThrottle("translate", session.user.id);
  if (throttled) return throttled;

  const { id } = await params;

  // 본인 대화의 메시지만 — conversation.ownerAdminId 스코프 가드(타 관리자 메시지 접근 차단).
  const message = await prisma.zaloMessage.findFirst({
    where: { id, conversation: { ownerAdminId: session.user.id } },
    select: {
      id: true,
      msgType: true,
      text: true,
      translatedText: true,
      captionTranslated: true,
      conversationId: true,
    },
  });
  if (!message) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 저장 대상 필드 — photo 캡션은 captionTranslated(OCR 번역과 분리), 그 외 텍스트류는 translatedText.
  const targetField =
    message.msgType === "photo" ? ("captionTranslated" as const) : ("translatedText" as const);
  const existing = message[targetField];

  // 이미 번역돼 있으면 그대로 반환(멱등 — 중복 Gemini 호출 0).
  if (existing && existing.trim().length > 0) {
    return NextResponse.json({ translated: existing });
  }

  const source = (message.text ?? "").trim();
  if (!TRANSLATABLE_TYPES.has(message.msgType) || source.length === 0) {
    return NextResponse.json({ error: "NOT_TRANSLATABLE" }, { status: 400 });
  }

  // 이미 한국어면 ko→ko 패러프레이즈 방지 — 원문을 그대로 자막으로 저장(운영자가 동일 본문 확인).
  if (isProbablyKorean(source)) {
    return NextResponse.json({ translated: "", note: "ALREADY_KO" });
  }

  try {
    // 수신은 항상 ko 타깃(ADMIN 기준 언어). 소스 언어는 모델 자동감지(maybeTranslateInbound와 동일).
    const translated = await translateText(source, "ko");
    if (!translated || translated.trim().length === 0) {
      return NextResponse.json({ translated: "" });
    }

    // 대상 필드에 저장(이후 재요청은 멱등 반환).
    await prisma.zaloMessage.update({
      where: { id: message.id },
      data: { [targetField]: translated },
    });

    // 다른 탭/뷰 정합 — 번역 채움 후 본인 채널로 실시간 "update" 신호 1회(누수 0: 신호만).
    //   best-effort: 발행 실패가 응답을 막지 않게 try/catch.
    try {
      publishRealtime(session.user.id, {
        type: "update",
        conversationId: message.conversationId,
      });
    } catch {
      /* 실시간 발행 실패는 무해 — 폴링 폴백으로 갱신 */
    }

    return NextResponse.json({ translated });
  } catch (e) {
    if (e instanceof GeminiNotConfiguredError) {
      return NextResponse.json({ error: "TRANSLATE_NOT_CONFIGURED" }, { status: 503 });
    }
    // 본문·번역 결과 에코 방지 — 상태만 로그
    console.error("[zalo/translate] on-demand 번역 실패", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "TRANSLATE_FAILED" }, { status: 502 });
  }
}
