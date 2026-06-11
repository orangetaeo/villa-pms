// [SHARED-MODULE] from Exchange hwanjeoneobmu/server/routes/pushRoutes.ts
// Web Push 구독 관리 API
import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from './routeHelpers.js';
import { sendError, ErrorCode } from '../apiErrors.js';
import { logger } from '../logger.js';
import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  generateVapidKeys,
} from '../services/webPushService.js';

const router = Router();

// VAPID 공개키 반환 (클라이언트 구독 등록에 필요)
router.get('/push/vapid-key', (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    return sendError(res, 503, 'Web Push가 설정되지 않았습니다', ErrorCode.INTERNAL_ERROR);
  }
  res.json({ publicKey: key });
});

// 구독 등록
router.post('/push/subscribe', requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { endpoint, keys } = req.body?.subscription || {};

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return sendError(res, 400, '유효하지 않은 구독 정보입니다', ErrorCode.VALIDATION_ERROR);
    }

    await saveSubscription(userId, endpoint, keys.p256dh, keys.auth);
    res.json({ success: true });
  } catch (error) {
    logger.error('push', '구독 등록 실패', { error: error instanceof Error ? error.message : String(error) });
    sendError(res, 500, '구독 등록에 실패했습니다', ErrorCode.INTERNAL_ERROR);
  }
});

// 구독 해제
router.delete('/push/subscribe', requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { endpoint } = req.body || {};

    if (!endpoint) {
      return sendError(res, 400, 'endpoint가 필요합니다', ErrorCode.VALIDATION_ERROR);
    }

    const deleted = await removeSubscription(userId, endpoint);
    res.json({ success: true, deleted });
  } catch (error) {
    logger.error('push', '구독 해제 실패', { error: error instanceof Error ? error.message : String(error) });
    sendError(res, 500, '구독 해제에 실패했습니다', ErrorCode.INTERNAL_ERROR);
  }
});

// 테스트 푸시 발송 (인증 없이 — 등록된 전체 구독에 발송)
router.post('/push/test', async (_req, res) => {
  try {
    const { sendTestPushToAll } = await import('../services/webPushService.js');
    const count = await sendTestPushToAll();
    res.json({ success: true, sent: count });
  } catch (error) {
    logger.error('push', '테스트 발송 실패', { error: error instanceof Error ? error.message : String(error) });
    sendError(res, 500, '테스트 발송 실패', ErrorCode.INTERNAL_ERROR);
  }
});

// VAPID 키 쌍 생성 (관리자용, 개발 환경 전용)
router.post('/push/generate-vapid-keys', requireAuth, (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return sendError(res, 403, '프로덕션에서는 VAPID 키 생성이 불가합니다', ErrorCode.FORBIDDEN);
  }
  const keys = generateVapidKeys();
  res.json(keys);
});

export default router;
