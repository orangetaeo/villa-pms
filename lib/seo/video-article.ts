// lib/seo/video-article.ts — 개별 영상 글(category="video")의 원천 쇼츠 조회 (ADR-0049)
//
// ★ 영상 글은 원천 YoutubeShort와 FK로 묶여 있지 않다(ADR-0049 §3 — topicKey `video-<id>`로만 역참조).
//   본문 video 블록에는 ytVideoId만 남고 durationSec는 없으므로, VideoObject JSON-LD의 duration은
//   렌더 시점에 원천 쇼츠에서 별도로 끌어온다. 조회 실패·미보유는 null → 호출부가 duration을 생략한다.
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";

/**
 * 영상 글의 원천 쇼츠 영상 길이(초). ytVideoId로 조회한다(유튜브 video id는 사실상 유일).
 * durationSec가 없거나 0 이하면 null — VideoObject는 duration 필드 자체를 생략한다(PT0S 금지).
 * DB 장애·미존재는 null(상세 페이지가 duration 하나로 500이 되면 안 된다).
 */
export async function getVideoShortDurationSec(
  ytVideoId: string,
  db: DbClient = prisma,
): Promise<number | null> {
  if (!ytVideoId) return null;
  try {
    const row = await db.youtubeShort.findFirst({
      where: { ytVideoId },
      // 같은 ytVideoId가 여럿이면 발행된 정본을 우선(최신 publishedAt).
      orderBy: { publishedAt: "desc" },
      select: { durationSec: true },
    });
    const d = row?.durationSec;
    return typeof d === "number" && d > 0 ? d : null;
  } catch {
    return null;
  }
}
