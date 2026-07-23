// lib/seo/thumbnail.ts — 블로그 대표 썸네일(텍스트 얹은 커버) (T-blog-visual)
//
// 테오 지시 2026-07-23: "썸네일 이미지가 있는 방식이 좋다 — 텍스트를 넣어달라".
// 참고 이미지(네이버 블로그형 커버)처럼 **사진 위에 큰 한글 제목 + 후킹 한 줄 + 브랜드**를 얹는다.
//
// ★ 이 썸네일은 블로그 목록 카드·공유 미리보기(og:image)·추후 홈페이지 상세페이지 상단에 그대로 쓰인다.
//   그래서 비율은 16:9(1200×675) — 대부분의 공유 카드가 이 비율을 기대한다.
// ★ 사진은 **워터마크 파생본**을 베이스로 쓴다(블로그 이미지 워터마크 필수 규칙).
// ★ 문구는 지어내지 않는다 — 제목과 후킹 한 줄은 호출부가 사실에서 만들어 넘긴다.
import path from "path";
import { readFileSync } from "fs";
import sharp from "sharp";
import satori from "satori";
import { saveFile } from "@/lib/storage";
import { wrapHeadlineToFit } from "@/lib/instagram/headline-wrap";

export const THUMB = { width: 1200, height: 675 } as const;

// satori는 폰트를 직접 받아야 한다(브라우저 폰트 없음) — 인스타 렌더와 같은 자산을 쓴다.
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let cachedFonts: { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[] | null = null;
function loadFonts() {
  if (cachedFonts) return cachedFonts;
  const read = (f: string) => readFileSync(path.join(FONT_DIR, f));
  cachedFonts = [
    { name: "Nanum", data: read("NanumGothic-Regular.ttf"), weight: 400, style: "normal" },
    { name: "Nanum", data: read("NanumGothic-Bold.ttf"), weight: 700, style: "normal" },
    // 베트남어 라틴 확장(Phú Quốc의 ú·ố) 글리프 폴백 — 인스타 렌더와 같은 규칙.
    { name: "Noto", data: read("NotoSans-Regular.ttf"), weight: 400, style: "normal" },
    { name: "Noto", data: read("NotoSans-Bold.ttf"), weight: 700, style: "normal" },
  ];
  return cachedFonts;
}

export interface ThumbnailInput {
  /** 큰 글씨 — 가게·주제 이름(예: "메오키친") */
  title: string;
  /** 작은 글씨 후킹 한 줄(예: "반세오 하나로 다시 가게 되는 집") */
  hook?: string | null;
  /** 위치·분류 뱃지(예: "푸꾸옥 즈엉동 · 맛집") */
  eyebrow?: string | null;
}

/** 썸네일 오버레이 — 하단 그라데이션 + 큰 제목 + 후킹. satori 노드(JSX 없이 객체로 구성). */
export function thumbnailOverlay(input: ThumbnailInput): unknown {
  const titleLines = wrapHeadlineToFit(input.title, 84, THUMB.width - 112).split("\n");
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        width: THUMB.width,
        height: THUMB.height,
        // 아래쪽만 어둡게 — 사진을 최대한 살리면서 글자 가독성을 확보한다.
        backgroundImage:
          "linear-gradient(to bottom, rgba(0,0,0,0) 38%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0.82) 100%)",
        padding: 56,
      },
      children: [
        input.eyebrow
          ? {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  alignSelf: "flex-start",
                  backgroundColor: "rgba(255,255,255,0.92)",
                  color: "#0F766E",
                  fontFamily: "Nanum",
                  fontSize: 26,
                  fontWeight: 700,
                  padding: "8px 18px",
                  borderRadius: 999,
                  marginBottom: 18,
                },
                children: input.eyebrow,
              },
            }
          : null,
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column" },
            children: titleLines.map((line) => ({
              type: "div",
              props: {
                style: {
                  display: "flex",
                  fontFamily: "Nanum",
                  fontSize: 84,
                  fontWeight: 700,
                  color: "#FFFFFF",
                  lineHeight: 1.12,
                  textShadow: "0 4px 18px rgba(0,0,0,0.55)",
                },
                children: line,
              },
            })),
          },
        },
        input.hook
          ? {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  marginTop: 16,
                  fontFamily: "Nanum",
                  fontSize: 34,
                  fontWeight: 700,
                  color: "#FDE68A",
                  textShadow: "0 3px 12px rgba(0,0,0,0.6)",
                },
                children: input.hook,
              },
            }
          : null,
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              marginTop: 22,
              fontFamily: "Nanum",
              fontSize: 24,
              fontWeight: 700,
              color: "rgba(255,255,255,0.9)",
              letterSpacing: 2,
            },
            children: "VILLA GO · 푸꾸옥 빌라",
          },
        },
      ].filter(Boolean),
    },
  };
}

async function fetchImage(url: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`썸네일 원본 fetch 실패 HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const rel = url.replace(/^\/uploads\//, "");
  const base = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "public", "uploads");
  return readFileSync(path.join(base, rel));
}

/**
 * 썸네일 생성 → R2 업로드 → URL 반환.
 * ★ 실패해도 throw하지 않는다 — 썸네일이 없다고 글 생성을 막지 않는다(호출부가 사진 URL로 폴백).
 */
export async function renderArticleThumbnail(
  photoUrl: string,
  input: ThumbnailInput
): Promise<string | null> {
  try {
    const [photo, svg] = await Promise.all([
      fetchImage(photoUrl),
      satori(thumbnailOverlay(input) as unknown as Parameters<typeof satori>[0], {
        width: THUMB.width,
        height: THUMB.height,
        fonts: loadFonts(),
      }),
    ]);
    const base = await sharp(photo)
      .rotate()
      .resize(THUMB.width, THUMB.height, { fit: "cover", position: "attention" })
      .toBuffer();
    const overlay = await sharp(Buffer.from(svg)).png().toBuffer();
    const jpeg = await sharp(base)
      .composite([{ input: overlay, top: 0, left: 0 }])
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    const { url } = await saveFile(jpeg, "image/jpeg", "system", "blog-thumb");
    return url;
  } catch (e) {
    console.error("[thumbnail] 생성 실패 — 사진 URL 폴백:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
