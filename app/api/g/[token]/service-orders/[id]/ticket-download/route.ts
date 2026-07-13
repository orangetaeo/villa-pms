// GET /api/g/[token]/service-orders/[id]/ticket-download?u=<idx>
//   게스트 QR 티켓 사전 다운로드용 동일 출처 프록시 (오프라인 대비 — 현장 인터넷 불가 시 미리 저장).
//   ticketUrls는 R2 공개 URL(교차 출처)이라 브라우저 <a download>가 파일명을 못 붙인다 → 서버가 대신
//   fetch해 Content-Disposition: attachment로 스트림해 동일 출처 다운로드를 성립시킨다.
//
// ★누수·SSRF 차단(원칙2·방어심층):
//   - u는 그 주문 ticketUrls의 **인덱스(정수)** — 임의 URL을 받지 않는다(서버가 DB의 신뢰된 URL만 fetch).
//   - 주문이 그 토큰의 예약(bookingId) 소속인지 교차검증(아니면 404, id 추측 방지).
//   - 반환은 티켓 이미지 바이트뿐 — 원가·마진·타 주문·타 필드 접근 경로 없음.
//   - 비인증 폭주 방어: guestRateLimit(토큰+IP 윈도우).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guestTokenState } from "@/lib/guest-checkin";
import { guestRateLimit, type GuestRlConfig } from "@/lib/guest-rate-limit";

// 다운로드는 읽기 전용(mutation 아님)이고, 한 주문 티켓이 최대 30장(ticket-upload 상한)이라
//   "모두 저장" 순차 다운로드가 기본 한도(30/token)를 넘길 수 있다 → 더 넉넉히(그래도 남용은 차단).
const TICKET_DL_RL: GuestRlConfig = {
  token: { max: 120, windowMs: 10 * 60_000 },
  ip: { max: 240, windowMs: 10 * 60_000 },
};

// 파일 확장자 → Content-Type 폴백(원격 응답이 헤더를 안 줄 때). ticket-upload 화이트리스트와 동일 집합.
const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** URL 경로에서 마지막 확장자(소문자) 추출 — 화이트리스트에 없으면 png 폴백. */
function extFromUrl(url: string): string {
  const path = url.split("?")[0].split("#")[0];
  const m = /\.([a-z0-9]+)$/i.exec(path);
  const ext = m ? m[1].toLowerCase() : "";
  return ext in EXT_CONTENT_TYPE ? ext : "png";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;

  // 비인증 게스트 폭주 방어(보안 P0-3) — 다운로드도 R2 대역 소비이므로 rate-limit 적용.
  const rl = await guestRateLimit("g-ticket-download", token, req, TICKET_DL_RL);
  if (rl) return rl;

  const t = await prisma.guestCheckinToken.findUnique({
    where: { token },
    select: { bookingId: true, expiresAt: true, revokedAt: true },
  });
  if (!t) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (guestTokenState(t, new Date()) !== "OK") {
    return NextResponse.json({ error: "TOKEN_UNAVAILABLE" }, { status: 410 });
  }

  // 인덱스 파싱 — 정수만(임의 URL 미수용). 비정수·음수는 400.
  const uRaw = new URL(req.url).searchParams.get("u");
  if (uRaw == null || !/^\d+$/.test(uRaw)) {
    return NextResponse.json({ error: "BAD_INDEX" }, { status: 400 });
  }
  const u = Number(uRaw);

  // 이 주문이 토큰의 예약 소속 + 게스트 신청인지 교차검증. 타예약·존재하지 않는 id는 404.
  //   ★ ticketUrls만 select — 다른 필드(원가·벤더 bankInfo 등)는 애초에 안 읽는다.
  const order = await prisma.serviceOrder.findFirst({
    where: { id, bookingId: t.bookingId, requestedVia: "GUEST" },
    select: { status: true, ticketUrls: true },
  });
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  // ★취소(CANCELLED) 주문의 티켓은 소비자 접근 완전 차단(테오 확정, 항목 7) — 이미 발급된 다운로드 URL
  //   재사용도 막는다. 존재 비노출 위해 로더의 빈 배열 절단과 동일하게 404(원본은 DB에 증빙 보존).
  if (order.status === "CANCELLED") {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  // 인덱스 범위 밖 → 400(존재하지 않는 티켓). u는 신뢰된 URL 배열의 오프셋일 뿐.
  if (u >= order.ticketUrls.length) {
    return NextResponse.json({ error: "INDEX_OUT_OF_RANGE" }, { status: 400 });
  }
  const target = order.ticketUrls[u];

  // 디스크 모드(/uploads/…)면 상대 URL이라 요청 출처로 절대화. R2면 이미 절대 URL(그대로).
  //   ★fetch 대상은 DB의 신뢰된 값뿐(사용자 입력 URL 아님) — SSRF 무관.
  const absolute = new URL(target, req.url).toString();

  let upstream: Response;
  try {
    upstream = await fetch(absolute);
  } catch {
    return NextResponse.json({ error: "FETCH_FAILED" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "FETCH_FAILED" }, { status: 502 });
  }

  const ext = extFromUrl(target);
  const contentType =
    upstream.headers.get("content-type") ?? EXT_CONTENT_TYPE[ext] ?? "application/octet-stream";
  // 파일명은 ASCII 안전(ticket-<n>.<ext>) — 품목명은 넣지 않아 헤더 인젝션·인코딩 문제 없음.
  const fileName = `ticket-${u + 1}.${ext}`;

  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    // 티켓은 발행 후 불변 — 사설 캐시 허용(브라우저 재저장 빠르게), 공유 캐시엔 안 남김(토큰 스코프).
    "Cache-Control": "private, max-age=3600",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  return new Response(upstream.body, { status: 200, headers });
}
