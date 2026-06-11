// [SHARED-MODULE] from Exchange hwanjeoneobmu/client/src/hooks/usePushNotification.ts
// Web Push 알림 구독 관리 훅
import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/queryClient';

type PushState = 'loading' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotification() {
  const [state, setState] = useState<PushState>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }

    // 현재 구독 상태 확인
    navigator.serviceWorker.ready.then(async (registration) => {
      const permission = Notification.permission;
      if (permission === 'denied') {
        setState('denied');
        return;
      }

      const subscription = await registration.pushManager.getSubscription();
      setState(subscription ? 'subscribed' : 'unsubscribed');
    }).catch(() => {
      setState('unsupported');
    });
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);

      // VAPID 공개키 가져오기
      const keyRes = await fetch('/api/push/vapid-key');
      if (!keyRes.ok) {
        setError('서버에서 VAPID 키를 가져올 수 없습니다');
        return false;
      }
      const { publicKey } = await keyRes.json();

      // 알림 권한 요청
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        setState('denied');
        return false;
      }

      // Service Worker 등록 확인
      const registration = await navigator.serviceWorker.ready;

      // 구독 생성
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // 서버에 구독 정보 전송
      const subJson = subscription.toJSON();
      await apiRequest('POST', '/api/push/subscribe', {
        subscription: {
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh,
            auth: subJson.keys?.auth,
          },
        },
      });

      setState('subscribed');
      return true;
    } catch (err: any) {
      setError(err?.message || '구독 등록 실패');
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // 서버에서 구독 해제
        await apiRequest('DELETE', '/api/push/subscribe', {
          endpoint: subscription.endpoint,
        });

        // 브라우저에서 구독 해제
        await subscription.unsubscribe();
      }

      setState('unsubscribed');
      return true;
    } catch (err: any) {
      setError(err?.message || '구독 해제 실패');
      return false;
    }
  }, []);

  return { state, error, subscribe, unsubscribe };
}
