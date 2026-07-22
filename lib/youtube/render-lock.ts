// 렌더 동시성 전역 락 판정 (QA M-7).
//
// 문제: `/api/cron/youtube-edit-jobs`는 주기 5분인데 렌더 1건이 최대 8분이다(주기 < 렌더).
//   잡별 원자 락(PENDING→PROCESSING)은 "같은 잡의 이중 렌더"만 막고 **다른 잡**은 못 막아서,
//   PENDING이 밀리면 주기마다 새 잡을 집어 ffmpeg가 2~3개 동시에 돈다.
//   Railway 컨테이너 1대에서 그러면 렌더가 서로 느려지고 같은 컨테이너의 웹 요청까지 굶는다.
//
// 해법: 별도 락 테이블 없이 **살아있는 PROCESSING 행 자체를 리스**로 쓴다.
//   - 리스 만료 = 고아 판정과 같은 컷오프(25분). 두 값이 어긋나면 죽은 락이 영구 점유하거나
//     살아있는 렌더를 락으로 못 세는 구멍이 생긴다 → 호출부에서 같은 상수를 넘긴다.
//   - 검사 순서도 계약이다: **고아 회수 → 락 검사**. 뒤집으면 크래시 잔재가 락을 영구 점유해
//     렌더가 영영 안 도는 데드락이 된다.
//
// 이 파일은 순수 함수만 둔다(DB·시간 의존 0) — 판정 로직을 유닛 테스트로 고정하기 위함.

/** 동시 렌더 상한. 컨테이너 1대에서 ffmpeg 동시 실행의 정답은 1이다(설정값으로 열지 않는다). */
export const MAX_CONCURRENT_RENDERS = 1;

/**
 * 지금 렌더를 시작하면 안 되는가?
 * @param liveRenderCount 리스가 살아있는(=고아 아님) PROCESSING 행 수
 */
export function isRenderBusy(liveRenderCount: number): boolean {
  return liveRenderCount >= MAX_CONCURRENT_RENDERS;
}

/**
 * claim 직후 경합 판정 — 두 주기가 거의 동시에 기동해 서로 다른 잡을 claim한 경우,
 * **id 최소값 1건만 살아남는다**.
 *
 * 검사(count) → claim(updateMany)은 원자적이지 않으므로 claim 후에 한 번 더 본다.
 * "경쟁자가 있으면 무조건 양보"로 만들면 양쪽 다 반납해 그 주기가 통째로 비는 livelock이 되므로,
 * 결정적 tie-break(id 사전순 최소)로 정확히 한쪽만 진행시킨다.
 *
 * @param myId 내가 claim한 잡 id
 * @param otherLiveIds 나를 제외한, 리스가 살아있는 PROCESSING 잡 id 목록
 * @returns true면 내가 렌더를 진행한다. false면 claim을 PENDING으로 반납하고 양보한다.
 */
export function winsRenderRace(myId: string, otherLiveIds: string[]): boolean {
  return otherLiveIds.every((other) => myId < other);
}
