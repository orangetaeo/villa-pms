// lib/zalo-quote-anchor.ts — 답글 인용 점프 앵커 변환 (globalMsgId → zaloMsgId).
//
// 배경(근본 원인): /messages 채팅에서 답글 인용 블록을 클릭하면 원본 메시지로 스크롤+하이라이트되는
//   기능(chat-pane QuotedBlock.canJump / scrollToMessage)이 있으나, 버블 앵커 data-msg-id는
//   zaloMsgId(= zca-js data.msgId)인 반면, 수신 답글의 quotedMsgId는 zca-js quote.globalMsgId다.
//   zca-js에서 msgId ≠ globalMsgId(다른 ID 체계)라, 변환 없이는 매칭이 절대 안 돼 점프가 작동하지 않는다.
//   Nike가 동일 버그를 겪고 globalMsgId→zaloMsgId 변환으로 해결(reference/nike zalo-db-store resolveQuoteMsgIds).
//
// 우리 발신(OUTBOUND, POST route) 답글은 quotedMsgId=원본 zaloMsgId로 저장돼 이미 앵커와 일치한다 →
//   맵에 globalMsgId 키만 담기므로 그 값은 변환되지 않고 그대로 통과(회귀 0).
//
// 누수 0: 변환은 zaloMsgId·globalMsgId(불투명 식별자)만 사용. 마진·판매가·원가 미조회.
import { prisma } from "@/lib/prisma";
import type { ChatMessageDTO } from "@/lib/zalo-chat-message";

/** 앵커 변환 입력 — 메시지의 zaloMsgId(버블 앵커) ↔ globalMsgId(수신 답글 인용 키). */
export interface AnchorRow {
  zaloMsgId: string | null;
  globalMsgId?: string | null;
}

/**
 * 같은 배치(로드된 메시지들) 안에서 globalMsgId → zaloMsgId 맵 구성 (Nike resolveQuoteMsgIds 1차).
 * 둘 다 있는 메시지만 매핑(부분 데이터는 변환 키로 못 씀). 순수 함수 — 단위 테스트 대상.
 */
export function buildAnchorMap(rows: AnchorRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.globalMsgId && r.zaloMsgId) map.set(r.globalMsgId, r.zaloMsgId);
  }
  return map;
}

/**
 * DTO의 quotedMsgId(수신 답글은 globalMsgId)를 버블 앵커 zaloMsgId로 치환한다.
 *  1) 배치 내 맵(buildAnchorMap)으로 먼저 변환.
 *  2) 배치에 없는 quotedMsgId(원본이 더 과거 — 현재 로드 범위 밖)는 대화 스코프 DB 폴백으로 보강.
 *     (현재 화면에 원본 버블이 없으면 클릭해도 무동작이지만, 변환 자체는 맞춰 둔다 — 스크롤로 더 로드 시 점프 가능.)
 *
 * 변환 키에 없는 quotedMsgId(우리 발신 답글의 이미-zaloMsgId 값 등)는 그대로 둔다(회귀 0).
 * DB 폴백 실패는 조용히 무시(원본 그대로) — 점프만 안 될 뿐 인용 표시는 유지.
 */
export async function resolveQuotedAnchors(
  dtos: ChatMessageDTO[],
  rows: AnchorRow[],
  conversationId: string
): Promise<ChatMessageDTO[]> {
  const quotedIds = dtos
    .map((d) => d.quotedMsgId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (quotedIds.length === 0) return dtos;

  const map = buildAnchorMap(rows);

  // 배치에서 못 찾은 quotedMsgId만 DB 폴백 — globalMsgId로 같은 대화의 zaloMsgId 조회.
  const unresolved = [...new Set(quotedIds.filter((id) => !map.has(id)))];
  if (unresolved.length > 0) {
    try {
      const found = await prisma.zaloMessage.findMany({
        where: { conversationId, globalMsgId: { in: unresolved } },
        select: { globalMsgId: true, zaloMsgId: true },
      });
      for (const f of found) {
        if (f.globalMsgId && f.zaloMsgId) map.set(f.globalMsgId, f.zaloMsgId);
      }
    } catch {
      /* DB 폴백 실패는 무시 — 변환 안 된 quotedMsgId는 점프 불가(인용 표시는 유지) */
    }
  }

  if (map.size === 0) return dtos;
  return dtos.map((d) =>
    d.quotedMsgId && map.has(d.quotedMsgId)
      ? { ...d, quotedMsgId: map.get(d.quotedMsgId)! }
      : d
  );
}
