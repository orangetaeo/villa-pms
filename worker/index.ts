// worker/index.ts — Zalo 리스너 전용 워커 엔트리 (ADR-0032 BE-1·BE-2)
//
// 역할: zca-js 세션(시스템봇 + 관리자 개인계정 풀, ADR-0007)의 유일 보유자. Next.js 미기동.
//   node:http 내부 라우터(/internal/*)로 웹의 발송·QR·해제·상태 조회 위임을 처리하고,
//   부팅 시 connectAllActive()로 리스너를 상주시킨다(수신 저장 + PG NOTIFY).
//
// 실행: `tsx worker/index.ts`(개발) 또는 빌드 후 `node worker/dist/index.js`. Railway replica=1 고정.
//
// ★안전(밴 위험 제거의 핵심): 부팅 세션 접속은 ZALO_WORKER_CONNECT === "true"일 때만.
//   기본(미설정)엔 내부 HTTP만 뜨고 로그인하지 않는다(웹이 여전히 세션 보유 중일 수 있음 → 이중 로그인
//   code 3000 회피). 마이그레이션 §5 순서대로 웹 세션을 내린 뒤에만 이 플래그를 켠다.
//
// 보안: /internal/*는 공유 시크릿(verifyWorkerSecret) 첫 줄 인증. /healthz만 무인증(상태 요약, 누수 0).
//   credential·시크릿·전화·본문 미출력(D6.2 승계). 워커는 Railway 사설망만 노출(공개 HTTPS 없음).
import http from "node:http";
import { ThreadType } from "zca-js";
import { ZaloAccountKind } from "@prisma/client";
// ★반드시 다른 import보다 먼저 실행돼야 하는 부수효과 — 이 프로세스를 "워커"로 표시(발송=로컬, 신호=PG NOTIFY).
import { markWorkerRuntime } from "@/lib/zalo-runtime-role";
markWorkerRuntime();

import {
  connectAllActive,
  startQRLoginForAdmin,
  disconnectForAdmin,
  getStatusForAdmin,
  getSystemBotStatus,
  sendBotMessage,
  sendBotMessageWithAttachments,
  sendChatMessageAsAdmin,
  sendChatReplyAsAdmin,
  sendChatImageAsAdmin,
  sendChatFileAsAdmin,
  sendChatForwardAsAdmin,
  addReactionAsAdmin,
} from "@/lib/zalo-runtime";
import { startZaloHealthWatchdog } from "@/lib/zalo-health";
import { verifyWorkerSecret, WORKER_SECRET_HEADER, type WorkerSendCommand } from "@/lib/zalo-worker-client";

const PORT = Number(process.env.PORT ?? 8080);

// ── 유틸 ──────────────────────────────────────────────────────

function toThreadType(n?: number): ThreadType | undefined {
  return n === undefined ? undefined : (n as ThreadType);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 25 * 1024 * 1024) throw new Error("PAYLOAD_TOO_LARGE"); // 이미지 base64 여유(25MB)
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

// ── 발송 명령 실행 (로컬 — isWorkerRuntime=true라 wrapper가 위임 없이 직접 zca-js 발송) ──
async function executeSendCommand(cmd: WorkerSendCommand): Promise<unknown> {
  switch (cmd.fn) {
    case "sendBotMessage":
      return sendBotMessage(cmd.zaloUserId, cmd.text, toThreadType(cmd.threadType));
    case "sendBotMessageWithAttachments":
      return sendBotMessageWithAttachments(
        cmd.zaloUserId,
        cmd.text,
        cmd.attachments.map((a) => ({
          data: Buffer.from(a.dataBase64, "base64"),
          filename: a.filename,
          totalSize: a.totalSize,
        }))
      );
    case "sendChatMessageAsAdmin":
      return sendChatMessageAsAdmin(
        cmd.adminUserId,
        cmd.zaloUserId,
        cmd.text,
        toThreadType(cmd.threadType),
        cmd.mentions
      );
    case "sendChatReplyAsAdmin":
      return sendChatReplyAsAdmin(
        cmd.adminUserId,
        cmd.zaloUserId,
        cmd.text,
        cmd.quoteSource,
        toThreadType(cmd.threadType),
        cmd.mentions
      );
    case "sendChatImageAsAdmin":
      return sendChatImageAsAdmin(
        cmd.adminUserId,
        cmd.zaloUserId,
        Buffer.from(cmd.imageBase64, "base64"),
        cmd.fileName,
        cmd.caption,
        toThreadType(cmd.threadType)
      );
    case "sendChatFileAsAdmin":
      return sendChatFileAsAdmin(
        cmd.adminUserId,
        cmd.zaloUserId,
        Buffer.from(cmd.fileBase64, "base64"),
        cmd.fileName as `${string}.${string}`,
        cmd.caption,
        toThreadType(cmd.threadType)
      );
    case "sendChatForwardAsAdmin":
      return sendChatForwardAsAdmin(
        cmd.adminUserId,
        cmd.targetThreadId,
        cmd.message,
        cmd.reference,
        toThreadType(cmd.threadType)
      );
    case "addReactionAsAdmin":
      return addReactionAsAdmin(
        cmd.adminUserId,
        cmd.zaloUserId,
        cmd.target,
        cmd.iconKey,
        toThreadType(cmd.threadType)
      );
    default: {
      // 미상 fn — 안전 실패값(발송 계약 준수).
      return { ok: false, error: "UNKNOWN_SEND_FN" };
    }
  }
}

