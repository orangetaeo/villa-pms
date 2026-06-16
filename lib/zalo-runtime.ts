// [SHARED-MODULE] from Nike src/lib/zalo-pool.ts (v1.x) — 멀티 계정 풀 부활 (ADR-0007 S1)
/**
 * Zalo 멀티 계정 풀 매니저 (ADR-0007).
 *
 * ADR-0006의 단일 슬롯(globalThis.zaloBot)을 Map<string, instance>로 확장한다.
 *  - 풀 키: 관리자 개인 계정 = adminUserId, 시스템봇 = 예약 키 "__system__".
 *  - 시스템 발송(dispatchOne)은 getSystemBotApi() → "__system__" 인스턴스 (무변경 분기).
 *  - 채팅 발송/조회는 getApiForAdmin(adminUserId) → 본인 인스턴스.
 *  - 통합 모드(D1): 테오는 SYSTEM_BOT 1계정 = "__system__" 1 인스턴스를 시스템 발송 + 본인 채팅에 공유.
 *    같은 계정 이중 로그인 금지(code 3000 회피) — 테오 개인 채팅도 "__system__" 인스턴스를 그대로 쓴다.
 *  - 다른 관리자(ADMIN_PERSONAL)는 각자 adminUserId 키 인스턴스.
 *  - connectPromise mutex (D2.2) — 동시 로그인 가드. replica=1과 함께 이중 로그인 밴 방지.
 *  - WebSocket 리스너는 next start Node 프로세스에 상주 (ADR-0006 D1.3).
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
import { ZaloAccountKind } from "@prisma/client";
import { prisma } from "./prisma";
import {
  saveCredentials,
  loadAllActiveCredentials,
  loadCredentialsForAccount,
  getSystemBotOwnerId,
  setCredentialsInactive,
  type ZaloCredentials,
} from "./zalo-credentials";
import { writeAuditLog } from "./audit-log";
import {
  extractText,
  isSelfMessage,
  buildInboundKey,
  parseZaloTs,
  saveInboundMessage,
  saveOutboundEcho,
  maybeTranslateInbound,
} from "./zalo-inbound";

export type ZaloStatus = "disconnected" | "qr_pending" | "connected" | "error";

/** 시스템봇 예약 풀 키 (D1) — adminUserId와 충돌하지 않는 sentinel. */
export const SYSTEM_BOT_KEY = "__system__";

/**
 * 봇 미연결/세션 만료 — 발송 불가 (S4). attempt 미증가·자동 회복 동작은
 * 기존 ZALO_TOKEN_NOT_SET을 계승한다(봇 재로그인 후 다음 cron에서 자동 발송, ADR-0006 D5.4).
 */
export const ERROR_BOT_NOT_CONNECTED = "BOT_NOT_CONNECTED";

interface ZaloBotInstance {
  /** 풀 키 (adminUserId 또는 "__system__") */
  poolKey: string;
  /** 이 인스턴스를 소유한 ADMIN userId (수신 귀속·미러용) */
  ownerAdminId: string | null;
  /** 시스템봇 인스턴스 여부 (수신 전화번호 매칭은 이것만 — D4) */
  isSystemBot: boolean;
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
  /** QR 스캔 단계에서 받은 표시명 */
  _scannedName?: string | null;
  /** QR 로그인 대상 계정 종류 (저장 시 kind) */
  _kind: ZaloAccountKind;
}

// ── globalThis 멀티 풀 ───────────────────────────────────────
const globalForPool = globalThis as unknown as {
  zaloPool: Map<string, ZaloBotInstance> | undefined;
  zaloPoolInitialized: boolean | undefined;
  zaloSystemOwnerId: string | null | undefined;
};

function getPool(): Map<string, ZaloBotInstance> {
  if (!globalForPool.zaloPool) globalForPool.zaloPool = new Map();
  return globalForPool.zaloPool;
}

