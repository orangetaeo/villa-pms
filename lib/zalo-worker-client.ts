// lib/zalo-worker-client.ts — 웹→리스너 워커 아웃바운드 위임 클라이언트 (ADR-0032 BE-2·BE-3·BE-5·BE-6)
//
// 목적: ADR-0032 토폴로지에서 zca-js 세션의 유일 보유자는 zalo-worker다. 웹의 발송·QR·해제·
//       상태조회 함수는 시그니처를 그대로 유지하되, ZALO_SESSION_LOCAL=false일 때 내부적으로
//       워커 사설망 HTTP(/internal/*)로 위임한다.
//
// 안전(기본-OFF, 밴 위험 제거의 핵심):
//   - shouldDelegate()는 ZALO_SESSION_LOCAL === "false" 이고 && 워커 프로세스가 아닐 때만 true.
//     · 플래그 미설정(기본) → false → 웹이 현행대로 in-process 발송(현행 동작 100% 보존, no-op).
//     · 워커 프로세스(markWorkerRuntime) → 항상 false → 워커의 /internal 핸들러는 로컬 발송을 직접 실행
//       (자기 자신에게 위임하는 무한루프 방지).
//   - 워커 불통 시 { ok:false, error:BOT_NOT_CONNECTED }(발송 안전 실패 — 알림은 PENDING 유지·재시도, R2).
//
// 보안: 사설망 공유 시크릿(ZALO_WORKER_SECRET, 폴백 ZALO_EXT_SHARED_SECRET)을 헤더로 전달.
//   timingSafeEqual 검증은 verifyWorkerSecret. 시크릿·본문은 로그·에러에 미출력. 워커는 공개 HTTPS 미노출.
import { timingSafeEqual } from "node:crypto";
import { isWorkerRuntime } from "@/lib/zalo-runtime-role";

// ── 결과 타입(구조 동형 — 순환 import 회피용으로 zalo-runtime 미import) ──
export type WorkerSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };
export type WorkerReactionResult = { ok: true } | { ok: false; error: string };

/** 워커 미연결·위임 실패 시 안전 실패값(발송 함수 계약의 ERROR_BOT_NOT_CONNECTED와 동일 문자열). */
export const WORKER_UNREACHABLE_ERROR = "BOT_NOT_CONNECTED";

export const WORKER_SECRET_HEADER = "x-zalo-worker-secret";
const INTERNAL_TIMEOUT_MS = 15_000;

// ── 발송 명령 union (내부 RPC — ext/send union의 상위집합. adminUserId를 실어 다중 관리자 세션 지원) ──
export type WorkerSendCommand =
  // threadType(선택) — ADR-0040 그룹 발송(ThreadType.Group=1). 미지정 시 워커가 USER(0)로 처리(기존 동작).
  | { fn: "sendBotMessage"; zaloUserId: string; text: string; threadType?: number }
  | {
      fn: "sendBotMessageWithAttachments";
      zaloUserId: string;
      text: string;
      attachments: { dataBase64: string; filename: string; totalSize: number }[];
    }
  | {
      fn: "sendChatMessageAsAdmin";
      adminUserId: string;
      zaloUserId: string;
      text: string;
      threadType?: number;
      mentions?: { pos: number; uid: string; len: number }[];
    }
  | {
      fn: "sendChatReplyAsAdmin";
      adminUserId: string;
      zaloUserId: string;
      text: string;
      quoteSource: { zaloMsgId: string; cliMsgId: string; content: string; uidFrom: string };
      threadType?: number;
      mentions?: { pos: number; uid: string; len: number }[];
    }
  | {
      fn: "sendChatImageAsAdmin";
      adminUserId: string;
      zaloUserId: string;
      imageBase64: string;
      fileName: string;
      caption?: string;
      threadType?: number;
    }
  | {
      fn: "sendChatFileAsAdmin";
      adminUserId: string;
      zaloUserId: string;
      fileBase64: string;
      fileName: string;
      caption?: string;
      threadType?: number;
    }
  | {
      fn: "sendChatForwardAsAdmin";
      adminUserId: string;
      targetThreadId: string;
      message: string;
      reference?: { id: string; ts: number; logSrcType: number; fwLvl: number };
      threadType?: number;
    }
  | {
      fn: "addReactionAsAdmin";
      adminUserId: string;
      zaloUserId: string;
      target: { zaloMsgId: string; cliMsgId: string };
      iconKey: string;
      threadType?: number;
    };

// ── 플래그 · 환경 ──────────────────────────────────────────────

/** 웹이 세션을 직접 보유(현행)하는가? 기본 true(플래그 미설정 시 현행 동작 보존). */
export function isSessionLocal(): boolean {
  return process.env.ZALO_SESSION_LOCAL !== "false";
}

/**
 * 이 호출을 워커로 위임해야 하는가? — 세션 비보유(웹, SESSION_LOCAL=false)이고 워커 프로세스가 아닐 때만.
 * 워커 자신은 항상 로컬 실행(자기 위임 루프 방지).
 */
