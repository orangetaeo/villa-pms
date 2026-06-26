// GET /api/zalo/stream — /messages 인박스 실시간(SSE) 스트림 (realtime-sse 계약)
//
// 폴링(5초) 대신 EventSource로 새 수신/발신 신호를 1초 이내 푸시한다.
// 페이로드는 신호만({ type, conversationId }) — 클라이언트는 받으면 기존 fetch로 실데이터를 갱신.
//
// 보안:
//  - 첫 줄 인증: 운영자(isOperator) 아니면 401/403 (inbox/messages 라우트와 동일 패턴).
//  - 본인 스코프(ADR-0007): session.user.id(=ownerAdminId) 채널만 구독 → 타 관리자 이벤트 누수 0.
//  - 누수 0: 페이로드에 본문·마진·판매가·원가 없음(식별 신호만).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOperator } from "@/lib/permissions";
import { subscribe, type RealtimeEvent } from "@/lib/realtime-bus";

// SSE는 항상 동적 + Node 런타임(EventEmitter·장기 연결).
export const dynamic = "force-dynamic";

// 프록시(Railway 등) 타임아웃 방지용 하트비트 주기.
const HEARTBEAT_MS = 15_000;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const ownerAdminId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // 컨트롤러가 이미 닫힌 경우 — 조용히 무시(cleanup이 곧 정리).
        }
      };

      // 연결 준비 신호 1회(클라이언트가 onopen 대신 명시 이벤트로도 확인 가능).
      safeEnqueue("event: ready\ndata: {}\n\n");

      // 본인(ownerAdminId) 채널 구독 — 도착 신호를 SSE data로 전달.
      const unsubscribe = subscribe(ownerAdminId, (payload: RealtimeEvent) => {
        safeEnqueue(`data: ${JSON.stringify(payload)}\n\n`);
      });

      // 하트비트(주석 라인) — 프록시 idle 타임아웃 방지.
      const heartbeat = setInterval(() => {
        safeEnqueue(": ping\n\n");
      }, HEARTBEAT_MS);

      // 연결 종료(탭 닫기·네비게이션) — 구독 해제 + 타이머 정리 + 스트림 닫기.
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* 이미 닫힘 — 무시 */
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx 등 버퍼링 비활성(SSE 즉시 flush).
      "X-Accel-Buffering": "no",
    },
  });
}
