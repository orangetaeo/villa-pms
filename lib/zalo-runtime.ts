// [SHARED-MODULE] from Nike src/lib/zalo-pool.ts (v1.x) — 단일 인스턴스로 축약 (ADR-0006 D5.3)
/**
 * Zalo 봇 단일 인스턴스 매니저.
 *
 * Nike의 멀티유저 풀(Map<userId, instance>)을 villa-pms 봇 1개 모델로 축약한다.
 * - globalThis.zaloBot 단일 슬롯 (D1.4) — HMR/instrumentation 중복 호출에도 1개만 생존
 * - connectPromise mutex (D2.2) — 동시 로그인 가드 (replica=1과 함께 이중 로그인 밴 방지)
 * - WebSocket 리스너는 next start Node 프로세스에 상주 (D1.3)
 *
 * 본 단계(S1~S2) 범위: connect/QR/status/getApi/disconnect.
 * 수신 리스너 본문 저장(S3)·발송(S4)은 후속 단계 — 여기서는 listener.start()로 세션만 유지.
 *
 * 보안(D6): credential은 lib/zalo-credentials에서만 다룬다. 여기서는 평문 credential을
 * 절대 로그/응답에 내보내지 않는다. _pendingCreds는 onLoginSuccess 직후 즉시 폐기.
 */
import { Zalo, ThreadType, type API } from "zca-js";
import {
  LoginQRCallbackEventType,
  type LoginQRCallbackEvent,
  type Message,
  type UserMessage,
} from "zca-js";
import {
  saveCredentials,
  loadCredentials,
  setCredentialsInactive,
  type ZaloCredentials,
} from "./zalo-credentials";
import { writeAuditLog } from "./audit-log";
import {
  extractText,
  isEchoMessage,
  buildInboundKey,
  saveInboundMessage,
} from "./zalo-inbound";

export type ZaloStatus = "disconnected" | "qr_pending" | "connected" | "error";

/**
 * 봇 미연결/세션 만료 — 발송 불가 (S4). attempt 미증가·자동 회복 동작은
 * 기존 ZALO_TOKEN_NOT_SET을 계승한다(봇 재로그인 후 다음 cron에서 자동 발송, ADR-0006 D5.4).
 */
export const ERROR_BOT_NOT_CONNECTED = "BOT_NOT_CONNECTED";

interface ZaloBotInstance {
  api: API | null;
  status: ZaloStatus;
  lastError: string | null;
  qrImageBase64: string | null;
  ownId: string | null;
  accountId: string | null;
  displayName: string | null;
  lastConnected: Date | null;
  /** credential 로그인 동시 호출 가드 (D2.2) */
  connectPromise: Promise<void> | null;
  /** QR 로그인 중 임시 자격증명 — onLoginSuccess에서 저장 후 즉시 폐기 */
  _pendingCreds?: ZaloCredentials | null;
  /** QR 스캔 단계에서 받은 표시명 (GotLoginInfo엔 없어 QRCodeScanned에서 보관) */
  _scannedName?: string | null;
  /** 봇을 소유한 ADMIN userId (QR 시작 시점 세션) */
  _ownerUserId?: string | null;
}

// ── globalThis 단일 슬롯 (D1.4) ───────────────────────────────
const globalForBot = globalThis as unknown as {
  zaloBot: ZaloBotInstance | undefined;
};

function getInstance(): ZaloBotInstance {
  if (!globalForBot.zaloBot) {
    globalForBot.zaloBot = {
      api: null,
      status: "disconnected",
      lastError: null,
      qrImageBase64: null,
      ownId: null,
      accountId: null,
      displayName: null,
      lastConnected: null,
      connectPromise: null,
    };
  }
  return globalForBot.zaloBot;
}

// ── 공개 API ──────────────────────────────────────────────────

export interface BotStatus {
  connected: boolean;
  status: ZaloStatus;
  displayName: string | null;
  lastConnected: string | null; // ISO — credential 절대 미포함 (D6.2)
  lastError: string | null;
}

/**
 * 봇 연결 상태 (credential 미포함 — API 응답 안전).
 */
export function getBotStatus(): BotStatus {
  const inst = getInstance();
  return {
    connected: inst.status === "connected",
    status: inst.status,
    displayName: inst.displayName,
    lastConnected: inst.lastConnected ? inst.lastConnected.toISOString() : null,
    lastError: inst.lastError,
  };
}

