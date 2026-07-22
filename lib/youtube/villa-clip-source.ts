// 쇼츠 편집 소재로 **빌라 자산(VillaClip)** 을 쓰기 위한 해석·검증 (youtube-villa-clip-source).
//
// 배경: VillaClip(P1)은 만들어 놓고 **소비처가 0개**였다. 쇼츠·릴스는 전부 ADMIN이 그때그때 다시
//   올린 `youtube-clips/…`를 썼고, 공급자가 올린 영상은 어디에도 쓰이지 않았다.
//   → 편집 잡이 `villaClipId`를 소재로 받게 하는 것이 P1을 완성시키는 연결 고리다.
//
// 보안 설계(핵심):
//   - 클라이언트는 **r2Key를 볼 수 없다**. `GET /api/villas/[id]/clips`의 응답 화이트리스트에
//     r2Key가 없기 때문이다. 그래서 클라는 `villaClipId`만 보내고 **서버가 키로 해석**한다.
//     이 비대칭은 의도된 것이므로 응답에 r2Key를 추가하지 말 것.
//   - 그래도 params에 `villa-clips/…` 형식 문자열을 직접 써넣는 우회는 가능하므로,
//     **모든 villa-clips 키는 APPROVED VillaClip 행으로 실재해야 한다**는 불변식을 라우트에서 강제한다.
//
// 이 파일은 순수 함수만 둔다(DB 접근 없음) — 조회는 라우트가 하고, 판정은 여기서 테스트로 고정한다.

/** 소재 자격 위반. code는 API 응답에 그대로 실린다(사유별 분기 없이 수렴 — 존재 누설 차단). */
export class ClipSourceError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "ClipSourceError";
  }
}

/** villa-clips 접두 키 판별 — edit.ts CLIP_KEY_RE의 ⑵번 갈래와 같은 형식. */
const VILLA_CLIP_KEY_RE = /^villa-clips\/[a-zA-Z0-9]+\.(mp4|mov)$/;
export function isVillaClipSourceKey(key: unknown): key is string {
  return typeof key === "string" && VILLA_CLIP_KEY_RE.test(key);
}

export interface ClipRefs {
  /** params.clips[].villaClipId 로 참조된 VillaClip id(중복 제거, 등장 순서 보존) */
  ids: string[];
  /** params.clips[].key 에 직접 들어온 villa-clips/… 키(중복 제거) */
  keys: string[];
}

/**
 * 검증 전 원시 params에서 VillaClip 참조를 뽑는다.
 * ★ validateEditParams보다 **먼저** 돈다 — 그쪽은 key가 이미 채워져 있다고 가정하기 때문이다.
 */
export function extractClipRefs(rawParams: unknown): ClipRefs {
  const clips = (rawParams as { clips?: unknown } | null | undefined)?.clips;
  const ids: string[] = [];
  const keys: string[] = [];
  if (!Array.isArray(clips)) return { ids, keys };

  for (const c of clips) {
    if (!c || typeof c !== "object") continue;
    const cc = c as Record<string, unknown>;
    const id = typeof cc.villaClipId === "string" ? cc.villaClipId.trim() : "";
    if (id && !ids.includes(id)) ids.push(id);
    const key = typeof cc.key === "string" ? cc.key.trim() : "";
    if (isVillaClipSourceKey(key) && !keys.includes(key)) keys.push(key);
  }
  return { ids, keys };
}

/** 라우트가 DB에서 조회해 넘기는 행(APPROVED만 조회한다). */
export interface ApprovedClipRow {
  id: string;
  r2Key: string;
  villaId: string;
}

/**
 * 조회 결과가 소재 자격을 만족하는지 판정하고, **소재 빌라 id**를 돌려준다.
 *
 * 규칙:
 *  1. 참조한 id·키가 하나라도 조회되지 않으면 거부 — 미존재·미승인·타빌라를 **같은 코드**로 수렴시킨다
 *     (사유를 나누면 "그 id는 존재하지만 미승인"이라는 정보가 새어나간다).
 *  2. 한 쇼츠의 소재는 **단일 빌라**여야 한다. 여러 빌라 영상이 한 편에 섞이면 콘텐츠가 거짓이 된다.
 *  3. 호출자가 villaId를 지정했으면 그것과도 일치해야 한다.
 */
export function resolveSourceVilla(
  rows: ApprovedClipRow[],
  refs: ClipRefs,
  expectedVillaId?: string | null
): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byKey = new Map(rows.map((r) => [r.r2Key, r]));

  for (const id of refs.ids) {
    if (!byId.has(id)) throw new ClipSourceError("CLIP_NOT_USABLE", `villaClipId=${id}`);
  }
  for (const key of refs.keys) {
    // 형식은 맞지만 APPROVED 행이 없는 키 = params 직접 주입 우회 시도이거나 미승인 소재.
    if (!byKey.has(key)) throw new ClipSourceError("CLIP_NOT_USABLE", `key=${key}`);
  }

  const villaIds = new Set(rows.map((r) => r.villaId));
  if (villaIds.size > 1) {
    throw new ClipSourceError("CLIP_VILLA_MISMATCH", "여러 빌라의 영상을 한 편에 섞을 수 없습니다");
  }
  const villaId = [...villaIds][0];
  if (expectedVillaId && villaId && expectedVillaId !== villaId) {
    throw new ClipSourceError("CLIP_VILLA_MISMATCH", "선택한 빌라와 영상의 빌라가 다릅니다");
  }
  return villaId;
}

/**
 * 원시 params의 `villaClipId`를 실제 R2 키로 치환한 새 params를 만든다(입력 불변).
 * 치환 후에는 기존 `validateEditParams`가 그대로 검증한다 — 검증 경로를 늘리지 않는다.
 */
export function applyResolvedClipKeys(rawParams: unknown, rows: ApprovedClipRow[]): unknown {
  const p = (rawParams ?? {}) as Record<string, unknown>;
  if (!Array.isArray(p.clips)) return rawParams;
  const byId = new Map(rows.map((r) => [r.id, r]));

  return {
    ...p,
    clips: p.clips.map((c) => {
      if (!c || typeof c !== "object") return c;
      const cc = { ...(c as Record<string, unknown>) };
      const id = typeof cc.villaClipId === "string" ? cc.villaClipId.trim() : "";
      if (id) {
        const row = byId.get(id);
        // 미해석 id는 resolveSourceVilla가 이미 걸렀다 — 여기 도달하면 계약 위반이다.
        if (!row) throw new ClipSourceError("CLIP_NOT_USABLE", `villaClipId=${id}`);
        cc.key = row.r2Key;
      }
      delete cc.villaClipId; // EditParams 스키마에 없는 필드는 남기지 않는다(저장 JSON 오염 방지)
      return cc;
    }),
  };
}
