// [SHARED-MODULE] from Exchange hwanjeoneobmu/server/services/webPushService.ts
// Web Push 알림 서비스 — VAPID 기반 푸시 발송
import webpush from 'web-push';
import { eq, and } from 'drizzle-orm';
import { db } from '../db.js';
import { pushSubscriptions } from '../../shared/schema.js';
import { logger } from '../logger.js';

// VAPID 초기화 (환경변수 필수: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@exchange.local';

let vapidConfigured = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
    logger.info('webpush', 'VAPID 설정 완료');
  } catch (err: any) {
    logger.error('webpush', 'VAPID 설정 실패', { error: err?.message });
  }
} else {
  logger.warn('webpush', 'VAPID 환경변수 미설정 — Web Push 비활성');
}

/** VAPID 공개키 반환 (클라이언트 구독 등록용) */
export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

/** 구독 저장 (동일 endpoint 존재 시 교체 — 원자적) */
export async function saveSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    await tx.insert(pushSubscriptions).values({ userId, endpoint, p256dh, auth });
  });
  logger.info('webpush', '구독 저장', { userId, endpoint: endpoint.substring(0, 50) });
}

/** 구독 해제 */
export async function removeSubscription(userId: string, endpoint: string): Promise<boolean> {
  const result = await db.delete(pushSubscriptions).where(
    and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint))
  );
  const deleted = (result as any).rowCount > 0;
  if (deleted) {
    logger.info('webpush', '구독 해제', { userId });
  }
  return deleted;
}

/** 특정 사용자의 모든 디바이스에 푸시 발송 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!vapidConfigured) return;

  const subs = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  if (subs.length === 0) return;

  const payload = JSON.stringify({ title, body, data: data || {} });

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
      } catch (err: any) {
        // 410 Gone 또는 404: 구독 만료 → 자동 정리
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          logger.info('webpush', '만료 구독 정리', { subId: sub.id });
        } else {
          logger.error('webpush', '푸시 발송 실패', {
            subId: sub.id,
            statusCode: err?.statusCode,
            error: err?.message,
          });
        }
        throw err; // allSettled이므로 다른 구독에 영향 없음
      }
    })
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  if (sent > 0 || failed > 0) {
    logger.info('webpush', `발송 완료: ${sent}건 성공, ${failed}건 실패`, { userId });
  }
}

/** 테스트: 등록된 전체 구독에 푸시 발송 */
export async function sendTestPushToAll(): Promise<number> {
  if (!vapidConfigured) return 0;

  const subs = await db.select().from(pushSubscriptions);
  if (subs.length === 0) return 0;

  const payload = JSON.stringify({
    title: '테스트 알림 ✅',
    body: '푸시 알림이 정상 동작합니다!',
    data: { url: '/' },
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (err: any) {
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      }
      logger.error('webpush', '테스트 발송 실패', { subId: sub.id, error: err?.message });
    }
  }
  return sent;
}

/** VAPID 키 쌍 생성 (최초 1회 실행용 CLI 유틸) */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
