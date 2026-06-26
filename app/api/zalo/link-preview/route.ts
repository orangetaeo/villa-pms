// GET /api/zalo/link-preview?url=... — 구글지도 링크 미리보기(정적 지도 이미지+장소명) 조회.
//   글자만 붙여넣은 지도 링크(이미지 없음)를 채팅에서 카드로 보이게 하기 위해, 서버가 링크를 펼쳐
//   og:image(정적 지도)와 장소명을 가져온다(lib/maps-unfurl). 결과는 AppSetting에 캐시(요청마다 외부 fetch 금지).
//
// 보안: 운영자(isOperator) 전용. url은 구글지도 링크만 허용(SSRF — 임의 호스트 fetch 차단).
//   ※ 매장 실사진이 아니라 위치 지도 이미지다(붙여넣은 링크엔 실사진이 없음).
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { isGoogleMapsUrl } from "@/lib/chat-link-preview";
import { unfurlMapsLink } from "@/lib/maps-unfurl";

// 캐시 TTL — 미리보기는 거의 안 변함. 30일. 음수(실패) 결과는 짧게 캐시해 재시도 허용.
const TTL_OK_MS = 30 * 24 * 60 * 60 * 1000;
const TTL_FAIL_MS = 6 * 60 * 60 * 1000;

interface Cached {
  image: string | null;
  title: string | null;
  at: number;
}

function cacheKey(url: string): string {
  return "mapsunfurl:" + createHash("sha1").update(url).digest("hex");
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url).searchParams.get("url") ?? "";
  // SSRF — 구글지도 링크만 펼친다(임의 URL fetch 금지).
  if (!url || !isGoogleMapsUrl(url)) {
    return NextResponse.json({ error: "UNSUPPORTED_URL" }, { status: 400 });
  }

  const key = cacheKey(url);
  const now = Date.now();

  // 1) 캐시 조회 — 유효하면 그대로 반환.
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (row) {
    try {
      const c = JSON.parse(row.value) as Cached;
      const ttl = c.image ? TTL_OK_MS : TTL_FAIL_MS;
      if (now - c.at < ttl) {
        return NextResponse.json({ image: c.image, title: c.title });
      }
    } catch {
      /* 손상 캐시 — 무시하고 재펼침 */
    }
  }

  // 2) 펼치기(외부 fetch) → 캐시 저장.
  const result = await unfurlMapsLink(url);
  const payload: Cached = {
    image: result?.image ?? null,
    title: result?.title ?? null,
    at: now,
  };
  try {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(payload) },
      update: { value: JSON.stringify(payload) },
    });
  } catch {
    /* 캐시 저장 실패는 무시 — 응답은 정상 반환 */
  }

  return NextResponse.json({ image: payload.image, title: payload.title });
}
