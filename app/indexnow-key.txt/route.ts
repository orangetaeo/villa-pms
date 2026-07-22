// app/indexnow-key.txt/route.ts — IndexNow 키 파일 (T-seo-s1)
//
// IndexNow는 "이 도메인의 소유자가 맞다"를 키 파일로 확인한다. 프로토콜상 키는 공개 값이며,
// 노출돼도 위험이 없다(제3자가 우리 URL의 색인을 요청할 수 있을 뿐 — 무해).
// 파일명을 {key}.txt로 두는 대신 고정 경로 + keyLocation 파라미터를 쓴다(프로토콜 허용).
import { indexNowKey } from "@/lib/seo/indexnow";

export const dynamic = "force-dynamic";

export function GET() {
  const key = indexNowKey();
  if (!key) return new Response("Not Found", { status: 404 });
  return new Response(key, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
