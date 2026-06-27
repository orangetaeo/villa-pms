// CSRF 방어 — 교차출처 위조 요청 차단 (보안 P1-S9)
//
// 위협(OWASP CSRF): 비인증 토큰 mutation(/g·/p)은 토큰이 한 번 노출되면 악성 사이트가 게스트
//   브라우저로 cross-origin POST를 위조할 수 있다. NextAuth CSRF 토큰은 /api/auth/*만 보호한다.
// 방어 원리(브라우저는 cross-origin POST에 Origin 헤더를 *반드시* 붙이며 공격자가 제거 불가):
//   - Origin 헤더가 **있고** 요청 호스트와 다르면 → 차단(403, CSRF_BLOCK 기록). 이게 크로스사이트 위조.
//   - Origin 헤더가 **없으면** 통과 — 서버간 호출(cron·Zalo ext)·일부 동일출처 케이스. 크로스사이트
//     브라우저 POST는 항상 Origin이 붙으므로 "없음"은 위조가 아니다(파괴적 미차단 아님).
//
// 적용 대상: 브라우저에서 호출되는 mutation 라우트(/g·/p). cron(CRON_SECRET)·Zalo ext(공유 시크릿)는
//   Origin이 없고 자체 인증이 있으므로 본 검사를 통과(무영향)한다.

import { NextResponse } from "next/server";
import { clientIp } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security-event";

/** 요청의 자기 호스트(프록시 X-Forwarded-Host 우선, 없으면 Host/URL). */
function selfHost(req: Request): string | null {
  const xfh = req.headers.get("x-forwarded-host");
  if (xfh) return xfh.split(",")[0].trim().toLowerCase();
  const host = req.headers.get("host");
  if (host) return host.trim().toLowerCase();
  try {
    return new URL(req.url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 동일 출처 강제. 위반 시 403 NextResponse(+CSRF_BLOCK 기록) 반환, 통과 시 null.
 * Origin 헤더가 없으면 통과(서버간 호출). 있으면 호스트가 자기 호스트와 일치해야 한다.
 */
export async function assertSameOrigin(req: Request, scope: string): Promise<NextResponse | null> {
  const origin = req.headers.get("origin");
  if (!origin) return null; // 브라우저 cross-origin POST는 항상 Origin 존재 → 없음=위조 아님

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    // Origin이 깨진 값이면 차단(정상 브라우저는 유효 Origin을 보냄)
    await recordSecurityEvent({ type: "CSRF_BLOCK", ip: clientIp(req.headers), path: `/${scope}`, meta: { scope, reason: "bad_origin" } });
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }

  const host = selfHost(req);
  if (host && originHost === host) return null; // 동일 출처 — 통과

  await recordSecurityEvent({
    type: "CSRF_BLOCK",
    ip: clientIp(req.headers),
    path: `/${scope}`,
    meta: { scope, originHost, host },
  });
  return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
}