function createInstance(
  poolKey: string,
  opts: { ownerAdminId: string | null; isSystemBot: boolean; kind: ZaloAccountKind }
): ZaloBotInstance {
  return {
    poolKey,
    ownerAdminId: opts.ownerAdminId,
    isSystemBot: opts.isSystemBot,
    api: null,
    status: "disconnected",
    lastError: null,
    qrImageBase64: null,
    ownId: null,
    accountId: null,
    displayName: null,
    lastConnected: null,
    connectPromise: null,
    _kind: opts.kind,
  };
}

/** 현재 연결 상태 읽기 — TS 좁힘 우회(상태는 비동기 콜백이 mutate). */
function isConnected(inst: ZaloBotInstance): boolean {
  return (inst.status as ZaloStatus) === "connected";
}

function getOrCreateInstance(
  poolKey: string,
  opts: { ownerAdminId: string | null; isSystemBot: boolean; kind: ZaloAccountKind }
): ZaloBotInstance {
  const pool = getPool();
  let inst = pool.get(poolKey);
  if (!inst) {
    inst = createInstance(poolKey, opts);
    pool.set(poolKey, inst);
  } else {
    // 메타 보정 (재연결·QR 재시작 시 소유자/종류 최신화)
    if (opts.ownerAdminId) inst.ownerAdminId = opts.ownerAdminId;
    inst.isSystemBot = opts.isSystemBot;
    inst._kind = opts.kind;
  }
  return inst;
}

/** 시스템봇 소유자 userId 캐시 조회 (없으면 DB 1회 로드). */
async function resolveSystemOwnerId(): Promise<string | null> {
  if (globalForPool.zaloSystemOwnerId !== undefined) return globalForPool.zaloSystemOwnerId;
  const id = await getSystemBotOwnerId();
  globalForPool.zaloSystemOwnerId = id;
  return id;
}

/** 풀 키 해석 (kind별). 시스템봇은 항상 "__system__". */
function poolKeyFor(adminUserId: string, kind: ZaloAccountKind): string {
  return kind === ZaloAccountKind.SYSTEM_BOT ? SYSTEM_BOT_KEY : adminUserId;
}

// ── 공개 API ──────────────────────────────────────────────────

export interface BotStatus {
  connected: boolean;
  status: ZaloStatus;
  displayName: string | null;
  lastConnected: string | null; // ISO — credential 절대 미포함 (D6.2)
  lastError: string | null;
}

const DISCONNECTED_STATUS: BotStatus = {
  connected: false,
  status: "disconnected",
  displayName: null,
  lastConnected: null,
  lastError: null,
};

function instStatus(inst: ZaloBotInstance | undefined): BotStatus {
  if (!inst) return DISCONNECTED_STATUS;
  return {
    connected: inst.status === "connected",
    status: inst.status,
    displayName: inst.displayName,
    lastConnected: inst.lastConnected ? inst.lastConnected.toISOString() : null,
    lastError: inst.lastError,
  };
}

/**
 * 시스템봇 연결 상태 (credential 미포함). 시스템 발송 모니터링용.
 */
export function getSystemBotStatus(): BotStatus {
  return instStatus(getPool().get(SYSTEM_BOT_KEY));
}

/**
 * 특정 관리자 본인 계정 연결 상태 (credential 미포함 — API 응답 안전).
 * 통합 모드: 테오(시스템봇 소유자)는 "__system__" 인스턴스 상태를 본다.
 */
export async function getStatusForAdmin(adminUserId: string): Promise<BotStatus> {
  const inst = await resolveAdminInstance(adminUserId);
  return instStatus(inst);
}

/**
 * 시스템 발송용 API (dispatchOne 전용, S4). "__system__" 인스턴스. 미연결 시 null.
 */
export function getSystemBotApi(): API | null {
  const inst = getPool().get(SYSTEM_BOT_KEY);
  return inst && inst.status === "connected" ? inst.api : null;
}

/**
 * 관리자 본인 계정의 zca-js API (채팅 발송·조회). 미연결 시 null.
 * 통합 모드: 테오는 "__system__" 인스턴스를 공유.
 */
export async function getApiForAdmin(adminUserId: string): Promise<API | null> {
  const inst = await resolveAdminInstance(adminUserId);
  return inst && inst.status === "connected" ? inst.api : null;
}

