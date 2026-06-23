// lib/zalo-mentions.ts — @멘션 위치 재정렬 (2026-06-23)
//
// 문제: 운영자가 한국어로 "@이름 …"을 입력하면 mention {pos,len}은 한국어 기준이지만,
//       발송 전 ko→vi 번역으로 본문이 바뀌어 pos/len이 어긋나 실제 멘션이 안 걸린다.
// 해결: 실제 발송될 본문(dstText)에서 멘션 토큰("@이름")을 다시 찾아 pos/len을 재계산.
//   - 개별 멘션: 이름은 고유명사라 번역 후에도 대개 그대로 남는다("@Võ Khánh Hùng").
//     번역이 "@"를 떨어뜨린 경우 이름만으로도 찾아 앞의 "@"를 포함해 보정.
//   - @전체(uid "-1"): 토큰이 언어별로 바뀌므로 알려진 @all 라벨 후보로 탐색.
//   - 못 찾으면 그 멘션은 버린다(잘못된 위치로 엉뚱한 사람을 멘션하는 것 방지).
//
// pos/len은 zca-js 컨벤션(UTF-16 문자열 인덱스/길이) — String.indexOf/.length와 일치.

export type ZaloMention = { pos: number; uid: string; len: number };

/** @전체(uid "-1") 토큰의 언어별 후보 — 번역으로 라벨이 바뀌어도 탐색되도록. */
const ALL_LABEL_CANDIDATES = ["@전체", "@Tất cả", "@tất cả", "@All", "@all", "@모두"];

/** dstText에서 후보 문자열들을 used 구간과 겹치지 않게 첫 매칭. 못 찾으면 null. */
function matchNeedle(
  dstText: string,
  candidates: string[],
  used: [number, number][]
): { pos: number; len: number } | null {
  const overlaps = (s: number, e: number) => used.some(([us, ue]) => s < ue && e > us);
  for (const cand of candidates) {
    if (!cand) continue;
    let idx = dstText.indexOf(cand);
    while (idx !== -1) {
      let pos = idx;
      let len = cand.length;
      // 후보가 "@"로 시작 안 하면(이름만), 앞 문자가 "@"면 포함해 보정.
      if (!cand.startsWith("@") && idx > 0 && dstText[idx - 1] === "@") {
        pos = idx - 1;
        len = cand.length + 1;
      }
      if (!overlaps(pos, pos + len)) return { pos, len };
      idx = dstText.indexOf(cand, idx + 1);
    }
  }
  return null;
}

/**
 * 번역 전 본문(srcText)에서 멘션 토큰을 잘라, 번역 후 본문(dstText)에서 다시 찾아 재정렬.
 * srcText·dstText를 모두 가진 경로(villa 자체 발송: messages route)용.
 */
export function reanchorMentions(
  srcText: string,
  dstText: string,
  mentions: ZaloMention[]
): ZaloMention[] {
  const out: ZaloMention[] = [];
  const used: [number, number][] = [];
  for (const m of mentions) {
    const token = srcText.slice(m.pos, m.pos + m.len); // "@전체" / "@Võ Khánh Hùng"
    if (!token.startsWith("@")) continue;
    const candidates = m.uid === "-1" ? [...ALL_LABEL_CANDIDATES, token] : [token, token.slice(1)];
    const found = matchNeedle(dstText, candidates, used);
    if (found) {
      used.push([found.pos, found.pos + found.len]);
      out.push({ pos: found.pos, uid: m.uid, len: found.len });
    }
  }
  return out;
}

/**
 * 멤버 이름 맵으로 발송 본문(dstText)에서 멘션을 재정렬.
 * srcText가 없는 경로(Nike 위임: ext/send — Nike가 이미 번역한 본문 + 원본기준 pos를 보냄)용.
 * @param memberNameByUid uid → 표시명(그룹 멤버 스냅샷)
 */
export function reanchorMentionsByName(
  dstText: string,
  mentions: ZaloMention[],
  memberNameByUid: Map<string, string>
): ZaloMention[] {
  const out: ZaloMention[] = [];
  const used: [number, number][] = [];
  for (const m of mentions) {
    const candidates =
      m.uid === "-1"
        ? [...ALL_LABEL_CANDIDATES]
        : (() => {
            const name = memberNameByUid.get(m.uid);
            return name ? [`@${name}`, name] : [];
          })();
    if (candidates.length === 0) continue;
    const found = matchNeedle(dstText, candidates, used);
    if (found) {
      used.push([found.pos, found.pos + found.len]);
      out.push({ pos: found.pos, uid: m.uid, len: found.len });
    }
  }
  return out;
}
