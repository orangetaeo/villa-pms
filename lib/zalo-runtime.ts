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
import { Zalo, ThreadType, Reactions, type API } from "zca-js";
import {
  LoginQRCallbackEventType,
  type LoginQRCallbackEvent,
  type Message,
  type UserMessage,
  type GroupMessage,
  type Reaction,
} from "zca-js";
import { Prisma, ZaloAccountKind } from "@prisma/client";
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
  UNKNOWN_MESSAGE_FALLBACK,
  classifyInbound,
  isSelfMessage,
  buildInboundKey,
  buildGlobalMsgId,
  parseZaloTs,
  buildCliMsgId,
  extractQuote,
  saveInboundMessage,
  saveOutboundEcho,
  maybeTranslateInbound,
  maybeTranscribeVoice,
} from "./zalo-inbound";
// S2 / ADR-0010 A4 — 신규 저장 직후 Nike webhook push(fire-and-forget). 리스너 무영향.
import { pushInboundToNike } from "./zalo-webhook";
// ADR-0032 — 아웃바운드/상태 위임. 기본(ZALO_SESSION_LOCAL 미설정=true)엔 shouldDelegate()=false로
// 아래 모든 함수가 현행 in-process 경로 그대로 실행(no-op). false일 때만 워커 /internal로 위임.
import {
  shouldDelegate,
  delegateSend,
  delegateReaction,
  delegateStatus,
} from "./zalo-worker-client";

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
  // ADR-0032 BE-6 — 세션 비보유(웹, SESSION_LOCAL=false)면 워커 /internal/status 조회(불통=disconnected).
  if (shouldDelegate()) {
    const s = await delegateStatus(adminUserId);
    return {
      connected: s.connected,
      status: s.status as ZaloStatus,
      displayName: s.displayName,
      lastConnected: s.lastConnected,
      lastError: s.lastError,
    };
  }
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
 * 관리자 본인 계정의 Zalo own id (ADR-0009 R3-2 답글 인용 uidFrom 결정용). 미연결/미상이면 null.
 * 내가 보낸(OUTBOUND) 메시지를 인용할 때 quote.uidFrom = 내 ownId가 필요하다.
 */
