// SSRF 가드 — 서버가 사용자 제공 URL로 아웃바운드 요청할 때 내부망·클라우드 메타데이터 접근 차단 (보안 P0-8)
//
// 위협(OWASP A10 SSRF): 공급자/운영자가 iCal 가져오기 URL에 `http://169.254.169.254/...`(클라우드
//   메타데이터·자격증명), `http://localhost`·`http://10.x/192.168.x/127.x`(내부망)를 넣거나,
//   공개 도메인이 302로 내부 IP로 **리다이렉트(DNS 리바인딩)** 시키면 내부 자원이 유출된다.
// 방어: ① 프로토콜 http/https 한정 ② 호스트가 IP 리터럴이면 사설/루프백/링크로컬 대역 거부
//       ③ 도메인이면 DNS resolve한 **모든 IP**가 공인인지 검사 ④ 리다이렉트를 수동 추적하며 매 홉 재검증.
// 잔여 위험: lookup과 fetch 사이의 재바인딩(TOCTOU)은 IP 핀ning 없이는 완전봉쇄 불가 — 수동 홉 재검증으로
//   실질 위험을 크게 낮춘다. 완전봉쇄는 후속(커스텀 dns agent).

import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export class SsrfBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(`SSRF 차단: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

/** IPv4 점10진 문자열이 사설/루프백/링크로컬/예약 대역인가. */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // 파싱 불가 = 보수적으로 차단
  }
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8 (this network)
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (= 클라우드 메타데이터 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 192 && b === 0) || // 192.0.0.0/24, 192.0.2.0/24 (예약/문서)
    a >= 224 // 224+/멀티캐스트·예약·255.255.255.255
  );
}

/** IPv6 문자열이 루프백/ULA/링크로컬/사이트로컬/미지정/IPv4-매핑 내부인가. */
function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  // IPv4-매핑 — 점10진(::ffff:a.b.c.d)
  const mappedDotted = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isPrivateIpv4(mappedDotted[1]);
  // IPv4-매핑 — hex 표기(::ffff:a9fe:a9fe = 169.254.169.254). 마지막 두 hex 그룹을 IPv4로 환산.
  const mappedHex = lower.match(/:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const dotted = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    return isPrivateIpv4(dotted);
  }
  const head = lower.split(":")[0] ?? "";
  if (/^f[cd]/.test(head)) return true; // fc00::/7 ULA (fc, fd)
  if (/^fe[89a-f]/.test(head)) return true; // fe80::/10 link-local + fec0::/10 site-local(deprecated)
  return false;
}

/** IP 리터럴(점10진 또는 IPv6)이 내부 대역인가. 비-IP면 false. */
export function isInternalIp(host: string): boolean {
  const kind = net.isIP(host.replace(/^\[|\]$/g, ""));
  if (kind === 4) return isPrivateIpv4(host);
  if (kind === 6) return isPrivateIpv6(host);
  return false;
}

export type LookupAllFn = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookupAll: LookupAllFn = (hostname) => dnsLookup(hostname, { all: true });

/**
 * 단일 URL이 아웃바운드로 안전한지 검증. 위반 시 SsrfBlockedError throw.
 * - 프로토콜 http/https 한정
 * - 호스트가 IP 리터럴이면 내부 대역 거부
 * - 도메인이면 DNS resolve한 모든 주소가 공인인지 검사(하나라도 내부면 거부)
 */
export async function assertPublicUrl(
  url: string,
  lookupAll: LookupAllFn = defaultLookupAll,
  skipDnsCheck = false,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError("URL 파싱 불가");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(`허용되지 않은 스킴: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  if (!host) throw new SsrfBlockedError("호스트 없음");

  // IP 리터럴 직접 검사 — 클라우드 메타데이터(169.254.169.254) 등은 DNS 없이도 항상 차단.
  if (net.isIP(host.replace(/^\[|\]$/g, "")) !== 0) {
    if (isInternalIp(host)) throw new SsrfBlockedError(`내부 IP 직접 지정: ${host}`);
    return; // 공인 IP 리터럴
  }
  // skipDnsCheck: 실네트워크를 타지 않는 주입 fetch(테스트·신뢰 호출)에선 도메인 DNS resolve 생략.
  //   프로토콜·IP리터럴 검사는 유지되므로 메타데이터 공격은 여전히 차단.
  if (skipDnsCheck) return;
  // 도메인 → DNS resolve 후 모든 주소 검사 (리바인딩/내부 매핑 차단)
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookupAll(host);
  } catch {
    throw new SsrfBlockedError(`DNS resolve 실패: ${host}`);
  }
  if (!addrs.length) throw new SsrfBlockedError(`DNS 결과 없음: ${host}`);
  for (const { address } of addrs) {
    if (isInternalIp(address)) {
      throw new SsrfBlockedError(`도메인이 내부 IP로 resolve: ${host} → ${address}`);
    }
  }
}

/** safeFetch가 쓰는 최소 fetch 시그니처 — typeof fetch도 이 타입에 할당 가능(테스트 모킹 용이). */
export type SafeFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface SafeFetchOptions {
  fetchFn?: SafeFetchFn;
  lookupAll?: LookupAllFn;
  timeoutMs?: number;
  maxRedirects?: number;
  /** 주입 fetch(실네트워크 미접속)일 때 도메인 DNS resolve 생략 — IP리터럴/프로토콜 검사는 유지. */
  skipDnsCheck?: boolean;
}

/**
 * SSRF 안전 fetch — 리다이렉트를 수동(`manual`) 추적하며 매 홉 URL을 assertPublicUrl로 재검증한다.
 * 리다이렉트로 내부 IP를 가리키는 우회를 차단. 최종 응답(Response)을 반환.
 */
export async function safeFetch(initialUrl: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const fetchFn = opts.fetchFn ?? fetch;
  const lookupAll = opts.lookupAll ?? defaultLookupAll;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRedirects = opts.maxRedirects ?? 5;

  let url = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(url, lookupAll, opts.skipDnsCheck ?? false);
    const res = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    // 3xx + Location → 다음 홉 재검증
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res; // Location 없는 3xx — 그대로 반환
      url = new URL(loc, url).toString(); // 상대 Location 해석
      continue;
    }
    return res;
  }
  throw new SsrfBlockedError(`리다이렉트 한도 초과(${maxRedirects})`);
}
