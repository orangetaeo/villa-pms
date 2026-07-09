// lib/realtime-notify.ts — 인바운드 실시간 신호 브릿지 (ADR-0032 BE-4)
//
// 배경: 리스너 세션이 워커로 분리되면, 수신 저장은 워커 프로세스에서 일어난다. 그런데 SSE
//       구독자(브라우저)는 웹 프로세스의 in-process 버스(lib/realtime-bus)에 붙어 있다. 두 프로세스가
//       공유하는 유일 자원 = PostgreSQL. 그래서 PG LISTEN/NOTIFY로 신호만 건넨다.
//
// 누수 0(realtime-bus 불변식 승계): NOTIFY payload = { ownerAdminId, type, conversationId } —
//   식별 신호만. 본문·마진·판매가·원가 절대 미포함. "갱신하라"는 신호일 뿐 데이터가 아니다.
//
// 안전(기본-OFF):
//   - notifyRealtime(): 웹(현행·ZALO_SESSION_LOCAL=true)에서는 기존 in-process publish 그대로.
//     워커 프로세스에서만 PG NOTIFY(웹엔 SSE 구독자가 없으므로 로컬 publish는 무의미).
//   - startRealtimeListenRelay(): ZALO_SESSION_LOCAL=false(웹이 세션 미보유)일 때만 LISTEN 상주.
//     기본(플래그 미설정)은 no-op → pg 의존성·커넥션 전혀 사용 안 함(현행 동작 100% 보존).
//   - PG NOTIFY 발행은 Prisma $executeRaw(pg_notify)로 — pg 패키지 불필요. LISTEN만 pg 필요(웹 relay).
import { publish, type RealtimeEvent } from "@/lib/realtime-bus";
import { isWorkerRuntime } from "@/lib/zalo-runtime-role";

/** PG 채널명 — 웹 LISTEN과 워커 NOTIFY가 공유. */
export const REALTIME_CHANNEL = "zalo_realtime";

/** NOTIFY로 흐르는 신호(누수 0 — 식별 신호만). */
export interface RealtimeSignal extends RealtimeEvent {
  ownerAdminId: string;
}

/**
 * 실시간 신호 발행 — 세션 보유처(수신 저장 경로)에서 호출.
 *  - 웹 프로세스: in-process publish(기존 동작). SSE 구독자가 같은 프로세스에 있으므로 즉시 전달.
 *  - 워커 프로세스: PG NOTIFY(웹 relay가 수신해 재-emit). 로컬 publish는 구독자 0이라 무의미.
 * best-effort: 실패해도 저장/리스너에 영향 없게 호출부가 try/catch로 감싼다(신호일 뿐).
 */
export async function notifyRealtime(
  ownerAdminId: string,
  payload: RealtimeEvent
): Promise<void> {
  if (!ownerAdminId) return;
  if (!isWorkerRuntime()) {
    // 웹(현행) — in-process 버스로 직접 발행(누수 0, 스코프=ownerAdminId).
    publish(ownerAdminId, payload);
    return;
  }
  // 워커 — PG NOTIFY. 신호 페이로드만(본문·금액·마진 0). Prisma $executeRaw(pg_notify)로 pg 패키지 불요.
  const signal: RealtimeSignal = { ownerAdminId, ...payload };
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify(signal)})`;
  } catch (err) {
    console.error(
      "[realtime-notify] PG NOTIFY 발행 실패(무시):",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── 웹 LISTEN relay (ZALO_SESSION_LOCAL=false 전용) ─────────────

const globalForRelay = globalThis as unknown as { __villaRealtimeRelayStarted?: boolean };

/**
 * 웹 부팅 시 PG LISTEN 상주 리스너 시작 → NOTIFY 신호를 in-process realtime-bus로 재-emit.
 * Prisma는 LISTEN 미지원 → pg Client 직접 사용(1개 상주 커넥션). pg 패키지는 split 모드에서만 필요
 * (기본 미설정이면 이 함수 자체가 호출되지 않으므로 pg 없이도 빌드·현행 동작 무영향).
 *
 * 재연결 루프(R3): 커넥션 끊김 시 5초 후 재시도. 신호 유실은 지연일 뿐(브라우저가 재fetch로 무손실).
 */
export function startRealtimeListenRelay(): void {
  if (globalForRelay.__villaRealtimeRelayStarted) return;
  globalForRelay.__villaRealtimeRelayStarted = true;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[realtime-notify] DATABASE_URL 미설정 — LISTEN relay 미시작");
    return;
  }

  const connect = async (): Promise<void> => {
    // pg는 split 모드 전용 의존성 — 문자열 변수 지정으로 정적 번들/타입 해석 회피(미설치여도 기본 경로 무영향).
    const pgSpecifier = "pg";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pg: any = await import(/* webpackIgnore: true */ pgSpecifier);
    const Client = pg.Client ?? pg.default?.Client;
    const client = new Client({ connectionString: databaseUrl });

    client.on("error", (err: unknown) => {
      console.error(
        "[realtime-notify] LISTEN 커넥션 오류:",
        err instanceof Error ? err.message : String(err)
      );
    });

    client.on("notification", (msg: { channel: string; payload?: string }) => {
      if (msg.channel !== REALTIME_CHANNEL || !msg.payload) return;
      try {
        const sig = JSON.parse(msg.payload) as Partial<RealtimeSignal>;
        if (!sig.ownerAdminId || !sig.type || !sig.conversationId) return;
        // in-process 버스로 재-emit → /api/zalo/stream 구독 로직 무변경.
        publish(sig.ownerAdminId, { type: sig.type, conversationId: sig.conversationId });
      } catch {
        /* 손상 payload 무시(신호일 뿐) */
      }
    });

    client.on("end", () => {
      globalForRelay.__villaRealtimeRelayStarted = true;
      setTimeout(() => void reconnect(), 5000);
    });

    await client.connect();
    await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    console.log("[realtime-notify] PG LISTEN relay 시작 (zalo_realtime)");
  };

  const reconnect = async (): Promise<void> => {
    try {
      await connect();
    } catch (err) {
      console.error(
        "[realtime-notify] LISTEN relay 재연결 실패 — 5초 후 재시도:",
        err instanceof Error ? err.message : String(err)
      );
      setTimeout(() => void reconnect(), 5000);
    }
  };

  void reconnect();
}
