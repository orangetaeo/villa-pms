// lib/youtube/rerender-guard.ts — 재렌더 허용 여부 판정 (QA H-1 대응)
//
// ★ 왜 필요한가: 편집 잡 비동기화(villa-clip-narration-p2)에서 run 라우트가 `DONE → PENDING`
//   전이를 허용하게 됐다(대본 고친 뒤 다시 만드는 정상 흐름). 그런데 **발행 축(status)을 보지 않으면
//   이미 유튜브에 올라간 쇼츠도 재렌더된다.** 그러면 cron이 완료 시 status를 PENDING_APPROVAL로
//   되돌리고 videoUrl을 교체하므로, 운영자가 다시 승인하면 **같은 쇼츠가 두 번 업로드**되고
//   기존 ytVideoId는 덮어써져 라이브 영상이 고아가 된다.
//   채널이 YouTube API 감사 대기 중이라 중복 업로드는 비용이 크다.
//
// 라우트 파일에 두면 Next.js가 임의 export를 허용하지 않으므로 lib으로 분리한다.
import { YtShortStatus } from "@prisma/client";

/**
 * 재렌더를 허용하는 발행 상태 — **발행 파이프라인에 오르기 전**만.
 * QUEUED·PUBLISHING·PUBLISHED 제외.
 */
export const RERENDERABLE_STATUSES: YtShortStatus[] = [
  YtShortStatus.DRAFT,
  YtShortStatus.PENDING_APPROVAL,
  YtShortStatus.FAILED,
  YtShortStatus.CANCELLED,
];

/** 이 쇼츠를 다시 렌더해도 되는가(발행 축 기준). */
export function canRerender(status: YtShortStatus): boolean {
  return RERENDERABLE_STATUSES.includes(status);
}