/**
 * 관리자 → 인스턴스 해석.
 *  1) adminUserId 키 인스턴스(ADMIN_PERSONAL)가 있으면 그것
 *  2) 없고 adminUserId == 시스템봇 소유자면 "__system__" 인스턴스 (통합 모드)
 *  3) 그 외 undefined
 */
async function resolveAdminInstance(
  adminUserId: string
): Promise<ZaloBotInstance | undefined> {
  const pool = getPool();
  const personal = pool.get(adminUserId);
  if (personal) return personal;
  const systemOwner = await resolveSystemOwnerId();
  if (systemOwner && adminUserId === systemOwner) {
    return pool.get(SYSTEM_BOT_KEY);
  }
  return undefined;
}

/**
 * 부팅 시 모든 활성 계정 순차 재로그인 (ADR-0007 — Nike connectAllUsers).
 * credential 없으면 빈 풀로 종료. 동시 호출은 zaloPoolInitialized + connectPromise로 1회만.
 */
let bootConnectPromise: Promise<void> | null = null;

export async function connectAllActive(): Promise<void> {
  if (bootConnectPromise) return bootConnectPromise;
  if (globalForPool.zaloPoolInitialized) return;

  bootConnectPromise = (async () => {
    if (globalForPool.zaloPoolInitialized) return;
    globalForPool.zaloPoolInitialized = true;

    const allCreds = await loadAllActiveCredentials();
    if (allCreds.length === 0) {
      console.log("[ZaloPool] 활성 계정 없음 — QR 로그인 대기");
      return;
    }

    // 시스템봇 소유자 캐시 갱신
    const sysOwner = allCreds.find((c) => c.kind === ZaloAccountKind.SYSTEM_BOT);
    if (sysOwner) globalForPool.zaloSystemOwnerId = sysOwner.userId;

    // 순차 로그인 (병렬 금지 — Zalo API 과부하·동시 로그인 트리거 회피, D2.5)
    for (const cred of allCreds) {
      const key = poolKeyFor(cred.userId, cred.kind);
      const inst = getOrCreateInstance(key, {
        ownerAdminId: cred.userId,
        isSystemBot: cred.kind === ZaloAccountKind.SYSTEM_BOT,
        kind: cred.kind,
      });
      inst.accountId = cred.accountId;
      inst.displayName = cred.displayName;
      try {
        await doCredentialLogin(inst, cred.credentials);
      } catch (err) {
        console.error(
          `[ZaloPool] 계정 ${cred.accountId} 재로그인 실패:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    console.log(`[ZaloPool] ${getPool().size}개 인스턴스 초기화 완료`);
  })().finally(() => {
    bootConnectPromise = null;
  });

  return bootConnectPromise;
}

/**
 * 저장된 credential로 특정 계정 재로그인 (라우트 지연 연결·자가 복구용).
 * @returns 연결 성공 여부
 */
export async function ensureConnectionForAccount(
  adminUserId: string,
  kind: ZaloAccountKind
): Promise<boolean> {
  const key = poolKeyFor(adminUserId, kind);
  const inst = getOrCreateInstance(key, {
    ownerAdminId: adminUserId,
    isSystemBot: kind === ZaloAccountKind.SYSTEM_BOT,
    kind,
  });
  if (isConnected(inst)) return true;
  if (inst.connectPromise) {
    await inst.connectPromise;
    return isConnected(inst);
  }

  const flow = (async () => {
    const saved = await loadCredentialsForAccount(adminUserId, kind);
    if (!saved) return; // credential 없음 → QR 대기. 에러 아님.
    inst.accountId = saved.accountId;
    inst.displayName = saved.displayName;
    await doCredentialLogin(inst, saved.credentials);
  })();
  inst.connectPromise = flow;

  try {
    await flow;
    return isConnected(inst);
  } catch (err) {
    if (!isConnected(inst)) inst.status = "disconnected";
    inst.lastError = err instanceof Error ? err.message : "Credential login failed";
    return false;
  } finally {
    inst.connectPromise = null;
  }
}

/**
 * QR 로그인 시작 — QR 이미지(base64)를 반환한다 (ADR-0007 S2).
 * @param adminUserId 봇을 소유할 ADMIN userId
 * @param kind SYSTEM_BOT(테오 시스템봇 겸 통합 채팅) | ADMIN_PERSONAL(개인 채팅)
 */
export async function startQRLoginForAdmin(
  adminUserId: string,
  kind: ZaloAccountKind
): Promise<string> {
  const key = poolKeyFor(adminUserId, kind);
  const inst = getOrCreateInstance(key, {
    ownerAdminId: adminUserId,
    isSystemBot: kind === ZaloAccountKind.SYSTEM_BOT,
    kind,
  });

  // 이미 QR 진행 중이면 기존 QR 재사용
  if (inst.status === "qr_pending" && inst.qrImageBase64) {
    return inst.qrImageBase64;
  }

  inst.status = "qr_pending";
  inst.qrImageBase64 = null;
  inst.lastError = null;
  inst.ownerAdminId = adminUserId;
  inst._kind = kind;
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
        void onLoginSuccess(inst, api);
      })
      .catch((err) => {
        inst.status = "error";
        inst.lastError = err instanceof Error ? err.message : "QR login failed";
        rejectQR(err);
      });

    setTimeout(() => {
      if (!inst.qrImageBase64) {
        rejectQR(new Error("QR generation timed out"));
      }
    }, 30000);
  });
}

/**
 * 관리자 본인 계정 연결 해제 — 리스너 정지 + credential 비활성화 + 풀 제거.
 * 통합 모드: 테오는 "__system__" 인스턴스가 대상(시스템 발송도 함께 끊김 — 운영 주의).
 */
export async function disconnectForAdmin(
  adminUserId: string,
  kind: ZaloAccountKind
): Promise<void> {
  const key = poolKeyFor(adminUserId, kind);
  const pool = getPool();
  const inst = pool.get(key);
  if (!inst) return;

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

  const accountId = inst.accountId;
  const ownerAdminId = inst.ownerAdminId;

  if (accountId) {
    await setCredentialsInactive(accountId).catch((e) =>
      console.error("[ZaloPool] 자격증명 비활성화 실패:", e instanceof Error ? e.message : e)
    );
    // AuditLog — credential 절대 미기록 (D6.2)
    writeAuditLog({
      action: "DELETE",
      entity: "ZaloAccount",
      entityId: accountId,
      userId: ownerAdminId ?? undefined,
      changes: { type: { old: "CONNECTED", new: "DISCONNECTED" } },
    }).catch(() => {});
  }

  pool.delete(key);
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
  if (inst._pendingCreds && inst.ownId && inst.ownerAdminId) {
    const pendingCreds = inst._pendingCreds;
    inst._pendingCreds = null;
    const displayName = inst._scannedName ?? inst.displayName ?? undefined;
    try {
      const accountId = await saveCredentials(
        inst.ownId,
        pendingCreds,
        inst.ownerAdminId,
        inst._kind,
        displayName
      );
      inst.accountId = accountId;
      if (displayName) inst.displayName = displayName;
      // 시스템봇 신규 연결 시 소유자 캐시 갱신
      if (inst.isSystemBot) globalForPool.zaloSystemOwnerId = inst.ownerAdminId;

      // AuditLog — displayName만 (credential 절대 금지, D6.2)
      writeAuditLog({
        action: "CREATE",
        entity: "ZaloAccount",
        entityId: accountId,
        userId: inst.ownerAdminId ?? undefined,
        changes: {
          type: { new: "CONNECT" },
          kind: { new: inst._kind },
          displayName: { new: displayName ?? null },
        },
      }).catch(() => {});
    } catch (err) {
      // credential 저장 실패(주로 ZALO_CREDS_KEY 미설정) → error 상태로 명시 전환
      inst.status = "error";
      inst.lastError =
        "Zalo 자격증명 저장 실패 — ZALO_CREDS_KEY 환경변수를 확인하세요 (미설정 시 재시작 후 연결이 끊깁니다)";
      console.error(
        "[ZaloPool] credential 저장 실패:",
        err instanceof Error ? err.message : err
      );
    }
  } else if (inst._pendingCreds && (!inst.ownId || !inst.ownerAdminId)) {
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
    api.listener.on("message", (message: Message) => {
      void handleInboundEvent(inst, message);
    });
    api.listener.on("closed", (code: number) => {
      // code 3000 = DuplicateConnection — 다른 곳에서 계정 로그인됨 (D2.3, 밴 위험 신호)
      if (code === 3000) {
        inst.status = "error";
        inst.lastError = "다른 곳에서 로그인됨 (code 3000) — replica=1 확인 필요";
      } else if (inst.status === "connected") {
        inst.status = "disconnected";
        inst.lastError = `WebSocket closed (code ${code})`;
      }
    });
    api.listener.on("error", (err: unknown) => {
      inst.lastError = err instanceof Error ? err.message : "listener error";
    });
    api.listener.start({ retryOnClose: true });
  } catch (err) {
    console.error(
      "[ZaloPool] 리스너 시작 실패:",
      err instanceof Error ? err.message : err
    );
  }

  // ADR-0009 S6 — 봇 연결 직후 아바타 일괄 백필 (fire-and-forget, 비블로킹).
  // 기존 대화·내가 먼저 연 대화·발신 echo 대화는 수신 트리거가 없어 아바타가 비어 있다.
  // 이 인스턴스 소유자(ownerAdminId)의 활성 대화 중 avatarUrl 없는 것만 순차 소량 백필.
  void backfillAvatars(inst);
}

// ── S3 수신 핸들러 ────────────────────────────────────────────

/**
 * zca-js message 이벤트 → 파싱 → DB 저장 (ADR-0007 S3 — 수신 귀속 + 본인 발신 동기화).
 * - UserMessage(ThreadType.User)만 처리. 그룹 무시.
 * - isSelf 분기(selfListen:true — 본인 다른 기기 발신도 message 이벤트로 들어옴):
 *     · isSelf=false(상대 발신): INBOUND 저장 (unread+1, 전화번호 매칭).
 *     · isSelf=true(본인 발신, 앱·프로그램): OUTBOUND·CHAT 동기화 저장.
 *       앱에서 직접 보낸 메시지(프로그램 미경유)를 /messages에 반영. zaloMsgId 멱등으로
 *       프로그램(S4) 발신과의 중복만 방지 — 시스템봇 통합 모드의 SYSTEM 미러도 동일 가드.
 * - 귀속: 이 인스턴스의 ownerAdminId로 ZaloConversation 복합키 귀속 (타 관리자 누수 0).
 * - 전화번호 매칭은 시스템봇 **수신(INBOUND)**만(isSystemBot=true, D4). OUTBOUND은 매칭 안 함.
 * - 멱등·예외 안전: 1건 실패가 리스너를 죽이지 않도록 전체 try/catch.
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

    // 대화 상대 = threadId (self 메시지면 수신자 idTo, 상대 메시지면 발신자 uidFrom)
    const senderZaloUserId = userMsg.threadId || senderId;
    if (!senderZaloUserId) return;

    // 귀속 관리자 미상이면 저장 불가(타 관리자 오귀속 방지) — 발생 시 드롭하고 기록
    if (!inst.ownerAdminId) {
      console.error("[ZaloPool] 수신/발신 귀속 실패 — ownerAdminId 미상, 메시지 드롭");
      return;
    }

    const text = extractText(userMsg.data.content);
    if (!text) return; // 텍스트 없는 메시지는 S5 범위 — Phase 1 스킵

    const zaloMsgId = buildInboundKey(userMsg.data);
    const displayName = (data.dName as string | undefined) ?? null;

    // ── 본인 발신(앱 or 프로그램) → OUTBOUND 동기화 ──────────────
    if (isSelfMessage({ isSelf: userMsg.isSelf, senderId }, inst.ownId)) {
      await saveOutboundEcho({
        ownerAdminId: inst.ownerAdminId,
        senderZaloUserId,
        text,
        zaloMsgId,
        createdAt: parseZaloTs(data.ts) ?? new Date(),
        displayName,
      });
      // ADR-0009 S6 — 내가 먼저 연 대화(발신만 있는 대화)도 아바타가 채워지도록 발신 echo 후에도 lazy 갱신.
      // best-effort·비블로킹. 친구 아니면 null 폴백(avatarFetchedAt만 갱신해 재시도 억제).
      void maybeRefreshAvatar(inst, senderZaloUserId);
      return;
    }

    // ── 상대 발신 → INBOUND 저장(기존) ──────────────────────────
    const inbound = await saveInboundMessage({
      ownerAdminId: inst.ownerAdminId,
      isSystemBot: inst.isSystemBot,
      senderZaloUserId,
      text,
      zaloMsgId,
      displayName,
      senderPhone: null,
    });

    // ADR-0009 S5 — 수신 자동번역(VI/EN만). 리스너 블로킹 금지: await 없이 fire-and-forget.
    if (inbound.saved && inbound.messageId && inbound.translateMode !== "OFF") {
      void maybeTranslateInbound(inbound.messageId, text, inbound.translateMode);
    }

    // ADR-0009 S6 — 아바타 lazy 갱신(없거나 오래됐을 때만). best-effort, 비블로킹.
    void maybeRefreshAvatar(inst, senderZaloUserId);
  } catch (err) {
    console.error(
      "[ZaloPool] 수신 처리 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── S4 발송 ──────────────────────────────────────────────────

export type BotSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

async function sendVia(
  api: API | null,
  zaloUserId: string,
  text: string
): Promise<BotSendResult> {
  if (!api) return { ok: false, error: ERROR_BOT_NOT_CONNECTED };
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

/**
 * 시스템 알림 발송 (dispatchOne 전용, S4 — 시스템봇 인스턴스).
 * **시그니처 무변경** — 호출부(lib/zalo.ts dispatchOne)는 그대로.
 * 봇 미연결 시 ok:false + ERROR_BOT_NOT_CONNECTED(호출부에서 attempt 미증가 처리).
 */
export async function sendBotMessage(
  zaloUserId: string,
  text: string
): Promise<BotSendResult> {
  return sendVia(getSystemBotApi(), zaloUserId, text);
}

/**
 * 관리자 본인 계정 채팅 발송 (b14 — /api/zalo/messages). 통합 모드는 시스템봇 인스턴스 공유.
 */
export async function sendChatMessageAsAdmin(
  adminUserId: string,
  zaloUserId: string,
  text: string
): Promise<BotSendResult> {
  const api = await getApiForAdmin(adminUserId);
  return sendVia(api, zaloUserId, text);
}

// ── ADR-0009 S1: 이미지 발송 ──────────────────────────────────────

/**
 * 관리자 본인 계정으로 이미지 발송 (ADR-0009 S1 — Nike sendZaloImage 정본).
 * zca-js는 메모리 Buffer만 받는다(URL 불가): attachments[{ data, filename, metadata.totalSize }].
 * EXIF 회전 보정(sharp.rotate) — 모바일 촬영 세로 사진이 가로로 보이는 문제 방지.
 * caption(선택)은 같은 메시지 본문으로 함께 전송. 봇 미연결 시 ok:false(ERROR_BOT_NOT_CONNECTED).
 *
 * 시스템봇·텍스트 발송 함수 무변경 — 본 함수만 신규 추가.
 */
export async function sendChatImageAsAdmin(
  adminUserId: string,
  zaloUserId: string,
  buffer: Buffer,
  fileName: string,
  caption?: string
): Promise<BotSendResult> {
  const api = await getApiForAdmin(adminUserId);
  if (!api) return { ok: false, error: ERROR_BOT_NOT_CONNECTED };
  try {
    // EXIF 방향 자동 회전 — jpg/png/webp/tiff만(heic는 sharp 빌드 의존, 실패 시 원본 폴백).
    let sendBuffer = buffer;
    if (/\.(jpe?g|png|webp|tiff?)$/i.test(fileName)) {
      try {
        const sharp = (await import("sharp")).default;
        sendBuffer = await sharp(buffer).rotate().toBuffer();
      } catch {
        sendBuffer = buffer; // 회전 실패는 치명적 아님 — 원본 그대로 발송
      }
    }
    const safeName = (/\.[a-z0-9]+$/i.test(fileName) ? fileName : `${fileName}.jpg`) as
      `${string}.${string}`;
    const res = await api.sendMessage(
      {
        msg: caption ?? "",
        attachments: [
          {
            data: sendBuffer,
            filename: safeName,
            metadata: { totalSize: sendBuffer.length },
          },
        ],
      },
      zaloUserId,
      ThreadType.User
    );
    const msgId = res?.message?.msgId ?? res?.attachment?.[0]?.msgId;
    return { ok: true, messageId: msgId != null ? String(msgId) : null };
  } catch (e) {
    return {
      ok: false,
      error: `SEND_ERROR: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    };
  }
}

/**
 * 관리자 본인 계정으로 일반(비이미지) 파일 발송 (Nike sendZaloImage의 비이미지 분기 정본).
 * zca-js는 이미지와 동일한 attachments 메커니즘으로 임의 파일을 받는다(메모리 Buffer):
 *   attachments[{ data, filename, metadata.totalSize }]. 이미지가 아니므로 EXIF 회전은 하지 않는다.
 * filename은 zca-js 타입상 `${string}.${string}`(확장자 필수) — 호출부(share route)에서
 * 위험 확장자 차단·크기 상한을 검증한 안전한 이름을 넘긴다. 봇 미연결 시 ok:false.
 *
 * 시스템봇·텍스트·이미지 발송 함수 무변경 — 본 함수만 신규 추가.
 */
export async function sendChatFileAsAdmin(
  adminUserId: string,
  zaloUserId: string,
  buffer: Buffer,
  fileName: `${string}.${string}`,
  caption?: string
): Promise<BotSendResult> {
  const api = await getApiForAdmin(adminUserId);
  if (!api) return { ok: false, error: ERROR_BOT_NOT_CONNECTED };
  try {
    const res = await api.sendMessage(
      {
        msg: caption ?? "",
        attachments: [
          {
            data: buffer,
            filename: fileName,
            metadata: { totalSize: buffer.length },
          },
        ],
      },
      zaloUserId,
      ThreadType.User
    );
    const msgId = res?.message?.msgId ?? res?.attachment?.[0]?.msgId;
    return { ok: true, messageId: msgId != null ? String(msgId) : null };
  } catch (e) {
    return {
      ok: false,
      error: `SEND_ERROR: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    };
  }
}

// ── ADR-0009 S6: 아바타 조회·캐시 ─────────────────────────────────

/** 아바타 재조회 주기 — 이 기간 지난 캐시만 lazy 갱신(레이트리밋 회피). */
const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일

/**
 * 상대 Zalo 아바타 URL 조회 (ADR-0009 D8) — best-effort.
 * zca-js getAvatarUrlProfile(friendIds) → { [userId]: { avatar } }. 실패/미존재면 null.
 * 누수 0(공개 프로필 이미지). credential·전화번호 미반환.
 */
export async function fetchAvatarUrl(
  adminUserId: string,
  zaloUserId: string
): Promise<string | null> {
  try {
    const api = await getApiForAdmin(adminUserId);
    if (!api) return null;
    const res = await api.getAvatarUrlProfile(zaloUserId);
    const avatar = res?.[zaloUserId]?.avatar;
    return typeof avatar === "string" && avatar.length > 0 ? avatar : null;
  } catch (err) {
    // URL 호스트 에코 우려 없음(프로필 공개) — 상태/메시지만
    console.error(
      "[ZaloPool] 아바타 조회 실패:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * 수신 시 아바타 lazy 갱신 (ADR-0009 D8.2) — 리스너 외부 fire-and-forget 전용.
 * avatarUrl이 없거나 avatarFetchedAt이 TTL을 넘긴 대화만 1회 조회. 수신 핸들러를 블로킹하지 않는다.
 * 실패는 무시(다음 수신 때 재시도). 캐시 적중이면 zca-js 호출 0.
 */
async function maybeRefreshAvatar(
  inst: ZaloBotInstance,
  zaloUserId: string
): Promise<void> {
  try {
    if (!inst.ownerAdminId) return;
    const conv = await prisma.zaloConversation.findUnique({
      where: {
        ownerAdminId_zaloUserId: { ownerAdminId: inst.ownerAdminId, zaloUserId },
      },
      select: { id: true, avatarUrl: true, avatarFetchedAt: true },
    });
    if (!conv) return;
    const fresh =
      conv.avatarUrl &&
      conv.avatarFetchedAt &&
      Date.now() - conv.avatarFetchedAt.getTime() < AVATAR_TTL_MS;
    if (fresh) return; // 캐시 유효 — 조회 스킵

    const url = await fetchAvatarUrl(inst.ownerAdminId, zaloUserId);
    // 실패해도 fetchedAt은 갱신해 잦은 재시도를 막는다(URL은 성공 시에만 교체).
    await prisma.zaloConversation.update({
      where: { id: conv.id },
      data: {
        avatarFetchedAt: new Date(),
        ...(url ? { avatarUrl: url } : {}),
      },
    });
  } catch (err) {
    console.error(
      "[ZaloPool] 아바타 lazy 갱신 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** 봇 연결 직후 백필 1회당 최대 처리 건수 — 레이트리밋 회피(소량 배치). */
const AVATAR_BACKFILL_BATCH = 30;
/** 백필 시 조회 간 최소 간격(ms) — Zalo API 과부하·레이트리밋 회피. */
const AVATAR_BACKFILL_DELAY_MS = 400;

/**
 * 봇 연결 직후 아바타 일괄 백필 (ADR-0009 S6 D8.3) — fire-and-forget 전용.
 * 수신 트리거(maybeRefreshAvatar)는 "상대가 메시지를 보낸 대화"만 커버하므로,
 * 기존 대화·내가 먼저 연 대화·발신만 있는 대화는 avatarUrl이 영영 비어 있다.
 * 연결 직후 이 인스턴스 소유자(ownerAdminId)의 활성 대화 중 avatarUrl 없는 것만
 * 순차 소량(BATCH) 백필한다. 한 인스턴스는 그 소유자의 대화만 처리(타 관리자 0).
 *
 * 레이트리밋 회피: 순차 + 호출 간 DELAY. 실패해도 avatarFetchedAt만 갱신해 재시도 억제.
 * 한 건 실패가 전체를 죽이지 않도록 건별 try/catch.
 */
async function backfillAvatars(inst: ZaloBotInstance): Promise<void> {
  try {
    if (!inst.ownerAdminId) return;
    const ownerAdminId = inst.ownerAdminId;
    // avatarUrl이 아직 없는 대화만(이미 채워진 건 maybeRefreshAvatar의 TTL이 담당).
    // 가장 최근 대화부터 소량만 — 활성 대화 우선, 레이트리밋 회피.
    const targets = await prisma.zaloConversation.findMany({
      where: { ownerAdminId, avatarUrl: null },
      orderBy: { lastMessageAt: "desc" },
      take: AVATAR_BACKFILL_BATCH,
      select: { id: true, zaloUserId: true },
    });
    if (targets.length === 0) return;

    for (const conv of targets) {
      try {
        const url = await fetchAvatarUrl(ownerAdminId, conv.zaloUserId);
        // 실패(비친구·조회 실패)여도 fetchedAt만 갱신해 재시도를 억제(URL은 성공 시에만 교체).
        await prisma.zaloConversation.update({
          where: { id: conv.id },
          data: {
            avatarFetchedAt: new Date(),
            ...(url ? { avatarUrl: url } : {}),
          },
        });
      } catch (err) {
        console.error(
          "[ZaloPool] 아바타 백필 1건 실패:",
          err instanceof Error ? err.message : String(err)
        );
      }
      // 순차 간 짧은 지연 — Zalo API 과부하 방지.
      await new Promise((r) => setTimeout(r, AVATAR_BACKFILL_DELAY_MS));
    }
  } catch (err) {
    console.error(
      "[ZaloPool] 아바타 백필 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
