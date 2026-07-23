// lib/marketing/deletable.ts — 마케팅 콘텐츠(인스타 포스트·유튜브 쇼츠) 하드 삭제 가능 판정.
//
// 운영자 지시(2026-07-23): 리스트에서 체크박스로 골라 **하드 삭제**(soft delete 아님).
//   단, **업로드 진행 중(PUBLISHING)과 발행 완료(PUBLISHED)는 삭제 불가**.
//   - PUBLISHING: 발행 cron이 잡고 있는 중복발행 방지 락. 지우면 고아 업로드가 된다.
//   - PUBLISHED: 인스타·유튜브에 실제로 살아있는 콘텐츠. permalink·조회수·감사이력의 유일한 기록이라 보존.
//
// ★ 두 모델(IgPostStatus·YtShortStatus)이 같은 이름의 상태를 쓰므로 문자열 기준 공용 판정으로 둔다.
//   상태가 추가되면 기본은 "삭제 가능"이다 — 보호가 필요한 상태는 여기 목록에 명시적으로 넣을 것.

/** 하드 삭제가 금지된 상태 — 진행 중 업로드(락)와 실제 발행분. */
export const UNDELETABLE_MARKETING_STATUSES = ["PUBLISHING", "PUBLISHED"] as const;

const UNDELETABLE = new Set<string>(UNDELETABLE_MARKETING_STATUSES);

/** 이 상태의 항목을 하드 삭제해도 되는가. */
export function canDeleteMarketingStatus(status: string): boolean {
  return !UNDELETABLE.has(status);
}

/** 한 번에 삭제 가능한 최대 건수 — 오폭·타임아웃 방지(목록 페이지 10건의 여유 배수). */
export const BULK_DELETE_MAX = 50;

/**
 * 대상 행을 삭제 가능/차단으로 나눈다. 서버·클라 공용(같은 규칙 두 번 쓰지 않기 위함).
 * @returns deletable=삭제 진행할 행, blocked=상태 때문에 막힌 행(응답에 그대로 실어 사용자에게 알린다)
 */
export function partitionDeletable<T extends { id: string; status: string }>(
  rows: T[]
): { deletable: T[]; blocked: T[] } {
  const deletable: T[] = [];
  const blocked: T[] = [];
  for (const r of rows) {
    if (canDeleteMarketingStatus(r.status)) deletable.push(r);
    else blocked.push(r);
  }
  return { deletable, blocked };
}
