// CSP 위반 리포트 파서 (보안 P1-S5) — 두 표준 포맷에서 디렉티브·차단호스트·문서경로만 추출.
// 원문 페이로드는 저장하지 않는다(URL 쿼리의 PII·토큰 유입·로그 플러드 방지).
//
// 포맷 A) application/csp-report:        { "csp-report": { "violated-directive", "blocked-uri", "document-uri" } }
// 포맷 B) application/reports+json:      [ { "type":"csp-violation", "body": { "effectiveDirective", "blockedURL", "documentURL" } } ]

export interface CspViolation {
  directive: string | null;
  blockedHost: string | null; // 차단 URI의 호스트만(전체 URL의 쿼리·경로 제외)
  documentPath: string | null; // 문서 URL의 경로만(쿼리 제외)
}

function hostOf(url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  // data:/inline/eval 등 스킴 키워드는 그대로(호스트 없음)
  if (/^(inline|eval|data|blob|self)$/i.test(url)) return url.toLowerCase();
  try {
    return new URL(url).host || null;
  } catch {
    return url.slice(0, 60); // URL 아니면 앞부분만(스킴 키워드 등)
  }
}

function pathOf(url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    const pathname = new URL(url).pathname || null; // 쿼리 제외 — PII 차단
    if (!pathname) return null;
    // ⚠ /p/{token}·/g/{token}은 토큰이 **path 세그먼트**에 있는 베어러 시크릿이다.
    //   CSP 리포트의 document-uri가 이 경로면 토큰이 그대로 저장되므로 세그먼트를 마스킹한다.
    //   (하위 경로 보존: /p/{token}/roster → /p/[token]/roster)
    return pathname.replace(/^\/(p|g)\/[^/]+/, "/$1/[token]");
  } catch {
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** 다양한 CSP 리포트 포맷에서 위반 요약을 추출. 파싱 불가면 null. */
export function extractCspViolation(payload: unknown): CspViolation | null {
  if (!payload || typeof payload !== "object") return null;

  // 포맷 A: { "csp-report": {...} }
  const a = (payload as Record<string, unknown>)["csp-report"];
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    return {
      directive: str(o["violated-directive"]) ?? str(o["effective-directive"]),
      blockedHost: hostOf(o["blocked-uri"]),
      documentPath: pathOf(o["document-uri"]),
    };
  }

  // 포맷 B: [ { type:"csp-violation", body:{...} } ] (또는 단일 객체)
  const arr = Array.isArray(payload) ? payload : [payload];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const body = (item as Record<string, unknown>).body;
    if (body && typeof body === "object") {
      const o = body as Record<string, unknown>;
      return {
        directive: str(o["effectiveDirective"]) ?? str(o["violatedDirective"]),
        blockedHost: hostOf(o["blockedURL"]),
        documentPath: pathOf(o["documentURL"]),
      };
    }
  }
  return null;
}