export function shouldDelegate(): boolean {
  return !isSessionLocal() && !isWorkerRuntime();
}

function workerBaseUrl(): string | null {
  return process.env.ZALO_WORKER_URL ?? null;
}

function workerSecret(): string | null {
  return process.env.ZALO_WORKER_SECRET ?? process.env.ZALO_EXT_SHARED_SECRET ?? null;
}

/** 워커 요청 헤더(시크릿 포함) — 미설정이면 secret 헤더 생략(워커가 401 처리). */
export function buildWorkerAuthHeaders(): Record<string, string> {
  const secret = workerSecret();
  return {
    "content-type": "application/json",
    ...(secret ? { [WORKER_SECRET_HEADER]: secret } : {}),
  };
}

/**
 * 워커 측 시크릿 검증(timingSafeEqual) — /internal/* 핸들러 첫 줄 인증.
 * env 미설정·헤더 없음·불일치 모두 false. 시크릿 값·길이 미노출.
 */
export function verifyWorkerSecret(provided: string | null | undefined): boolean {
  const expected = workerSecret();
  if (!expected) return false;
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── 내부 HTTP 호출 ─────────────────────────────────────────────

async function postInternal(path: string, body: unknown): Promise<unknown | null> {
  const base = workerBaseUrl();
  if (!base) return null; // URL 미설정 → 위임 불가(호출부에서 안전 실패값 반환)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERNAL_TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: buildWorkerAuthHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // 네트워크·타임아웃 실패 — 시크릿·본문 미노출. 호출부가 안전 실패값 결정.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── 발송 위임 ─────────────────────────────────────────────────

/** 발송 명령을 워커 /internal/send로 위임. 실패 시 안전 실패값. */
export async function delegateSend(command: WorkerSendCommand): Promise<WorkerSendResult> {
  const json = (await postInternal("/internal/send", command)) as WorkerSendResult | null;
  if (!json || typeof json !== "object" || !("ok" in json)) {
    return { ok: false, error: WORKER_UNREACHABLE_ERROR };
  }
  return json;
}

/** 리액션 명령 위임 — ReactionResult 형태. 실패 시 안전 실패값. */
export async function delegateReaction(
  command: Extract<WorkerSendCommand, { fn: "addReactionAsAdmin" }>
): Promise<WorkerReactionResult> {
  const json = (await postInternal("/internal/send", command)) as WorkerReactionResult | null;
  if (!json || typeof json !== "object" || !("ok" in json)) {
    return { ok: false, error: WORKER_UNREACHABLE_ERROR };
  }
  return json;
}

// ── QR · 해제 · 상태 위임 (BE-5·BE-6) ─────────────────────────

/** QR 로그인 위임 — 워커에서 세션 생성, QR base64 반환. 실패 시 null(호출부 500). */
export async function delegateQrLogin(
  adminUserId: string,
  kind: string
): Promise<string | null> {
  const json = (await postInternal("/internal/qr", { adminUserId, kind })) as
    | { qrImageBase64?: string }
    | null;
  return json?.qrImageBase64 ?? null;
}

/** 연결 해제 위임. */
export async function delegateDisconnect(adminUserId: string, kind: string): Promise<boolean> {
  const json = (await postInternal("/internal/disconnect", { adminUserId, kind })) as
    | { ok?: boolean }
    | null;
  return json?.ok === true;
}

/** 상태 조회 위임 — 워커 불통 시 disconnected 안전값(BE-6). */
export async function delegateStatus(adminUserId: string): Promise<{
  connected: boolean;
  status: string;
  displayName: string | null;
  lastConnected: string | null;
  lastError: string | null;
}> {
  const json = (await postInternal("/internal/status", { adminUserId })) as {
    connected?: boolean;
    status?: string;
    displayName?: string | null;
    lastConnected?: string | null;
    lastError?: string | null;
  } | null;
  if (!json || typeof json.connected !== "boolean") {
    return {
      connected: false,
      status: "disconnected",
      displayName: null,
      lastConnected: null,
      lastError: null,
    };
  }
  return {
    connected: json.connected,
    status: json.status ?? "disconnected",
    displayName: json.displayName ?? null,
    lastConnected: json.lastConnected ?? null,
    lastError: json.lastError ?? null,
  };
}

/**
 * [일회성 유지보수] 대화명 보정 위임 — 세션 보유 워커에서 getUserInfo로 실제 상대명 교정.
 * 세션은 워커에만 있으므로(ZALO_SESSION_LOCAL=false) 웹 라우트는 이 위임으로만 교정할 수 있다.
 * 워커 불통 시 null(호출부에서 안전 실패 처리).
 */
export async function delegateRefreshNames(body: {
  limit?: number;
  dryRun?: boolean;
}): Promise<Record<string, unknown> | null> {
  const json = (await postInternal("/internal/refresh-names", body)) as
    | Record<string, unknown>
    | null;
  return json && typeof json === "object" ? json : null;
}