export async function getOwnIdForAdmin(adminUserId: string): Promise<string | null> {
  const inst = await resolveAdminInstance(adminUserId);
  return inst?.ownId ?? null;
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
    // ADR-0009 R3-4 — 리액션 수신(단건). old_reactions(대량 동기화)는 Phase 1 스킵.
    api.listener.on("reaction", (reaction: Reaction) => {
      void handleReactionEvent(inst, reaction);
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
 * - UserMessage(ThreadType.User) + GroupMessage(ThreadType.Group) 둘 다 처리 (ADR-0010 S4).
 *     · USER: 대화 식별자 = threadId(상대 Zalo id), senderUid 불필요(null), threadType USER. 기존 로직.
 *     · GROUP: 대화 식별자 = threadId(그룹 id, zaloUserId 슬롯), 발신자 = data.uidFrom → senderUid 저장,
 *       displayName = 그룹명(있으면). 전화번호 자동매칭은 스킵(다중 발신자 → User.zaloUserId 오염 방지).
 * - isSelf 분기(selfListen:true — 본인 다른 기기 발신도 message 이벤트로 들어옴):
 *     · isSelf=false(상대 발신): INBOUND 저장 (unread+1, 전화번호 매칭은 USER만).
 *     · isSelf=true(본인 발신, 앱·프로그램): OUTBOUND·CHAT 동기화 저장.
 *       앱에서 직접 보낸 메시지(프로그램 미경유)를 /messages에 반영. zaloMsgId 멱등으로
 *       프로그램(S4) 발신과의 중복만 방지 — 시스템봇 통합 모드의 SYSTEM 미러도 동일 가드.
 * - 귀속: 이 인스턴스의 ownerAdminId로 ZaloConversation 복합키 귀속 (타 관리자 누수 0).
 * - 전화번호 매칭은 시스템봇 **수신(INBOUND)**만(isSystemBot=true, D4). OUTBOUND은 매칭 안 함.
 * - 멱등·예외 안전: 1건 실패가 리스너를 죽이지 않도록 전체 try/catch.
 */
async function handleInboundEvent(inst: ZaloBotInstance, message: Message): Promise<void> {
  try {
    // USER/GROUP 둘 다 처리. 그 외(미상 타입)는 스킵.
    if (message.type !== ThreadType.User && message.type !== ThreadType.Group) return;
    const isGroupMsg = message.type === ThreadType.Group;
    // UserMessage·GroupMessage 모두 { data, threadId, isSelf } 형태가 동일하므로 공용 처리.
    const userMsg = message as UserMessage | GroupMessage;
    const data = userMsg.data as Record<string, unknown>;

    const senderId =
      (data.uidFrom as string | undefined) ??
      (data.userId as string | undefined) ??
      null;

    // 대화 상대 = threadId.
    //  - USER: 상대 Zalo id(self면 수신자 idTo, 상대면 uidFrom을 zca-js가 threadId로 정규화).
    //  - GROUP: 그룹 id(zaloUserId 슬롯). 발신자(uidFrom)는 senderUid로 별도 저장.
    const senderZaloUserId = userMsg.threadId || senderId;
    if (!senderZaloUserId) return;

    // 그룹 메시지의 발신자 식별자 — ZaloMessage.senderUid로 저장(누가 보냈는지). USER는 null.
    const senderUid = isGroupMsg ? senderId : null;
    // 저장·발송 분기용 threadType 리터럴.
    const threadType: "USER" | "GROUP" = isGroupMsg ? "GROUP" : "USER";

    // 귀속 관리자 미상이면 저장 불가(타 관리자 오귀속 방지) — 발생 시 드롭하고 기록
    if (!inst.ownerAdminId) {
      console.error("[ZaloPool] 수신/발신 귀속 실패 — ownerAdminId 미상, 메시지 드롭");
      return;
    }

    // 메시지 타입 분류(Nike parseMessageContent 이식): zca-js msgType + content →
    //   { msgType(text|photo|file|sticker|voice|contact|call|video|location|unknown), text, attachmentUrls }.
    // 과거엔 전부 "text"로 하드코딩돼 본문 없는 비텍스트가 "[알 수 없는 메시지]"로 빠졌다.
    const zaloMsgType =
      (data.msgType as string | undefined) ?? (userMsg.type as unknown as string | undefined);
    const classified = classifyInbound(userMsg.data.content, zaloMsgType);

    // [진단 로깅 — 임시, 개인정보 0] 특수타입/미상일 때만 raw zca-js 타입 문자열만 기록.
    // content 본문·전화번호 등 개인정보는 절대 로그하지 않는다(타입 문자열 ↔ 분류결과만).
    // 테오가 통화/위치/연락처를 실제 받으면 Railway 로그에서 실제 타입을 확인해 추가 보정용.
    if (
      classified.msgType === "unknown" ||
      classified.msgType === "call" ||
      classified.msgType === "location" ||
      classified.msgType === "contact" ||
      classified.msgType === "video" ||
      classified.msgType === "sticker"
    ) {
      console.log("[inbound-type]", zaloMsgType ?? "(none)", "->", classified.msgType);
      // contact/unknown은 오분류(지도/링크 공유 등) 진단을 위해 content **키 이름만** 추가 기록.
      //   값(URL·전화·이름)은 절대 로그 금지 — 키 목록만으로 필드 구조 파악(개인정보 0).
      if (classified.msgType === "contact" || classified.msgType === "unknown") {
        const c = userMsg.data.content;
        if (c && typeof c === "object") {
          const keys = Object.keys(c as Record<string, unknown>);
          let paramKeys: string[] = [];
          const pv = (c as Record<string, unknown>).params;
          try {
            const pp = typeof pv === "string" ? JSON.parse(pv) : pv;
            if (pp && typeof pp === "object") paramKeys = Object.keys(pp as Record<string, unknown>);
          } catch {
            /* params 비JSON */
          }
          console.log("[inbound-type-keys]", classified.msgType, "content:", keys.join(","), "params:", paramKeys.join(","));
        }
      }
    }

    // [voice-nourl 진단 — 임시, 개인정보 0] 음성인데 첨부 URL 0건이면 content/params **키 이름만** 기록.
    //   전달·에코 음성이 top-level URL 없이 오는 실 payload 구조 파악용(값·URL·전화·본문 절대 금지).
    //   self·inbound 양쪽 경로 공통 지점(분류 직후)에 둬서 어느 방향이든 voice+URL0이면 찍힌다.
    if (classified.msgType === "voice" && classified.attachmentUrls.length === 0) {
      const c = userMsg.data.content;
      let keys: string[] = [];
      let paramKeys: string[] = [];
      if (c && typeof c === "object") {
        keys = Object.keys(c as Record<string, unknown>);
        const pv = (c as Record<string, unknown>).params;
        try {
          const pp = typeof pv === "string" ? JSON.parse(pv) : pv;
          if (pp && typeof pp === "object") paramKeys = Object.keys(pp as Record<string, unknown>);
        } catch {
          /* params 비JSON */
        }
      }
      console.log("[voice-nourl]", "content:", keys.join(","), "params:", paramKeys.join(","));
    }

    // 본문 추출(버그 B): action/메서드명 등 메타 필드는 절대 본문으로 새지 않는다.
    //  - text: 사람이 작성한 본문(분류 결과 text) — 자동번역은 type "text"이고 본문 있을 때만.
    //  - displayText: 표시·저장용. 본문 없는 첨부/리치/미상이면 중립 폴백("[알 수 없는 메시지]").
    const text = classified.text;
    const displayText = text.trim().length > 0 ? text : UNKNOWN_MESSAGE_FALLBACK;

    const zaloMsgId = buildInboundKey(userMsg.data);
    // 답글 인용 점프 앵커 변환용 — 메시지별 globalMsgId 보관(quote.globalMsgId와 동일 체계). 없으면 null.
    // zca-js TMessage 타입엔 globalMsgId 선언이 없으나 런타임엔 실려 온다(Nike도 msg.globalMsgId 사용) → 캐스트.
    const globalMsgId = buildGlobalMsgId(userMsg.data as { globalMsgId?: unknown });
    // USER: data.dName = 상대 표시명 → 대화 displayName 보강에 사용.
    // GROUP: data.dName = "발신자"명(그룹명 아님)이라 대화명으로 쓰면 오표기 → null로 두고
    //        그룹명은 maybeRefreshGroupMembers(getGroupInfo)가 채운다. 발신자명은 groupMembers 스냅샷에서 매핑.
    const displayName = isGroupMsg ? null : (data.dName as string | undefined) ?? null;
    // GROUP: data.dName = 발신자명 → groupMembers 점진 누적용(saveInboundMessage가 senderUid와 병합).
    //        getGroupInfo가 멤버를 안 줘도 발언자 이름은 항상 해석됨(R14 원문 폴백 해소). 1:1은 null.
    const senderName = isGroupMsg ? ((data.dName as string | undefined) ?? null) : null;
    // ADR-0009 R3-1 — cliMsgId(리액션·답글 대상)·인용 스냅샷 파싱. 수신·발신 echo 양쪽에 저장.
    const cliMsgId = buildCliMsgId(userMsg.data);
    const quote = extractQuote(userMsg.data);

    // ── 본인 발신(앱 or 프로그램) → OUTBOUND 동기화 ──────────────
    if (isSelfMessage({ isSelf: userMsg.isSelf, senderId }, inst.ownId)) {
      // 순수 비텍스트 에코 스킵 판정. 단, 미디어 타입(음성/사진/파일/스티커/영상/위치)은
      //   URL 추출 실패(첨부 0)여도 미러한다 — FE가 msgType 타입 카드로 라벨을 렌더하므로
      //   흔적은 남기고(재생/열기 링크만 URL 없을 때 미표시), 전달된 음성 에코가 top-level URL
      //   부재로 조용히 드롭되던 버그를 차단한다. call·unknown·빈 text만 미러 불필요 → 스킵
      //   (프로그램 S4/b14 발송이 이미 OUTBOUND를 정확히 기록하므로 중복·잡음 방지).
      const isMediaEcho =
        classified.msgType === "voice" ||
        classified.msgType === "photo" ||
        classified.msgType === "file" ||
        classified.msgType === "sticker" ||
        classified.msgType === "video" ||
        classified.msgType === "location";
      if (!text && classified.attachmentUrls.length === 0 && !isMediaEcho) {
        void maybeRefreshAvatar(inst, senderZaloUserId);
        return;
      }
      const outbound = await saveOutboundEcho({
        ownerAdminId: inst.ownerAdminId,
        senderZaloUserId,
        text,
        msgType: classified.msgType,
        attachmentUrls: classified.attachmentUrls,
        zaloMsgId,
        globalMsgId,
        createdAt: parseZaloTs(data.ts) ?? new Date(),
        displayName,
        cliMsgId,
        quote,
        // ADR-0010 S4 — 그룹 echo도 threadType·senderUid(내 발신)로 미러.
        threadType,
        senderUid,
      });
      // 그룹 멤버 스냅샷 best-effort 갱신(R14 대비) — 리스너 블로킹 금지(fire-and-forget).
      if (isGroupMsg) void maybeRefreshGroupMembers(inst, senderZaloUserId);
      // S2 / ADR-0010 A4 — 신규 저장(saved===true)일 때만 Nike webhook push(fire-and-forget, await 없음).
      // 중복 멱등(saved:false)이면 미발송. saveOutboundEcho는 messageId 미반환 → zaloMsgId로 식별.
      if (outbound.saved && zaloMsgId) {
        pushInboundToNike({
          ref: { zaloMsgId },
          threadId: senderZaloUserId,
          ownerAdminId: inst.ownerAdminId,
        });
      }
      // S5 A6-3 확장 — 앱에서 보낸(또는 전달한) 발신 에코 음성도 STT(받아쓰기→ko)로 자막·번역.
      //   수신 voice와 동일 패턴(아래 INBOUND 분기 참고). 리스너 블로킹 금지: await 없이 void.
      //   신규 저장(saved)·messageId 있고·voice·URL 있고·모드 OFF 아님일 때만. URL 없으면 스킵
      //   (maybeTranscribeVoice 내부도 !voiceUrl 리턴이나 명시 가드로 불필요 호출 자체를 막는다).
      if (
        outbound.saved &&
        outbound.messageId &&
        classified.msgType === "voice" &&
        classified.attachmentUrls[0] &&
        outbound.translateMode !== "OFF"
      ) {
        void maybeTranscribeVoice(
          outbound.messageId,
          classified.attachmentUrls[0],
          outbound.translateMode
        );
      }
      // ADR-0009 S6 — 내가 먼저 연 대화(발신만 있는 대화)도 아바타가 채워지도록 발신 echo 후에도 lazy 갱신.
      // best-effort·비블로킹. 친구 아니면 null 폴백(avatarFetchedAt만 갱신해 재시도 억제).
      void maybeRefreshAvatar(inst, senderZaloUserId);
      return;
    }

    // ── 상대 발신 → INBOUND 저장(기존) ──────────────────────────
    // 첨부/리치 메시지(본문 없음)도 폴백 문구로 저장 — 수신 흔적을 잃지 않는다(버그 B).
    // 저장 text: 타입별 분기.
    //  - text/photo/file/contact/location: 본문(text)이 있으면 그대로(파일명·연락처명·캡션 포함).
    //  - 본문이 비는 비텍스트(sticker/voice/call/video/unknown): 폴백 문구 대신 빈 문자열로 저장하고
    //    FE가 msgType으로 라벨·아이콘 렌더(스티커 이미지·"음성"·"통화" 등). 단, text 타입인데 본문이 비면 폴백.
    const storeText =
      text.trim().length > 0
        ? text
        : classified.msgType === "text" || classified.msgType === "unknown"
          ? UNKNOWN_MESSAGE_FALLBACK
          : "";

    const inbound = await saveInboundMessage({
      ownerAdminId: inst.ownerAdminId,
      isSystemBot: inst.isSystemBot,
      senderZaloUserId,
      text: storeText,
      msgType: classified.msgType,
      attachmentUrls: classified.attachmentUrls,
      zaloMsgId,
      globalMsgId,
      displayName,
      // 전화번호 매칭은 사람이 쓴 실제 본문만 대상 — 폴백·라벨로 오매칭 방지.
      senderPhone: null,
      cliMsgId,
      quote,
      // ADR-0010 S4 — 그룹 수신: threadType GROUP + senderUid(발신자) + senderName(발신자명, groupMembers 점진 누적).
      //   전화매칭은 saveInboundMessage가 GROUP이면 스킵.
      threadType,
      senderUid,
      senderName,
    });

    // ADR-0010 S4 — 그룹 멤버 스냅샷 best-effort 갱신(R14 대비, 발신자명·아바타 매핑 원천).
    //   리스너 블로킹 금지(fire-and-forget). 실패/미지원이면 조용히 건너뜀(senderUid 폴백으로 충분).
    if (isGroupMsg && inbound.saved) {
      void maybeRefreshGroupMembers(inst, senderZaloUserId);
    }

    // S2 / ADR-0010 A4 — 신규 저장(saved===true)일 때만 Nike webhook push(fire-and-forget, await 없음).
    // 중복 멱등(saved:false)이면 미발송. messageId로 정본 1건을 식별해 push.
    if (inbound.saved && inbound.messageId) {
      pushInboundToNike({
        ref: { id: inbound.messageId },
        threadId: senderZaloUserId,
        ownerAdminId: inst.ownerAdminId,
      });
    }

    // ADR-0009 S5 — 수신 자동번역(VI/EN만). 리스너 블로킹 금지: await 없이 fire-and-forget.
    // 자동번역은 msgType "text"이고 실제 본문이 있을 때만(스티커·음성·통화·연락처·위치 미번역).
    if (
      classified.msgType === "text" &&
      text &&
      inbound.saved &&
      inbound.messageId &&
      inbound.translateMode !== "OFF"
    ) {
      void maybeTranslateInbound(inbound.messageId, text, inbound.translateMode);
    }

    // 사진 캡션 자동번역 — 캡션은 사람이 쓴 본문(텍스트와 동일 취급). 이미지 OCR 번역(translatedText,
    // on-demand 유지)과 별개 필드 captionTranslated에 저장(같은 사진에 둘 다 필요한 사례 — 2026-07-03).
    if (
      classified.msgType === "photo" &&
      text.trim().length > 0 &&
      inbound.saved &&
      inbound.messageId &&
      inbound.translateMode !== "OFF"
    ) {
      void maybeTranslateInbound(inbound.messageId, text, inbound.translateMode, "captionTranslated");
    }

    // S5 A6-3 — 수신 음성 STT(받아쓰기→ko 번역→translatedText). 리스너 블로킹 금지: await 없이 void.
    // INBOUND voice만(본인 발신 echo는 위 분기에서 이미 return). OFF 모드는 헬퍼 내부에서 스킵.
    if (
      classified.msgType === "voice" &&
      inbound.saved &&
      inbound.messageId &&
      inbound.translateMode !== "OFF"
    ) {
      void maybeTranscribeVoice(inbound.messageId, classified.attachmentUrls[0], inbound.translateMode);
    }

    // 수신 사진 OCR 번역 — **자동 비활성화(사용자 요청 2026-06-23)**.
    // 사진은 자동 번역하지 않고, 운영자가 채팅 버블의 "번역" 버튼을 누를 때만 on-demand로 번역한다
    // (POST /api/zalo/messages/[id]/translate-photo). Gemini 호출량·오번역 노이즈 절감.
    // (텍스트·음성 STT 자동번역은 기존 유지 — 사진만 on-demand로 전환.)

    // ADR-0009 S6 — 아바타 lazy 갱신(없거나 오래됐을 때만). best-effort, 비블로킹.
    void maybeRefreshAvatar(inst, senderZaloUserId);
  } catch (err) {
    console.error(
      "[ZaloPool] 수신 처리 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── ADR-0009 R3-4: 리액션 수신 ────────────────────────────────

/** zca-js Reactions enum 값(이모티콘 코드) → 우리 키(enum 이름, 예 "HEART"). 역매핑 캐시.
 *  Reactions가 (테스트 부분 모킹 등으로) 없으면 빈 맵 — 미상 아이콘은 원본 값 그대로 보존. */
const REACTION_VALUE_TO_KEY: Record<string, string> = Reactions
  ? Object.fromEntries(Object.entries(Reactions).map(([key, value]) => [value as string, key]))
  : {};

/**
 * zca-js rIcon(Reactions 값) → DB 저장 키(enum 이름). 미상이면 원본 값 그대로(표시 못 해도 카운트 보존).
 * 빈 문자열(Reactions.NONE = "")은 리액션 제거 신호 — 키 변환 안 함(호출부에서 rType=0으로 판정).
 */
function reactionIconToKey(rIcon: string): string {
  return REACTION_VALUE_TO_KEY[rIcon] ?? rIcon;
}

/**
 * 리액션 집계 Json 갱신 (불변 — 새 객체 반환). 아이콘 키별 카운트.
 * add=true면 +1, false(제거)면 -1(0 이하면 키 삭제). 빈 객체는 null로 정규화(저장 단순화).
 */
export function applyReaction(
  current: unknown,
  iconKey: string,
  add: boolean
): Record<string, number> | null {
  const base: Record<string, number> =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, number>) }
      : {};
  const prev = typeof base[iconKey] === "number" ? base[iconKey] : 0;
  const next = add ? prev + 1 : prev - 1;
  if (next > 0) base[iconKey] = next;
  else delete base[iconKey];
  return Object.keys(base).length > 0 ? base : null;
}

/**
 * 리액션 수신 이벤트 처리 (ADR-0009 R3-4) — 리스너 외부 fire-and-forget.
 *  - reaction.data.content.rMsg[].gMsgID = 대상 메시지의 Zalo 서버 msgId.
 *  - rIcon = Reactions 값, rType=0이면 제거(언리액션).
 *  - 대상 ZaloMessage를 zaloMsgId로 조회하되 **이 인스턴스 소유자(ownerAdminId) 대화 스코프**로 한정
 *    (타 관리자 대화 메시지 오갱신 차단 — ADR-0007 격리).
 *  - reactions Json을 아이콘별 카운트로 갱신. old_reactions(대량)는 스킵.
 * 한 건 실패가 리스너를 죽이지 않도록 전체 try/catch.
 */
async function handleReactionEvent(inst: ZaloBotInstance, reaction: Reaction): Promise<void> {
  try {
    if (!inst.ownerAdminId) return;
    // 내 계정이 보낸 리액션 echo는 발송 라우트(REACT)에서 이미 낙관적 +1 반영됨.
    // 여기서 또 가산하면 1회 클릭이 2로 표기되는 중복 카운트 발생 → self echo는 스킵(R3-4 멱등).
    if (reaction.isSelf) return;
    const data = reaction.data as unknown as {
      content?: {
        rMsg?: { gMsgID?: string | number; cMsgID?: string | number }[];
        rIcon?: string;
        rType?: number;
      };
    };
    const content = data.content;
    if (!content?.rMsg?.length || content.rIcon == null) return;

    const isRemove = content.rType === 0;
    const iconKey = reactionIconToKey(content.rIcon);
    // 제거 신호인데 아이콘이 비면(NONE) 어떤 아이콘을 빼야 할지 모름 — 스킵(Phase 1 보수적).
    if (isRemove && (!iconKey || content.rIcon === "")) return;

    for (const rMsg of content.rMsg) {
      const targetMsgId =
        rMsg?.gMsgID != null && rMsg.gMsgID !== "" ? String(rMsg.gMsgID) : null;
      if (!targetMsgId) continue;

      // 대상 메시지 — zaloMsgId 멱등 키로 조회 + 이 관리자 대화 스코프 가드(타 관리자 누수 0).
      const msg = await prisma.zaloMessage.findFirst({
        where: {
          zaloMsgId: targetMsgId,
          conversation: { ownerAdminId: inst.ownerAdminId },
        },
        select: { id: true, reactions: true },
      });
      if (!msg) continue;

      const updated = applyReaction(msg.reactions, iconKey, !isRemove);
      await prisma.zaloMessage.update({
        where: { id: msg.id },
        data: { reactions: updated ?? Prisma.JsonNull },
      });
    }
  } catch (err) {
    console.error(
      "[ZaloPool] 리액션 수신 처리 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── S4 발송 ──────────────────────────────────────────────────

export type BotSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

/**
 * Zalo @멘션 1건 — 본문(text) 내 "@이름" 토큰의 위치·길이·대상 uid.
 * pos=본문 문자 오프셋, len="@이름" 길이, uid=멘션 대상 Zalo id(@all=특수값 "-1").
 * 본문은 멘션 토큰을 포함한 상태로 그대로 전송하고, 이 배열로 zca-js가 실제 멘션을 건다.
 */
export type ZaloMention = { pos: number; uid: string; len: number };

/**
 * 봇 파일 첨부 1건 — Buffer + 확장자 포함 파일명 + 총 바이트.
 * zca-js AttachmentSource(object 형태)로 매핑되어 sendMessage가 업로드한다.
 */
export interface BotAttachment {
  data: Buffer;
  filename: string; // 확장자 포함 (예: quyet-toan-2026-07.pdf)
  totalSize: number;
}

type ZaloAttachmentObject = {
  data: Buffer;
  filename: string;
  metadata: { totalSize: number };
};
type ZaloSendPayload =
  | string
  | { msg: string; mentions?: ZaloMention[]; attachments?: ZaloAttachmentObject[] };

/**
 * 발송 payload 구성 (순수, 테스트 대상).
 * 멘션·첨부가 모두 없으면 plain string(기존 동작 불변). 하나라도 있으면 MessageContent.
 */
export function buildSendPayload(
  text: string,
  mentions?: ZaloMention[],
  attachments?: BotAttachment[]
): ZaloSendPayload {
  const hasMentions = !!mentions && mentions.length > 0;
  const hasAttachments = !!attachments && attachments.length > 0;
  if (!hasMentions && !hasAttachments) return text;
  return {
    msg: text,
    ...(hasMentions ? { mentions } : {}),
    ...(hasAttachments
      ? {
          attachments: attachments!.map((a) => ({
            data: a.data,
            filename: a.filename,
            metadata: { totalSize: a.totalSize },
          })),
        }
      : {}),
  };
}

async function sendVia(
  api: API | null,
  zaloUserId: string,
  text: string,
  // ADR-0010 S4 — 그룹 발송 지원. 기본 USER(기존 호출 동작 불변). GROUP이면 zaloUserId=그룹 id.
  threadType: ThreadType = ThreadType.User,
  // 그룹 @멘션 — 있으면 MessageContent {msg, mentions}로 전송(zca-js 실제 멘션). 없으면 plain string(불변).
  mentions?: ZaloMention[],
  // 파일 첨부(선택) — 있으면 MessageContent.attachments로 전송(정산서 PDF 등).
  attachments?: BotAttachment[]
): Promise<BotSendResult> {
  if (!api) return { ok: false, error: ERROR_BOT_NOT_CONNECTED };
  try {
    const payload = buildSendPayload(text, mentions, attachments) as unknown as Parameters<
      API["sendMessage"]
    >[0];
    const res = await api.sendMessage(payload, zaloUserId, threadType);
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
  text: string,
  // ADR-0040 그룹 발송 — 기본 USER(기존 호출 시그니처·동작 불변). GROUP이면 zaloUserId=그룹 thread id.
  threadType: ThreadType = ThreadType.User
): Promise<BotSendResult> {
  // ADR-0032 BE-3 — 세션 비보유 웹이면 워커 위임(기본 미설정=false → 현행 in-process 발송).
  if (shouldDelegate()) return delegateSend({ fn: "sendBotMessage", zaloUserId, text, threadType });
  return sendVia(getSystemBotApi(), zaloUserId, text, threadType);
}

/**
 * 시스템 알림 그룹방 발송 (ADR-0040) — 시스템봇 인스턴스로 ThreadType.Group 전송.
 * groupThreadId = ZaloConversation(threadType GROUP)의 zaloUserId 슬롯(그룹 id).
 * 봇 미연결 시 ERROR_BOT_NOT_CONNECTED(호출부에서 attempt 미증가 재시도).
 */
export async function sendBotGroupMessage(
  groupThreadId: string,
  text: string
): Promise<BotSendResult> {
  return sendBotMessage(groupThreadId, text, ThreadType.Group);
}

/**
 * 시스템 알림 + 파일 첨부 발송 (정산서 PDF 등). 시스템봇 인스턴스.
 * 첨부가 비면 sendBotMessage와 동일(plain text). 봇 미연결 시 ERROR_BOT_NOT_CONNECTED.
 */
export async function sendBotMessageWithAttachments(
  zaloUserId: string,
  text: string,
  attachments: BotAttachment[]
): Promise<BotSendResult> {
  if (shouldDelegate())
    return delegateSend({
      fn: "sendBotMessageWithAttachments",
      zaloUserId,
      text,
      attachments: attachments.map((a) => ({
        dataBase64: a.data.toString("base64"),
        filename: a.filename,
        totalSize: a.totalSize,
      })),
    });
  return sendVia(getSystemBotApi(), zaloUserId, text, ThreadType.User, undefined, attachments);
}

/**
 * 관리자 본인 계정 채팅 발송 (b14 — /api/zalo/messages). 통합 모드는 시스템봇 인스턴스 공유.
 */
export async function sendChatMessageAsAdmin(
  adminUserId: string,
  zaloUserId: string,
  text: string,
  // ADR-0010 S4 — 그룹 발송. 기본 USER(기존 호출 무영향). GROUP이면 zaloUserId=그룹 id.
  threadType: ThreadType = ThreadType.User,
  // 그룹 @멘션(선택) — sendVia가 {msg,mentions}로 전송.
  mentions?: ZaloMention[]
): Promise<BotSendResult> {
  if (shouldDelegate())
    return delegateSend({
      fn: "sendChatMessageAsAdmin",
      adminUserId,
      zaloUserId,
      text,
      threadType,
      mentions,
    });
  const api = await getApiForAdmin(adminUserId);
  return sendVia(api, zaloUserId, text, threadType, mentions);
}

/**
 * 메시지 전달(forward) — 관리자 본인 계정으로 원본 본문 텍스트를 다른 스레드에 전달 (S5 A6-1).
 * zca-js api.forwardMessage({ message, reference? }, [targetThreadId], ThreadType.User).
 *   - **텍스트 content 전달 전용**: payload.message(전달할 본문)가 비면 zca-js가 throw.
 *     첨부(이미지/파일/음성)는 forwardMessage가 직접 옮기지 못한다(범위 밖).
 *   - reference(선택): 원본 id·ts·logSrcType·fwLvl — "전달됨" 데코용. 미보유여도 동작.
 *   - 반환 { success[], fail[] } → BotSendResult 정규화(success[0].msgId→messageId, fail→ok:false).
 * 봇 미연결 시 ok:false(ERROR_BOT_NOT_CONNECTED). 기존 발송 함수·시그니처 무변경 — 본 함수만 신규.
 */
export async function sendChatForwardAsAdmin(
  adminUserId: string,
  targetThreadId: string,
  message: string,
  reference?: { id: string; ts: number; logSrcType: number; fwLvl: number },
  // ADR-0010 S4 — 그룹 전달. 기본 USER(기존 호출 무영향).
  threadType: ThreadType = ThreadType.User
): Promise<BotSendResult> {
  // 빈 본문 방어 — zca-js가 throw하기 전에 명확한 에러로 반환(첨부 forward는 범위 밖).
  if (!message || message.trim().length === 0) {
    return { ok: false, error: "FORWARD_EMPTY_MESSAGE" };
  }
  if (shouldDelegate())
    return delegateSend({
      fn: "sendChatForwardAsAdmin",
      adminUserId,
      targetThreadId,
      message,
      reference,
      threadType,
    });
  try {
    const api = await getApiForAdmin(adminUserId);
    if (!api) return { ok: false, error: ERROR_BOT_NOT_CONNECTED };
    const res = await api.forwardMessage(
      { message, ...(reference ? { reference } : {}) },
      [targetThreadId],
      threadType
    );
    const fail = res?.fail?.[0];
    if (fail) {
      return {
        ok: false,
        error: `FORWARD_FAILED: ${fail.error_code ?? "unknown"}`.slice(0, 200),
      };
    }
    const msgId = res?.success?.[0]?.msgId;
    return { ok: true, messageId: msgId != null ? String(msgId) : null };
  } catch (e) {
    return {
      ok: false,
      error: `FORWARD_ERROR: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    };
  }
}

// ── ADR-0009 R3-2/R3-3: 답글(인용)·리액션 발송 ────────────────────

/** 답글 발송에 필요한 원본 메시지 식별자·스냅샷 (ZaloMessage에서 읽어 전달). */
export interface QuoteSource {
  /** 원본 Zalo 서버 msgId (ZaloMessage.zaloMsgId) */
  zaloMsgId: string;
  /** 원본 cliMsgId (ZaloMessage.cliMsgId) — 없으면 답글 불가(호출부에서 거부) */
  cliMsgId: string;
  /** 원본 본문(인용에 실어 보냄). 없으면 빈 문자열 */
  content: string;
  /** 원본 발신자 Zalo id (uidFrom). 상대 발신이면 zaloUserId, 내 발신이면 내 ownId */
  uidFrom: string;
}

/**
 * 관리자 본인 계정으로 **답글(인용) 발송** (ADR-0009 R3-2).
 * zca-js sendMessage({ msg, quote: SendMessageQuote }) — 원본의 msgId·cliMsgId·content 등을 실어 보낸다.
 * SendMessageQuote 필수 필드: content·msgType·propertyExt·uidFrom·msgId·cliMsgId·ts·ttl.
 *   실측 가능한 값만 채우고(원본 ZaloMessage에서 read), 미보유 필드는 zca-js 허용 기본(빈/0)으로.
 *   → zca-js 버전별 quote 필드 요구가 다를 수 있어 실동작은 테오 봇 세션 실측 필요(R3-7 리스크 ⑬).
 * 봇 미연결 시 ok:false(ERROR_BOT_NOT_CONNECTED). 시스템봇·기존 발송 함수 무변경.
 */
export async function sendChatReplyAsAdmin(
  adminUserId: string,
  zaloUserId: string,
  text: string,
  quoteSource: QuoteSource,
  // ADR-0010 S4 — 그룹 답글. 기본 USER(기존 호출 무영향).
  threadType: ThreadType = ThreadType.User,
  // 그룹 @멘션(선택) — 답글 본문에 멘션 포함 시.
  mentions?: ZaloMention[]
): Promise<BotSendResult> {
  if (shouldDelegate())
    return delegateSend({
      fn: "sendChatReplyAsAdmin",
      adminUserId,
      zaloUserId,
      text,
      quoteSource,
      threadType,
      mentions,
    });
  try {
    const api = await getApiForAdmin(adminUserId);
    if (!api) return { ok: false, error: ERROR_BOT_NOT_CONNECTED };
    // SendMessageQuote — zca-js 타입(TMessage 부분집합). 보유 식별자만 채우고 나머지는 안전 기본.
    // 타입 단언(MessageContent.quote): 우리가 보유한 필드만 신뢰, 미보유는 빈/0(실동작 실측 — R3-7 ⑬).
    const message = {
      msg: text,
      quote: {
        content: quoteSource.content,
        msgType: "webchat",
        propertyExt: undefined,
        uidFrom: quoteSource.uidFrom,
        msgId: quoteSource.zaloMsgId,
        cliMsgId: quoteSource.cliMsgId,
        ts: String(Date.now()),
        ttl: 0,
      },
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
    } as unknown as Parameters<API["sendMessage"]>[0];
    const res = await api.sendMessage(message, zaloUserId, threadType);
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
 * 발송 가능한 리액션 아이콘 키 목록(zca-js Reactions enum 이름, 예 "HEART").
 * 라우트 검증·FE 노출 세트의 단일 진실원 — zca-js Reactions 직접 import를 라우트에서 피하기 위해 재노출.
 */
export const REACTION_KEYS = (Reactions ? Object.keys(Reactions) : ["HEART"]) as [
  string,
  ...string[],
];

export type ReactionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * 관리자 본인 계정으로 **리액션 발송** (ADR-0009 R3-3) — addReaction(icon, dest).
 * dest = { data: { msgId, cliMsgId }, threadId, type } — msgId·cliMsgId 둘 다 필수.
 *   cliMsgId 없는 과거 메시지는 호출부(라우트)에서 거부 — 여기까지 오면 둘 다 보유 전제.
 * iconKey는 우리 enum 키(예 "HEART") — Reactions[iconKey]로 zca-js 값 매핑. 미상이면 ok:false.
 * 봇 미연결 시 ok:false. 시스템봇·발송 함수 무변경.
 */
export async function addReactionAsAdmin(
  adminUserId: string,
  zaloUserId: string,
  target: { zaloMsgId: string; cliMsgId: string },
  iconKey: string,
  // ADR-0010 S4 — 그룹 리액션. 기본 USER(기존 호출 무영향).
  threadType: ThreadType = ThreadType.User
): Promise<ReactionResult> {
  if (shouldDelegate())
    return delegateReaction({
      fn: "addReactionAsAdmin",
      adminUserId,
      zaloUserId,
      target,
      iconKey,
      threadType,
    });
  try {
    const api = await getApiForAdmin(adminUserId);
    if (!api) return { ok: false, error: ERROR_BOT_NOT_CONNECTED };
    const icon = (Reactions as Record<string, string>)[iconKey];
    if (icon == null) return { ok: false, error: `UNKNOWN_REACTION: ${iconKey}`.slice(0, 100) };
    await api.addReaction(icon as Reactions, {
      data: { msgId: target.zaloMsgId, cliMsgId: target.cliMsgId },
      threadId: zaloUserId,
      type: threadType,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `REACT_ERROR: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    };
  }
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
  caption?: string,
  // ADR-0010 S4 — 그룹 이미지 발송. 기본 USER(기존 호출 무영향).
  threadType: ThreadType = ThreadType.User
): Promise<BotSendResult> {
  if (shouldDelegate())
    return delegateSend({
      fn: "sendChatImageAsAdmin",
      adminUserId,
      zaloUserId,
      imageBase64: buffer.toString("base64"),
      fileName,
      caption,
      threadType,
    });
  try {
    const api = await getApiForAdmin(adminUserId);
    if (!api) return { ok: false, error: ERROR_BOT_NOT_CONNECTED };
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
      threadType
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
  caption?: string,
  // ADR-0010 S4 — 그룹 파일 발송. 기본 USER(기존 호출 무영향).
  threadType: ThreadType = ThreadType.User
): Promise<BotSendResult> {
  if (shouldDelegate())
    return delegateSend({
      fn: "sendChatFileAsAdmin",
      adminUserId,
      zaloUserId,
      fileBase64: buffer.toString("base64"),
      fileName,
      caption,
      threadType,
    });
  try {
    const api = await getApiForAdmin(adminUserId);
    if (!api) return { ok: false, error: ERROR_BOT_NOT_CONNECTED };
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
      threadType
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

// ── ADR-0010 S4: 그룹 멤버 스냅샷 ─────────────────────────────────

/**
 * 그룹 정보·멤버 스냅샷 lazy 갱신 (ADR-0010 D2 / S4) — 리스너 외부 fire-and-forget 전용.
 * zca-js api.getGroupInfo(groupId) → gridInfoMap[groupId].{ name, currentMems[] }.
 *  - groupMembers = [{ zaloId, name, avatarUrl }] (공개 프로필만 — credential·금액·마진 0, 누수 무관).
 *  - 그룹명(name)은 대화 displayName으로 보강(없을 때만 — 사용자 지정 nickname은 건드리지 않음).
 *  - 미지원·실패(메서드 없음/네트워크/비멤버)면 조용히 스킵 — senderUid 원문 폴백으로 충분(R14).
 *    표시는 FE가 처리(스냅샷에 없는 senderUid는 원문/이니셜 폴백).
 *
 * 과호출 방지: ZaloConversation에 멤버 전용 fetch 타임스탬프 컬럼이 없으므로(스키마 동결),
 *   **멤버 스냅샷이 아직 비어 있을 때만** 1회 조회한다(부트스트랩). 멤버 변동 추종(증감 반영)은
 *   별도 갱신 경로(FE 수동 새로고침/그룹 이벤트)에서 처리하며 여기서는 다루지 않는다(레이트리밋 우선).
 */
async function maybeRefreshGroupMembers(
  inst: ZaloBotInstance,
  groupId: string
): Promise<void> {
  try {
    if (!inst.ownerAdminId) return;
    const api = inst.api;
    // 미연결이면 조용히 스킵(senderUid 폴백). getGroupInfo는 zca-js API 표준 메서드.
    if (!api) return;

    const conv = await prisma.zaloConversation.findUnique({
      where: {
        ownerAdminId_zaloUserId: { ownerAdminId: inst.ownerAdminId, zaloUserId: groupId },
      },
      select: { id: true, displayName: true, groupMembers: true },
    });
    if (!conv) return;
    // 멤버 스냅샷이 이미 있으면 스킵(과호출 방지 — 부트스트랩 1회만).
    const hasMembers =
      Array.isArray(conv.groupMembers) && (conv.groupMembers as unknown[]).length > 0;
    if (hasMembers) return;

    const res = await api.getGroupInfo(groupId);
    const info = res?.gridInfoMap?.[groupId];
    if (!info) return;

    // 멤버 스냅샷 — 공개 프로필(zaloId·이름·아바타)만. 누수 무관.
    // 1순위: getGroupInfo.currentMems(프로필 동봉). 단 실관측상 비어 오는 그룹이 있음(테스트 그룹 BBBBB 등).
    let members = Array.isArray(info.currentMems)
      ? info.currentMems.map((m) => ({
          zaloId: m.id,
          name: m.dName || m.zaloName || "",
          avatarUrl: m.avatar || null,
        }))
      : [];
    // 2순위(폴백): currentMems가 비면 memberIds(전체 멤버 id)로 getGroupMembersInfo 프로필 조회.
    //   getGroupInfo는 멤버 id 목록만 주고 프로필은 별도 API로 받아야 하는 그룹이 있다(R14 해소).
    //   안전 상한 200(대형 그룹 페이로드·레이트리밋 보호). 실패는 그룹명만 저장하고 스킵(폴백 유지).
    if (members.length === 0 && Array.isArray(info.memberIds) && info.memberIds.length > 0) {
      try {
        const ids = info.memberIds.slice(0, 200);
        const mres = await api.getGroupMembersInfo(ids);
        const profiles = mres?.profiles ?? {};
        members = Object.values(profiles).map((pf) => ({
          zaloId: pf.id,
          name: pf.displayName || pf.zaloName || "",
          avatarUrl: pf.avatar || null,
        }));
      } catch {
        /* 멤버 프로필 조회 실패 — 그룹명만 저장, 멤버는 다음 메시지에 재시도(폴백 senderUid 유지) */
      }
    }
    const groupName =
      typeof info.name === "string" && info.name.trim().length > 0 ? info.name : null;

    await prisma.zaloConversation.update({
      where: { id: conv.id },
      data: {
        groupMembers: members as Prisma.InputJsonValue,
        // 그룹명은 displayName이 비어 있을 때만 보강(수동 지정 보존).
        ...(groupName && !conv.displayName ? { displayName: groupName } : {}),
      },
    });
  } catch (err) {
    // 미지원·실패는 치명적 아님 — senderUid 폴백으로 충분. 상태/메시지만 기록(credential·본문 0).
    console.error(
      "[ZaloPool] 그룹 멤버 스냅샷 갱신 실패(스킵):",
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