/**
 * 로그인된 zca-js API 인스턴스 (발송·조회용, S3/S4). 미연결 시 null.
 */
export function getBotApi(): API | null {
  const inst = getInstance();
  return inst.status === "connected" ? inst.api : null;
}

/**
 * 저장된 credential로 자동 재로그인 (instrumentation 부팅 + 라우트 자동 재연결용).
 * credential이 없으면 조용히 종료(QR 대기 상태). 동시 호출은 connectPromise로 1회만.
 */
export async function connectBot(): Promise<boolean> {
  const inst = getInstance();
  if (inst.status === "connected") return true;
  if (inst.connectPromise) {
    await inst.connectPromise;
    return getInstance().status === "connected";
  }

  // 첫 await 이전에 동기 등록 (yield 사이 동시 호출 이중 로그인 race 방지 — Nike 패턴)
  const flow = (async () => {
    const saved = await loadCredentials();
    if (!saved) {
      // credential 없음 → QR 로그인 대기. 에러 아님.
      return;
    }
    inst.accountId = saved.accountId;
    inst.displayName = saved.displayName;
    inst._ownerUserId = saved.userId;
    await doCredentialLogin(inst, saved.credentials);
  })();
  inst.connectPromise = flow;

  try {
    await flow;
    return getInstance().status === "connected";
  } catch (err) {
    // flow 내 onLoginSuccess가 status를 변경했을 수 있으므로 fresh 조회
    const cur = getInstance();
    if (cur.status !== "connected") cur.status = "disconnected";
    cur.lastError = err instanceof Error ? err.message : "Credential login failed";
    return false;
  } finally {
    inst.connectPromise = null;
  }
}

/**
 * QR 로그인 시작 — QR 이미지(base64)를 반환한다.
 * 스캔 성공(GotLoginInfo→login resolve) 시 onLoginSuccess에서 credential 암호화 저장 + AuditLog.
 * @param ownerUserId 봇을 소유할 ADMIN userId (소유권·재로그인 매칭)
 */
export async function startBotQRLogin(ownerUserId: string): Promise<string> {
  const inst = getInstance();

  // 이미 QR 진행 중이면 기존 QR 재사용
  if (inst.status === "qr_pending" && inst.qrImageBase64) {
    return inst.qrImageBase64;
  }

  inst.status = "qr_pending";
  inst.qrImageBase64 = null;
  inst.lastError = null;
  inst._ownerUserId = ownerUserId;
  inst._scannedName = null;

  return new Promise<string>((resolveQR, rejectQR) => {
    const zalo = new Zalo({
      selfListen: true,
      logging: false,
    } as Partial<import("zca-js").Options>);

    // qrPath는 .gitignore된 임시 파일 (D6.2). base64는 콜백 event.data.image로 직접 받는다.
    const loginPromise = zalo.loginQR(
      { qrPath: "./qr.png" },
      (event: LoginQRCallbackEvent) => {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated: {
            inst.qrImageBase64 = event.data.image;
            resolveQR(event.data.image);
            break;
          }
          case LoginQRCallbackEventType.QRCodeExpired: {
            inst.lastError = "QR code expired";
            event.actions.retry();
            break;
          }
          case LoginQRCallbackEventType.QRCodeScanned: {
            inst._scannedName = event.data.display_name ?? null;
            break;
          }
          case LoginQRCallbackEventType.QRCodeDeclined: {
            inst.status = "error";
            inst.lastError = "QR login declined";
            rejectQR(new Error("QR login declined"));
            break;
          }
          case LoginQRCallbackEventType.GotLoginInfo: {
            // credential 임시 보관 (onLoginSuccess에서 암호화 저장 후 즉시 폐기). 로그 금지.
            inst._pendingCreds = {
              imei: event.data.imei,
              cookie: event.data.cookie,
              userAgent: event.data.userAgent,
            };
            break;
          }
        }
      }
    );

    loginPromise
      .then((api) => {
        if (!api) {
          inst.status = "error";
          inst.lastError = "Login returned null";
          return;
        }
        // onLoginSuccess는 비동기(credential 저장) — 에러는 내부에서 status로 반영
        void onLoginSuccess(inst, api);
      })
      .catch((err) => {
        inst.status = "error";
        inst.lastError = err instanceof Error ? err.message : "QR login failed";
        rejectQR(err);
      });

    // QR 생성 자체가 30초 내 안 되면 타임아웃
    setTimeout(() => {
      if (!inst.qrImageBase64) {
        rejectQR(new Error("QR generation timed out"));
      }
    }, 30000);
  });
}

