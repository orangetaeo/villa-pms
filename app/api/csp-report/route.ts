// POST /api/csp-report — CSP 위반 리포트 수신 (T-sec-csp-report / 집계 P1-S5)
// Content-Security-Policy-Report-Only(report-uri) 롤아웃 관찰용. 브라우저가 인증 없이
// 전송하므로 공개. 위반을 SecurityEvent에 영속(디렉티브·호스트만) → 재시작에도 안 휘발, enforce 전 분석 가능.
// 로그 플러드 방지: IP 한도(lib/rate-limit 재사용)가 DB 쓰기량도 자연 상한.
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security-event";
import { extractCspViolation } from "@/lib/csp-report";

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

  const v = extractCspViolation(payload);
  // 영속(분석용) — 디렉티브·차단호스트·문서경로만(원문 페이로드 미저장: PII·플러드 방지).
  const meta: Record<string, unknown> = v ? { ...v } : { parsed: false };
  await recordSecurityEvent({ type: "CSP_REPORT", ip, path: "/csp-report", meta });

  // 리포트 수신 응답은 본문 없이 204 (브라우저는 응답을 사용하지 않음)
  return new Response(null, { status: 204 });
}
