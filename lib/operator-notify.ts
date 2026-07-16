// lib/operator-notify.ts — 운영자(테오) Zalo 알림 단일 진입점 (ADR-0040)
//
// 배경: 운영자 대상 업무 알림이 그동안 zaloUserId 연결된 활성 운영자 수만큼 개별 1:1 DM으로
//   fan-out 됐다. 테오가 Zalo 그룹방("villa go 주문 알림방")을 개설 — 운영자 알림을 그룹방 1건으로
//   모아 받고자 함. 이 모듈이 그 라우팅 결정의 단일 지점이다.
//
// 규칙(3중 게이트 — 하나라도 불충족 시 기존 개별 DM fan-out 폴백, 회귀 0):
//   ① AppSetting ZALO_ADMIN_NOTIFY_GROUP_ID 값 존재
//   ② type ∈ GROUP_ROUTED_TYPES (운영자 대상 정보성 알림만 — 화이트리스트)
//   ③ 시스템봇 소유자(getSystemBotOwnerId) 비-null
//   → 셋 다 충족: Notification 1행(userId=시스템봇 소유자, groupThreadId=설정값)
//   → 하나라도 불충족: findNotifiableOperators fan-out 개별 DM (기존 동작 보존)
//
// ★ 누수 0: payload는 각 호출부가 화이트리스트로 구성(판매가·마진 미포함) — 이 모듈은 배선만.
//   그룹 멤버십 전제(멤버=운영자만, 관리 책임=테오). 원가 열람이 정당한 운영자 그룹이므로
//   RATE_CHANGED_DURING_PROPOSAL 같은 원가 표기 알림도 라우팅 대상에 포함(ADR-0040 §4).
import { NotificationType, type Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueNotification } from "@/lib/zalo";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** AppSetting 키 — 운영자 알림 그룹 thread id. 값이 있으면 그룹 라우팅 활성. */
export const ZALO_ADMIN_NOTIFY_GROUP_ID_KEY = "ZALO_ADMIN_NOTIFY_GROUP_ID";

/**
 * AppSetting 키 — 운영자 알림 일시정지 킬스위치.
 * 값 "1" 또는 "true"(trim, 대소문자 무관)면 enqueueOperatorNotification이 그룹·개별 DM 폴백
 * 모두 미적재하고 0 반환(드롭 — 재개 후 소급 발송 없음).
 *
 * ★ 범위: 이 스위치는 enqueueOperatorNotification 경유 "운영자 업무 알림"만 멈춘다.
 *   - SECURITY_ALERT(lib/security-alerts)·ZALO_LISTENER_DOWN(lib/zalo-health)은 별도 직접 적재
 *     경로라 영향 없음(계속 발송) — 보안·장애 경보는 절대 침묵시키지 않는다(의도된 경계).
 *   - 공급자·벤더·게스트·청소자 알림은 무관(불변).
 */
export const ZALO_OPERATOR_NOTIFY_PAUSED_KEY = "ZALO_OPERATOR_NOTIFY_PAUSED";

/** 운영자 통지 대상 역할 — roster-reminder·직접예약 통지 패턴과 동일(STAFF 포함) */
export const OPERATOR_ROLES = ["OWNER", "MANAGER", "STAFF", "ADMIN"] as const;

/**
 * 그룹방으로 라우팅할 운영자 대상 알림 타입 화이트리스트 (ADR-0040).
 * 전부 "운영자 전원이 같은 정보를 받으면 되는" 업무 통지다.
 *
 * ⚠ SECURITY_ALERT·ZALO_LISTENER_DOWN은 의도적으로 제외 — 절대 추가하지 마라:
 *   - SECURITY_ALERT: 개인 대응 행동 요구(SecurityEvent 확인·인시던트 절차). 그룹 소음화 부적절.
 *   - ZALO_LISTENER_DOWN: 시스템봇 자체가 죽었을 때 오는 경보라 그룹 발송이 실패할 수 있고,
 *     수신자·전달 채널(인앱 폴백)이 다르다(lib/zalo-health의 이중 채널 설계).
 * 그 외 공급자·벤더·게스트·청소자 대상 알림은 여기 대상이 아니다(운영자 전용만).
 */
export const GROUP_ROUTED_TYPES: ReadonlySet<NotificationType> = new Set([
  NotificationType.VILLA_PENDING_REVIEW,
  NotificationType.VILLA_CONTENT_UPDATED,
  NotificationType.GUEST_PAYMENT_NOTICE,
  NotificationType.SERVICE_ORDER_REQUESTED,
  NotificationType.SUPPLIER_DIRECT_BOOKING,
  NotificationType.VENDOR_PO_RESPONSE,
  NotificationType.ROSTER_REMINDER,
  NotificationType.RATE_CHANGED_DURING_PROPOSAL,
  // 웹 채팅 신규 문의(T-webchat-mvp) — 운영자 전원이 같은 정보를 받으면 되는 업무 통지.
  // ★ 새 운영자 타입은 여기 명시 추가 필수(누락 시 그룹 라우팅 안 되고 개별 DM 폴백).
  NotificationType.WEBCHAT_NEW_MESSAGE,
  // 마케팅 자동화 통지(marketing-s2 §D) — 초안 승인 대기·발행/수집/편집 실패 경보. lib/marketing-notify 경유.
  NotificationType.MARKETING_ALERT,
]);