/**
 * 봇 연결 해제 — 리스너 정지 + credential 비활성화.
 */
export async function disconnectBot(): Promise<void> {
  const inst = getInstance();

  if (inst.api) {
    try {
      inst.api.listener.stop();
    } catch {
      /* ignore */
    }
    try {
      inst.api.listener.removeAllListeners();
    } catch {
      /* ignore */
    }
  }

  const zaloUserId = inst.ownId;
  const ownerUserId = inst._ownerUserId;
  const accountId = inst.accountId;

  if (zaloUserId) {
    await setCredentialsInactive(zaloUserId).catch((e) =>
      console.error("[ZaloBot] 자격증명 비활성화 실패:", e instanceof Error ? e.message : e)
    );
  }

  // AuditLog — credential 절대 미기록 (D6.2)
  if (accountId) {
    writeAuditLog({
      action: "DELETE",
      entity: "ZaloAccount",
      entityId: accountId,
      userId: ownerUserId ?? undefined,
      changes: { type: { old: "CONNECTED", new: "DISCONNECTED" } },
    }).catch(() => {});
  }

  inst.api = null;
  inst.status = "disconnected";
  inst.ownId = null;
  inst.accountId = null;
  inst.displayName = null;
  inst.qrImageBase64 = null;
  inst._pendingCreds = null;
  inst.connectPromise = null;
}

// ── 내부 헬퍼 ──────────────────────────────────────────────────

async function doCredentialLogin(inst: ZaloBotInstance, credentials: ZaloCredentials) {
  const zalo = new Zalo({
    selfListen: true,
    logging: false,
  } as Partial<import("zca-js").Options>);

  const api = await zalo.login(credentials as import("zca-js").Credentials);
  await onLoginSuccess(inst, api);
}

async function onLoginSuccess(inst: ZaloBotInstance, api: API) {
  inst.api = api;
  inst.status = "connected";
  inst.lastError = null;
  inst.lastConnected = new Date();

  try {
    inst.ownId = api.getOwnId();
  } catch {
    inst.ownId = null;
  }

  // QR 로그인 직후: credential 암호화 저장 (D6) — 저장 후 _pendingCreds 즉시 폐기
  if (inst._pendingCreds && inst.ownId) {
    const pendingCreds = inst._pendingCreds;
    inst._pendingCreds = null;
    const displayName = inst._scannedName ?? inst.displayName ?? undefined;
    try {
      const accountId = await saveCredentials(
        inst.ownId,
        pendingCreds,
        inst._ownerUserId ?? undefined,
        displayName
      );
      inst.accountId = accountId;
      if (displayName) inst.displayName = displayName;

      // AuditLog — displayName만 (credential 절대 금지, D6.2)
      writeAuditLog({
        action: "CREATE",
        entity: "ZaloAccount",
        entityId: accountId,
        userId: inst._ownerUserId ?? undefined,
        changes: {
          type: { new: "CONNECT" },
          displayName: { new: displayName ?? null },
        },
      }).catch(() => {});
    } catch (err) {
      // credential 저장 실패(주로 ZALO_CREDS_KEY 미설정)를 조용히 삼키면 화면은
      // "연결됨"으로 거짓 표시되지만 재시작 후 자동 재로그인이 불가능해진다.
      // → 명시적으로 error 상태로 전환해 운영자가 즉시 원인을 인지하게 한다.
      inst.status = "error";
      inst.lastError =
        "Zalo 자격증명 저장 실패 — ZALO_CREDS_KEY 환경변수를 확인하세요 (미설정 시 재시작 후 연결이 끊깁니다)";
      console.error(
        "[ZaloBot] credential 저장 실패:",
        err instanceof Error ? err.message : err
      );
    }
  } else if (inst._pendingCreds && !inst.ownId) {
    // QR 로그인했으나 ownId를 못 얻음 → credential 저장 불가 (영속 실패)
    inst._pendingCreds = null;
    inst.status = "error";
    inst.lastError = "Zalo 계정 ID 확인 실패 — 다시 QR 로그인하세요";
  } else {
    inst._pendingCreds = null;
  }

  // WebSocket 리스너 시작 — 세션 유지 + 수신 저장(S3).
  try {
    api.listener.on("connected", () => {
      inst.status = "connected";
      inst.lastConnected = new Date();
    });
    // S3 — 수신 메시지 핸들러. UserMessage(1:1)만 처리, 그룹·에코는 스킵.
    api.listener.on("message", (message: Message) => {
      void handleInboundEvent(inst, message);
    });
    api.listener.on("closed", (code: number) => {
      // code 3000 = DuplicateConnection — 다른 곳에서 봇 계정 로그인됨 (D2.3, 밴 위험 신호)
      if (code === 3000) {
        inst.status = "error";
        inst.lastError = "다른 곳에서 로그인됨 (code 3000) — replica=1 확인 필요";
      } else if (inst.status === "connected") {
        // 세션 종료 — credential은 DB에 남아 다음 connectBot()에서 자동 재로그인 (D1.2)
        inst.status = "disconnected";
        inst.lastError = `WebSocket closed (code ${code})`;
      }
    });
    api.listener.on("error", (err: unknown) => {
      inst.lastError = err instanceof Error ? err.message : "listener error";
    });
    // retryOnClose: 일시 끊김 시 zca-js가 자동 재연결 시도 (D1.2)
    api.listener.start({ retryOnClose: true });
  } catch (err) {
    console.error(
      "[ZaloBot] 리스너 시작 실패:",
      err instanceof Error ? err.message : err
    );
  }
}

