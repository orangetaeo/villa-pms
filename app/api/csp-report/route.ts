// POST /api/csp-report — CSP 위반 리포트 수신 (T-sec-csp-report)
// Content-Security-Policy-Report-Only(report-uri) 롤아웃 관찰용. 브라우저가 인증 없이
// 전송하므로 공개. 위반을 서버 로그로 모아 enforce 전 정책을 정제한다.
// 로그 플러드 방지: IP 한도(lib/rate-limit 재사용).
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// CSP 위반은 페이지당 다수 발생 가능 → 관찰 목적상 넉넉히, 폭주만 차단.
const REPORT_IP_LIMIT = { max: 120, windowMs: 10 * 60_000 };

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (ip && !checkRateLimit(`csp-report:ip:${ip}`, REPORT_IP_LIMIT).allowed) {
    return new Response(null, { status: 429 });
  }

  // application/csp-report({"csp-report":{...}}) / application/reports+json([{type,body}]) 모두 JSON
  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    // 파싱 불가 리포트는 무시 (best-effort)
  }

  const text = payload != null ? JSON.stringify(payload) : null;
  // 로그 크기 제한 — 비정상 대용량 페이로드 방어
  console.warn("[csp-report]", text ? text.slice(0, 2000) : "(empty)");

  // 리포트 수신 응답은 본문 없이 204 (브라우저는 응답을 사용하지 않음)
  return new Response(null, { status: 204 });
}
