// lib/seo/indexnow.ts — IndexNow 색인 요청 (T-seo-s1)
//
// IndexNow는 네이버·Bing이 공유하는 공용 프로토콜이다. 키 1개로 두 엔진에 동시에
// "이 URL이 새로 생겼다/바뀌었다"를 알린다. 구글은 IndexNow 미지원 — sitemap 경로로 처리한다.
//
// ★ 대량 핑 금지 (기획 §0 치명2):
//   신뢰도 0인 신규 도메인에서 수백 URL을 일괄 제출하면 전형적인 스팸 시그널이다.
//   호출부는 DAILY_PING_LIMIT를 반드시 지킨다. 이 모듈은 배치 크기 상한을 강제한다.
//
// 키 파일: /indexnow-key.txt 로 서빙하고 keyLocation 파라미터로 명시한다(프로토콜 허용).
import { absoluteUrl, seoBaseUrl } from "@/lib/seo/base-url";

/** 하루 핑 상한 — 점진 발행(drip) 정책. 초기 4주는 5, 이후 10으로 완화. */
export const DAILY_PING_LIMIT = 5;

/** 1회 요청에 담을 수 있는 URL 상한(자체 규율 — 프로토콜 상한보다 훨씬 보수적으로). */
const MAX_URLS_PER_BATCH = 10;

const ENDPOINTS = [
  { name: "naver", url: "https://searchadvisor.naver.com/indexnow" },
  { name: "bing", url: "https://www.bing.com/indexnow" },
] as const;

export interface PingResult {
  endpoint: string;
  ok: boolean;
  status: number | null;
  error?: string;
}

/** 키 미설정이면 핑을 시도하지 않는다(로컬·미설정 환경에서 조용히 무동작). */
export function indexNowKey(): string | null {
  const k = (process.env.INDEXNOW_KEY ?? "").trim();
  return k.length >= 8 ? k : null;
}

/**
 * URL 목록을 네이버·Bing에 동시 제출.
 * - 경로("/blog/…")를 넣어도 절대 URL로 정규화한다(호스트 불일치 = 즉시 거부).
 * - 실패해도 throw하지 않는다 — 색인 요청 실패가 발행 트랜잭션을 깨선 안 된다.
 */
export async function pingIndexNow(paths: string[]): Promise<PingResult[]> {
  const key = indexNowKey();
  if (!key || paths.length === 0) return [];

  const base = seoBaseUrl();
  const host = new URL(base).host;
  const urlList = paths
    .slice(0, MAX_URLS_PER_BATCH)
    .map((p) => (p.startsWith("http") ? p : absoluteUrl(p)))
    // 다른 호스트가 섞이면 요청 전체가 거부되므로 방어적으로 제거
    .filter((u) => {
      try {
        return new URL(u).host === host;
      } catch {
        return false;
      }
    });
  if (urlList.length === 0) return [];

  const body = JSON.stringify({
    host,
    key,
    keyLocation: absoluteUrl("/indexnow-key.txt"),
    urlList,
  });

  return Promise.all(
    ENDPOINTS.map(async (ep): Promise<PingResult> => {
      try {
        const res = await fetch(ep.url, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        return { endpoint: ep.name, ok: res.ok, status: res.status };
      } catch (e) {
        return { endpoint: ep.name, ok: false, status: null, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
}
