// [SHARED-MODULE] from Nike src/app/api/zalo/events/route.ts
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { addSSEClient, removeSSEClient } from "@/lib/sse-emitter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/zalo/events — Zalo 채팅 SSE 스트림
 *
 * 새 메시지, 리액션, 삭제, 대화목록 갱신을 실시간 전달.
 * 5개 폴링(메시지 5s, 리액션 5s, 대화목록 10s×2, 음성번역 2s) 대체.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (session.status !== "ACTIVE") {
    return new Response("Forbidden", { status: 403 });
  }

  const clientId = `zalo-${session.userId}-${Date.now()}`;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      addSSEClient(clientId, controller, session.userId);

      // 30초 heartbeat
      intervalId = setInterval(() => {
        try {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          if (intervalId) clearInterval(intervalId);
          removeSSEClient(clientId);
        }
      }, 30_000);

      // 초기 연결 확인
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`)
      );
    },
    cancel() {
      if (intervalId) clearInterval(intervalId);
      removeSSEClient(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