/**
 * Zalo 알림 대상 활성 운영자 조회 (zaloUserId 연결 + isActive).
 * 그룹 미설정 시 개별 DM fan-out의 수신자 목록. (구 lib/villa-notify에서 이동 — 단일 원천)
 */
export async function findNotifiableOperators(db: DbClient): Promise<{ id: string }[]> {
  return db.user.findMany({
    where: {
      role: { in: [...OPERATOR_ROLES] },
      isActive: true,
      zaloUserId: { not: null },
    },
    select: { id: true },
  });
}

/**
 * 운영자 알림 그룹 thread id 조회 — 미설정·조회 실패는 null(fail-open: 개별 DM 폴백).
 * tx 주입 지원. AppSetting 접근 불가(모킹·손상)여도 throw 없이 null → 기존 fan-out 유지.
 */
export async function getAdminNotifyGroupId(db: DbClient): Promise<string | null> {
  try {
    const row = await db.appSetting.findUnique({
      where: { key: ZALO_ADMIN_NOTIFY_GROUP_ID_KEY },
      select: { value: true },
    });
    const value = row?.value?.trim();
    return value && value.length > 0 ? value : null;
  } catch {
    // AppSetting 조회 불가 — 안전하게 개별 DM 폴백(운영자 알림 자체는 계속 나감)
    return null;
  }
}

/**
 * 운영자 알림 일시정지 여부 조회 — fail-open.
 * 값 "1"/"true"(trim·소문자 비교)만 true. 그 외 값·빈 값·키 부재·조회 throw = false(알림 계속).
 * tx 주입 지원(getAdminNotifyGroupId와 동일 패턴).
 */
export async function isOperatorNotifyPaused(db: DbClient): Promise<boolean> {
  try {
    const row = await db.appSetting.findUnique({
      where: { key: ZALO_OPERATOR_NOTIFY_PAUSED_KEY },
      select: { value: true },
    });
    const value = row?.value?.trim().toLowerCase();
    return value === "1" || value === "true";
  } catch {
    // AppSetting 조회 불가 — fail-open: 알림을 실수로 전부 침묵시키지 않는다
    return false;
  }
}

export interface EnqueueOperatorNotificationParams {
  type: NotificationType;
  payload: Record<string, unknown>;
  /** 비즈니스 트랜잭션 안에서 원자적으로 적재할 때 tx 주입 */
  db?: DbClient;
}

/**
 * 운영자 대상 알림 적재 단일 진입점 (ADR-0040).
 *  - 3중 게이트 충족: Notification 1행(userId=시스템봇 소유자, groupThreadId=그룹) → 그룹방 1건 발송.
 *  - 불충족: findNotifiableOperators 개별 DM fan-out (기존 동작 보존).
 * @returns 적재한 Notification 행 수(그룹=1, fan-out=운영자 수, 대상 0명=0).
 */
export async function enqueueOperatorNotification(
  params: EnqueueOperatorNotificationParams
): Promise<number> {
  const { type, payload, db } = params;
  const client: DbClient = db ?? prisma;

  // 킬스위치 — 일시정지면 그룹·개별 DM 폴백 모두 미적재하고 즉시 0 반환(드롭, 소급 없음).
  // fail-open이라 조회 실패·키 부재는 정지 아님. 보안·장애 경보는 별도 경로라 영향 없음.
  if (await isOperatorNotifyPaused(client)) {
    return 0;
  }

  // getSystemBotOwnerId는 전역 prisma를 쓰므로, 그룹 라우팅이 활성일 때만 호출한다
  // (그룹 미설정 폴백 경로는 실 DB를 건드리지 않아 기존 테스트 회귀 없음).
  if (GROUP_ROUTED_TYPES.has(type)) {
    const groupThreadId = await getAdminNotifyGroupId(client);
    if (groupThreadId) {
      const ownerId = await getSystemBotOwnerId();
      if (ownerId) {
        await enqueueNotification({ db, userId: ownerId, type, payload, groupThreadId });
        return 1;
      }
    }
  }

  // 폴백 — 개별 DM fan-out (그룹 미설정·화이트리스트 밖·소유자 미연결)
  const operators = await findNotifiableOperators(client);
  for (const op of operators) {
    await enqueueNotification({ db, userId: op.id, type, payload });
  }
  return operators.length;
}
