# 런북: CSP Report-Only → Enforce 전환 (보안 P1-S5)

## 현황
- `next.config.ts`가 **`Content-Security-Policy-Report-Only`**로 롤아웃됨(차단 없음, 위반만 수집).
- 위반 리포트는 `/api/csp-report`가 수신 → **SecurityEvent(type=`CSP_REPORT`)에 영속**(디렉티브·차단호스트·문서경로만, 원문 미저장). 재시작에도 안 휘발 → 분석 가능(기존 console.warn-only의 "관찰 불가" 블로커 해소).
- 현재 정책에 `script-src 'unsafe-inline'`·`style-src 'unsafe-inline'` 존재(Next.js 인라인 부트스트랩).

## 분석 (전환 전 필수)
운영 일정 기간(예: 1~2주) 수집 후 SecurityEvent로 위반 집계:
```sql
SELECT meta->>'directive' AS directive, meta->>'blockedHost' AS host, count(*)
FROM "SecurityEvent" WHERE type='CSP_REPORT'
GROUP BY 1,2 ORDER BY 3 DESC;
```
- 정상 기능에서 발생하는 위반(예: 빠진 CDN 호스트)을 정책 화이트리스트에 **먼저 추가**한다.
- `blockedHost`가 우리 자산(R2·Google·Zalo CDN)인데 막히면 해당 `*-src`에 추가.

## 전환 체크리스트
1. 위반이 "정상 기능 0건"으로 수렴했는지 위 쿼리로 확인.
2. `next.config.ts`에서 헤더 키를 `Content-Security-Policy-Report-Only` → **`Content-Security-Policy`**로 변경(정책 값은 동일 유지, report-uri 유지 권장).
3. (강화) `script-src 'unsafe-inline'` 제거 + **nonce 기반**으로 전환:
   - middleware에서 요청별 nonce 생성 → 응답 헤더 `script-src 'nonce-<값>'`, 인라인 `<script nonce>`에 주입.
   - Next.js App Router nonce 패턴 적용(불가 시 'unsafe-inline' 유지하되 위험 문서화).
4. 스테이징에서 전 화면 스모크(로그인·게스트 /g·제안 /p·채팅·PDF·지도) — 콘솔 CSP 차단 0 확인.
5. 카나리 배포 후 `CSP_REPORT` 급증 없는지 24h 관찰 → 이상 시 즉시 Report-Only 롤백.

## 롤백
헤더 키만 `-Report-Only`로 되돌리면 즉시 비차단(코드 1줄). 정책 값 변경 없음.