// ── HTTP 서버 ──────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      const url = req.url ?? "";
      const method = req.method ?? "GET";

      // 무인증 헬스체크 — 세션 상태 요약(누수 0: connected/status/displayName만).
      if (method === "GET" && url.startsWith("/healthz")) {
        const s = getSystemBotStatus();
        return sendJson(res, 200, {
          ok: true,
          systemBot: { connected: s.connected, status: s.status, displayName: s.displayName },
        });
      }

      // ── /internal/* 시크릿 게이트(첫 줄 인증) ──
      const provided = req.headers[WORKER_SECRET_HEADER];
      const providedStr = Array.isArray(provided) ? provided[0] : provided;
      if (!verifyWorkerSecret(providedStr)) {
        return sendJson(res, 401, { error: "UNAUTHORIZED" });
      }
      if (method !== "POST") {
        return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
      }

      if (url.startsWith("/internal/send")) {
        const cmd = (await readJson(req)) as WorkerSendCommand;
        if (!cmd || typeof cmd !== "object" || !("fn" in cmd)) {
          return sendJson(res, 400, { ok: false, error: "INVALID_COMMAND" });
        }
        const result = await executeSendCommand(cmd);
        return sendJson(res, 200, result);
      }

      if (url.startsWith("/internal/qr")) {
        const body = (await readJson(req)) as { adminUserId?: string; kind?: string };
        if (!body.adminUserId || !body.kind) {
          return sendJson(res, 400, { error: "INVALID_BODY" });
        }
        const qrImageBase64 = await startQRLoginForAdmin(
          body.adminUserId,
          body.kind as ZaloAccountKind
        );
        return sendJson(res, 200, { qrImageBase64 });
      }

      if (url.startsWith("/internal/disconnect")) {
        const body = (await readJson(req)) as { adminUserId?: string; kind?: string };
        if (!body.adminUserId || !body.kind) {
          return sendJson(res, 400, { error: "INVALID_BODY" });
        }
        await disconnectForAdmin(body.adminUserId, body.kind as ZaloAccountKind);
        return sendJson(res, 200, { ok: true });
      }

      if (url.startsWith("/internal/status")) {
        const body = (await readJson(req)) as { adminUserId?: string };
        // adminUserId 있으면 본인 계정, 없으면 시스템봇.
        const status = body.adminUserId
          ? await getStatusForAdmin(body.adminUserId)
          : getSystemBotStatus();
        return sendJson(res, 200, status);
      }

      return sendJson(res, 404, { error: "NOT_FOUND" });
    } catch (err) {
      // credential·시크릿·본문 미출력 — 일반 코드만.
      console.error(
        "[zalo-worker] 요청 처리 실패:",
        err instanceof Error ? err.message : String(err)
      );
      if (!res.headersSent) sendJson(res, 500, { error: "INTERNAL_ERROR" });
    }
  })();
});

server.listen(PORT, () => {
  console.log(`[zalo-worker] 내부 HTTP 리스닝 :${PORT} (/internal/*, /healthz)`);

  // ★ 세션 접속 — ZALO_WORKER_CONNECT === "true"일 때만(기본 미설정=미접속, 이중 로그인 회피).
  if (process.env.ZALO_WORKER_CONNECT === "true") {
    connectAllActive().catch((e) =>
      console.error(
        "[zalo-worker] connectAllActive 실패:",
        e instanceof Error ? e.message : e
      )
    );
    // 워치독은 워커가 소유(웹은 SESSION_LOCAL=false로 비활성). RAILWAY_ENVIRONMENT_NAME 가드는 내부에서.
    startZaloHealthWatchdog();
    console.log("[zalo-worker] ZALO_WORKER_CONNECT=true — 세션 접속 + 워치독 기동");
  } else {
    console.log("[zalo-worker] ZALO_WORKER_CONNECT 미설정 — 세션 미접속(내부 HTTP만)");
  }
});
