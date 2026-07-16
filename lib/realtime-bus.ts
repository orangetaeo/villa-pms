// lib/realtime-bus.ts — 인박스 실시간(SSE) 인-프로세스 이벤트 버스 (realtime-sse 계약)
//
// 배경: /messages 인박스가 5초 폴링이라 최대 5초 지연. SSE로 전환해 새 수신/발신을
//   1초 이내 반영한다. Railway 단일 컨테이너 기준 — 모듈 레벨 EventEmitter 하나면 충분.
//
// 스코프(누수 0): 채널 키 = ownerAdminId. 구독자는 자기(ownerAdminId) 이벤트만 받는다
//   (타 관리자 대화 이벤트 누수 금지 — ADR-0007 본인 스코프). 페이로드엔 식별 신호만
//   (type·conversationId) — 본문·마진·판매가·원가는 절대 싣지 않는다(데이터는 기존 fetch로).
//
// dev HMR·다중 import에도 단일 인스턴스를 보장하기 위해 globalThis에 캐시한다.
import { EventEmitter } from "events";

/** SSE로 흐르는 신호 페이로드 — 데이터가 아니라 "갱신하라"는 신호만. */
export interface RealtimeEvent {
  /** inbound=수신 저장, outbound=운영자 발신, update=기타 갱신 신호 */
  type: "inbound" | "outbound" | "update";
  /** 변경이 일어난 대화 id — 클라이언트가 현재 열린 대화와 비교해 스레드도 갱신 */
  conversationId: string;
  /**
   * 소스 채널(additive). 미지정=zalo(기존 동작). webchat=웹 채팅 세션 신호 —
   * FE 인박스가 Zalo 탭/웹챗 탭을 구분해 갱신(누수 무관: 식별 신호만, 본문 미탑재).
   */
  source?: "zalo" | "webchat";
}

// globalThis 캐시 — dev(HMR)·서버리스 중복 import에도 단일 인스턴스.
const globalForBus = globalThis as unknown as {
  __villaRealtimeBus?: EventEmitter;
};

function getBus(): EventEmitter {
  if (!globalForBus.__villaRealtimeBus) {
    const bus = new EventEmitter();
    // ownerAdminId별 채널 + 다중 탭/연결 → 리스너 많아질 수 있음. 경고 방지로 무제한.
    bus.setMaxListeners(0);
    globalForBus.__villaRealtimeBus = bus;
  }
  return globalForBus.__villaRealtimeBus;
}

/**
 * 이벤트 발행 — ownerAdminId 채널로만 emit(타 관리자 누수 0).
 * best-effort: 구독자가 없어도 무해. 호출부는 try/catch로 감싸 저장/발신 경로를 막지 않는다.
 */
export function publish(ownerAdminId: string, payload: RealtimeEvent): void {
  if (!ownerAdminId) return;
  getBus().emit(ownerAdminId, payload);
}

/**
 * 구독 — ownerAdminId 채널 리스너 등록. 반환된 함수를 호출하면 구독 해제.
 * SSE 라우트가 연결마다 구독하고, 연결 종료(abort) 시 반환 함수로 해제한다.
 */
export function subscribe(
  ownerAdminId: string,
  listener: (payload: RealtimeEvent) => void
): () => void {
  const bus = getBus();
  bus.on(ownerAdminId, listener);
  return () => {
    bus.off(ownerAdminId, listener);
  };
}