// ── S3 수신 핸들러 ────────────────────────────────────────────

/**
 * zca-js message 이벤트 → 파싱 → DB 저장.
 * - UserMessage(ThreadType.User)만 처리. 그룹 메시지는 무시.
 * - 봇 본인 발신 에코(isSelf 또는 ownId 일치)는 저장 스킵 — S4 발송이 OUTBOUND를 이미 미러.
 * - 멱등·예외 안전: 1건 실패가 리스너를 죽이지 않도록 전체 try/catch.
 *   credential·세션 객체는 본 경로에서 다루지 않으며 로그에 메시지 본문·번호를 출력하지 않는다.
 */
async function handleInboundEvent(inst: ZaloBotInstance, message: Message): Promise<void> {
  try {
    if (message.type !== ThreadType.User) return; // 그룹 무시
    const userMsg = message as UserMessage;
    const data = userMsg.data as Record<string, unknown>;

    const senderId =
      (data.uidFrom as string | undefined) ??
      (data.userId as string | undefined) ??
      null;

    // 에코 제외 — 봇 본인 발신
    if (isEchoMessage({ isSelf: userMsg.isSelf, senderId }, inst.ownId)) return;

    const senderZaloUserId = userMsg.threadId || senderId;
    if (!senderZaloUserId) return;

    const text = extractText(userMsg.data.content);
    if (!text) return; // 텍스트 없는 수신(첨부 전용 등)은 S5 범위 — Phase 1 스킵

    await saveInboundMessage({
      senderZaloUserId,
      text,
      zaloMsgId: buildInboundKey(userMsg.data),
      displayName: (data.dName as string | undefined) ?? null,
      // zca-js 텍스트 메시지에는 발신자 전화번호가 실리지 않음 — 본문에서 추출(saveInboundMessage 내부)
      senderPhone: null,
    });
  } catch (err) {
    // 1건 실패가 리스너를 죽이지 않게 — 본문·번호 미포함, 메시지만 기록
    console.error(
      "[ZaloBot] 수신 처리 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── S4 발송 ──────────────────────────────────────────────────

export type BotSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

/**
 * 봇 계정으로 텍스트 1건 발송 (S4 — dispatchOne·b14 채팅 공용).
 * 봇 미연결 시 ok:false + ERROR_BOT_NOT_CONNECTED(호출부에서 attempt 미증가 처리).
 * 예외 없이 결과 객체 반환 — credential·세션은 절대 결과/로그에 포함하지 않는다.
 */
export async function sendBotMessage(
  zaloUserId: string,
  text: string
): Promise<BotSendResult> {
  const api = getBotApi();
  if (!api) {
    return { ok: false, error: ERROR_BOT_NOT_CONNECTED };
  }
  try {
    const res = await api.sendMessage(text, zaloUserId, ThreadType.User);
    const msgId = res?.message?.msgId;
    return { ok: true, messageId: msgId != null ? String(msgId) : null };
  } catch (e) {
    return {
      ok: false,
      error: `SEND_ERROR: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    };
  }
}
