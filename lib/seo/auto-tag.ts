// lib/seo/auto-tag.ts — 장소 사진을 Gemini 비전으로 자동 분류(kind) + 설명(alt) 생성 (T-photo-autotag)
//
// 왜: 사진마다 사람이 종류·설명을 입력하는 게 병목이다(테오 지적 2026-07-24). AI가 사진을 읽어 자동으로 채운다.
// ★ 비용 통제 3원칙:
//   ① **512px 썸네일로 축소** 후 전송 — 토큰(=비용)을 크게 줄인다. 분류엔 저해상도로 충분.
//   ② **1회성** — 결과는 DB(SeoMedia.kind/alt)에 저장하고 재실행하지 않는다(조회·재생성에 추가 비용 0).
//   ③ **안전 폴백** — 키 미설정·실패 시 {kind:null, alt:가게명} 반환. 자동태그가 업로드를 막지 않는다.
// ★ 이미지 base64는 로그·AuditLog에 남기지 않는다(여권 OCR 원칙 승계) — 상태코드만.
import sharp from "sharp";
import { MEDIA_KINDS, isMediaKind } from "@/lib/seo/place-article";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 30_000;
const THUMB_MAX = 512;

export interface AutoTagResult {
  /** MEDIA_KINDS 화이트리스트 값 또는 null(분류 실패·애매) */
  kind: string | null;
  /** "가게명 + 짧은 설명" — 갤러리 그룹 키로도 쓰인다(placePhotoGroupKey) */
  alt: string;
}

function buildPrompt(): string {
  const kinds = MEDIA_KINDS.map((k) => `${k.key}(${k.label})`).join(", ");
  return [
    "너는 여행 장소 사진을 분류하는 도우미다. 사진 한 장을 보고 JSON으로만 답하라.",
    `- kind: 다음 key 중 하나만 고른다. ${kinds}. 애매하면 "etc".`,
    "- label: 사진에 **실제로 보이는 것**을 한국어 2~5단어로 짧게. 예: '반쎄오', '해산물 볶음밥', '수영장', '노을 풍경', '가게 간판', '실내 좌석'.",
    "  추측·과장·홍보문구 금지. 안 보이면 일반적으로(예: '음식 접시', '내부 전경').",
    '형식(한 줄): {"kind":"food","label":"반쎄오"}',
  ].join("\n");
}

/**
 * 이미지 URL 한 장 → {kind, alt}. 실패해도 throw하지 않고 폴백을 돌려준다(호출부가 업로드를 멈추지 않게).
 * @param imageUrl 원본 이미지 URL(워터마크 전 원본이 분류에 더 깨끗)
 * @param placeName 가게명 — alt 접두로 붙는다
 */
export async function autoTagImage(
  imageUrl: string,
  placeName: string,
  fetchFn: typeof fetch = fetch
): Promise<AutoTagResult> {
  const fallback: AutoTagResult = { kind: null, alt: placeName };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallback;
  try {
    const res = await fetchFn(imageUrl, { signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS) });
    if (!res.ok) return fallback;
    const buf = Buffer.from(await res.arrayBuffer());
    // 512px jpeg 썸네일 — 비용↓(토큰↓). rotate()로 EXIF 방향 보정.
    const thumb = await sharp(buf)
      .rotate()
      .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    const base64 = thumb.toString("base64");

    const g = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [
            { parts: [{ text: buildPrompt() }, { inline_data: { mime_type: "image/jpeg", data: base64 } }] },
          ],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      }
    );
    if (!g.ok) return fallback; // 본문에 이미지가 에코될 수 있어 상태코드만 본다
    const data = (await g.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const parsed = parseTagJson(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    if (!parsed) return fallback;
    const kind = isMediaKind(parsed.kind) ? parsed.kind : null;
    const label = parsed.label.trim().replace(/\s+/g, " ").slice(0, 40);
    const alt = (label ? `${placeName} ${label}` : placeName).trim().slice(0, 200);
    return { kind, alt };
  } catch {
    return fallback;
  }
}

function parseTagJson(text: string): { kind: string; label: string } | null {
  try {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s < 0 || e <= s) return null;
    const o = JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
    if (!o || typeof o !== "object") return null;
    return {
      kind: typeof o.kind === "string" ? o.kind : "",
      label: typeof o.label === "string" ? o.label : "",
    };
  } catch {
    return null;
  }
}
