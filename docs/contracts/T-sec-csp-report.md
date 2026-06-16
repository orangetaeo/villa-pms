# 계약: T-sec-csp-report — CSP(Report-Only) 롤아웃 + Permissions-Policy (Phase 1 보안 후속)

## 배경
T4.9 후속 ② CSP. CSP를 곧바로 enforce하면 인라인/CDN 호환성 문제로 앱 전체가 깨질 수 있어,
**Content-Security-Policy-Report-Only**(차단 없이 위반만 수집)로 안전 롤아웃 → 위반 관찰 후 enforce가 정석.
함께 미사용 브라우저 기능을 끄는 **Permissions-Policy**(camera·microphone·geolocation — 코드상 사용 0건 확인) 추가.

next.config.ts·middleware·auth는 현재 clean(Zalo 세션 커밋 완료).

## 범위 (수정/신규 — 이 세션 전용)
- `next.config.ts` (수정·headers 배열에 **추가만**) — ① Permissions-Policy(enforce) ② Content-Security-Policy-Report-Only(report-uri /api/csp-report). 기존 5종 헤더·images·serverExternalPackages 무변경
- `app/api/csp-report/route.ts` (신규) — 위반 리포트 POST 수신·로깅(204), 로그 플러드 방지 IP 한도(lib/rate-limit 재사용)
- `docs/contracts/T-sec-csp-report.md`(본 파일), `TASKS.md`(T4.9 후속 행 갱신 또는 신규 1줄)

## 수정 금지 구역 (다른 세션 점유 — 무접촉)
- lib/cleaning·hold·proposal·zalo-runtime·zalo-inbound, LAUNCH.md, schema·messages·package.json 등
- lib/rate-limit.ts는 재사용만(무수정)

## CSP 정책 (Report-Only — 관찰용, 실제 앱 소스 반영)
- default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'
- script-src 'self' 'unsafe-inline'  (Next.js 인라인 부트스트랩 — nonce화는 후속 middleware)
- style-src 'self' 'unsafe-inline' https://fonts.googleapis.com  (Tailwind/인라인 + Google Fonts CSS)
- font-src 'self' https://fonts.gstatic.com
- img-src 'self' data: https://*.r2.dev https://*.r2.cloudflarestorage.com https://picsum.photos https://fastly.picsum.photos https://lh3.googleusercontent.com
- connect-src 'self'
- report-uri /api/csp-report

## 완료 기준
1. 모든 응답에 Permissions-Policy + Content-Security-Policy-**Report-Only** 부착(Report-Only라 차단 0 — 앱 무중단)
2. /api/csp-report: POST 위반 리포트 수신 시 204, 서버 로그 기록(application/csp-report·reports+json 둘 다 수용), 비정상/대량은 IP 한도로 완화
3. Permissions-Policy: camera=()·microphone=()·geolocation=() (미사용 확인) — 정상 기능 회귀 0
4. `npm run typecheck` 내 파일 0
5. **enforce 전환은 본 계약 제외** — 배포 후 리포트 관찰로 정책 정제 후 별도 태스크

## 한계/후속
- 정책은 로컬 풀빌드 불가(병렬 dev EPERM)로 런타임 미검증 → Report-Only라 무해, 배포 후 콘솔/리포트로 정제.
- 후속(별도): CSP enforce 전환(nonce 기반 script-src), XFF rightmost(T4.8 후속 ①), Redis(③).

## 검증
- next.config 헤더 정의·CSP 디렉티브 점검, 리포트 라우트 코드 경로, typecheck
- 후속 QA 독립 평가 + 배포 후 헤더 curl 스모크
