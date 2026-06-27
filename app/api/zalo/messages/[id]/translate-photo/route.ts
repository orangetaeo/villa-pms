// POST /api/zalo/messages/[id]/translate-photo — 수신 사진 OCR 번역 on-demand (2026-06-23)
//
// 배경: 사진 자동 OCR 번역을 끄고(zalo-runtime), 운영자가 채팅 버블의 "번역" 버튼을 눌렀을 때만
//       해당 사진 메시지의 이미지를 OCR→ko 번역해 translatedText에 저장하고 반환한다.
//
// 보안: ADMIN 전용 + 본인(ownerAdminId) 대화의 메시지만(누수 0 — 스코프 가드). credential·마진 무관.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GeminiNotConfiguredError, translateImage } from "@/lib/gemini";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 — ADMIN 전용 (route handler 첫 줄 role 검사)
  const g = await requireCapability(isOperator, "isOperator", _req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;

  // 본인 대화의 메시지만 — conversation.ownerAdminId 스코프 가드(타 관리자 메시지 접근 차단).
  const message = await prisma.zaloMessage.findFirst({
    where: { id, conversation: { ownerAdminId: session.user.id } },
    select: { id: true, msgType: true, attachmentUrls: true, translatedText: true },
  });
  if (!message) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 이미 번역돼 있으면 그대로 반환(멱등 — 중복 Gemini 호출 0).
  if (message.translatedText && message.translatedText.trim().length > 0) {
    return NextResponse.json({ translated: message.translatedText });
  }

  const imageUrl = message.attachmentUrls?.[0];
  if (message.msgType !== "photo" || !imageUrl) {
    return NextResponse.json({ error: "NOT_A_PHOTO" }, { status: 400 });
  }

  try {
    // 1) 이미지 다운로드 (15s — CDN 무응답 보호, maybeTranslatePhoto와 동일 패턴)
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return NextResponse.json({ error: "IMAGE_FETCH_FAILED" }, { status: 502 });
    }
    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength === 0) {
      return NextResponse.json({ error: "IMAGE_EMPTY" }, { status: 502 });
    }
    const imageBase64 = Buffer.from(arrayBuf).toString("base64");
    const mimeType = res.headers.get("content-type") || "image/jpeg";

    // 2) OCR→ko 번역. 인식된 글자가 없으면 빈 문자열(클라가 "글자 없음" 표시).
    const translated = await translateImage(imageBase64, mimeType, "ko");
    if (!translated || translated.trim().length === 0) {
      return NextResponse.json({ translated: "" });
    }

    // 3) translatedText 저장(이후 재요청은 멱등 반환). Nike는 ext/messages로 다음 조회 시 반영.
    await prisma.zaloMessage.update({
      where: { id: message.id },
      data: { translatedText: translated },
    });

    return NextResponse.json({ translated });
  } catch (e) {
    if (e instanceof GeminiNotConfiguredError) {
      return NextResponse.json({ error: "TRANSLATE_NOT_CONFIGURED" }, { status: 503 });
    }
    // 이미지·OCR 결과 에코 방지 — 상태만 로그
    console.error("[zalo/translate-photo] OCR 번역 실패", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "TRANSLATE_FAILED" }, { status: 502 });
  }
}
