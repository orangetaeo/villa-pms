// lib/webchat-notify.ts — 웹 채팅 신규 문의 운영자 알림 진입점 (T-webchat-mvp, 기획 §3·§9)
//
// 방문자(비로그인)가 웹 채팅 위젯으로 메시지를 보내면 운영자(테오)에게 Zalo 그룹 알림을 보낸다.
// POST /api/webchat/messages(BE)가 메시지 저장·eager ko 번역 직후 이 함수를 호출한다.
//
// ★ 누수 0 (기획 §7): payload는 화이트리스트만 — 방문자 연락처·원문 전문·재고·KRW·마진 절대 미포함.
//   미리보기는 ko 번역문 120자 절삭. operator-notify → zalo.ts 빌더도 화이트리스트만 읽어 2중 차단.
//
// ★ 디바운스(기획 §3 운영자 흐름): 대화당 첫 메시지는 즉시, 후속은 세션당 10분 디바운스.
//   in-memory Map(replica=1 전제). 재배포 시 리셋되어도 알림 1건이 더 나갈 뿐이라 무해(기획 §9 P2 상수 규칙).
//
// ★ 알림 실패는 삼킨다 — 알림 적재 실패가 메시지 저장(BE 트랜잭션)을 막으면 안 된다(try/catch + console.error).
import { NotificationType } from "@prisma/client";
import { enqueueOperatorNotification } from "@/lib/operator-notify";

/** 후속 메시지 디바운스 창(밀리초) — 세션당 이 시간 안의 후속 알림은 억제. env 남발 금지(기획 §9 P2). */
export const DEBOUNCE_MS = 10 * 60 * 1000;

/** 미리보기 최대 길이(문자) — 원문 전문 노출 방지. */
export const PREVIEW_MAX_CHARS = 120;

/** 디바운스 Map 정리 임계치 — 이 크기를 넘으면 만료 엔트리를 청소(무한 증가 방지). */
const CLEANUP_THRESHOLD = 1000;

/** 세션별 마지막 알림 시각(ms epoch). replica=1 전제 in-memory 상태. */
const lastNotifiedAt = new Map<string, number>();

/**
 * 만료(디바운스 창을 지난) 엔트리 청소 — Map 무한 증가 방지.
 * 저트래픽 전제라 임계치 초과 시에만 O(n) 순회(핫패스 비용 무시 가능).
 */
function pruneExpired(now: number): void {
  if (lastNotifiedAt.size <= CLEANUP_THRESHOLD) return;
  for (const [sessionId, at] of lastNotifiedAt) {
    if (now - at > DEBOUNCE_MS) lastNotifiedAt.delete(sessionId);
  }
}

/** previewKo를 120자로 절삭 — null이면 "(번역 없음)". 개행은 공백으로 접어 한 줄 미리보기. */
export function buildPreview(previewKo: string | null): string {
  if (previewKo == null) return "(번역 없음)";
  const flat = previewKo.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "(번역 없음)";
  return flat.length > PREVIEW_MAX_CHARS ? flat.slice(0, PREVIEW_MAX_CHARS) : flat;
}

export interface EnqueueWebChatNewMessageNotificationParams {
  sessionId: string;
  /** ko 번역 미리보기 원문(null이면 번역 없음). 이 함수가 120자로 절삭. */
  previewKo: string | null;
  /** 방문자 위젯 선택 언어(vi/ko/en/zh/ru 등, 자유 확장). */
  visitorLocale: string;
  /** 대화당 첫 메시지 여부 — true면 디바운스 무시하고 즉시 발송. */
  isFirstMessage: boolean;
}

/**
 * 웹 채팅 신규 문의 → 운영자 Zalo 그룹 알림 적재.
 *  - isFirstMessage=true: 즉시 발송.
 *  - 그 외: 세션당 DEBOUNCE_MS(10분) 디바운스 — 창 안의 후속 메시지는 알림 억제.
 * 실패해도 throw하지 않는다(메시지 저장 트랜잭션 보호).
 */
export async function enqueueWebChatNewMessageNotification({
  sessionId,
  previewKo,
  visitorLocale,
  isFirstMessage,
}: EnqueueWebChatNewMessageNotificationParams): Promise<void> {
  try {
    const now = Date.now();

    // 디바운스 판정 — 첫 메시지는 무조건 통과, 후속은 창 안이면 스킵.
    if (!isFirstMessage) {
      const prev = lastNotifiedAt.get(sessionId);
      if (prev != null && now - prev < DEBOUNCE_MS) {
        return;
      }
    }

    // 통과 — 발송 시각 기록(디바운스 기준점) 후 정리.
    lastNotifiedAt.set(sessionId, now);
    pruneExpired(now);

    // 화이트리스트 payload — 연락처·원문 전문·판매가·마진 절대 미포함.
    await enqueueOperatorNotification({
      type: NotificationType.WEBCHAT_NEW_MESSAGE,
      payload: {
        sessionId,
        preview: buildPreview(previewKo),
        visitorLocale,
        adminUrl: `/messages?tab=webchat&session=${sessionId}`,
      },
    });
  } catch (e) {
    // 알림 실패가 메시지 저장을 막으면 안 된다 — 삼키고 로깅만.
    console.error(`[webchat-notify] 세션 ${sessionId} 알림 적재 실패`, e);
  }
}
