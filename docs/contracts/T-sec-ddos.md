# 계약: T-sec-ddos — DDoS/L7 플러드 하드닝 (보안 P1-S11)

## 배경
테오 "디도스 공격에도 문제 없게". 볼류메트릭(L3/4) DDoS는 앱 코드로 불가 → 인프라(Cloudflare) 1차 방어선(런북). 앱은 L7 백스톱 구현.

## 범위 (wt/sec-ddos, origin/main 기준)
- **전역 IP 플러드 리미터**: `lib/ddos-guard.ts`(순수·Edge호환·checkRateLimit 재사용) + `middleware.ts`(콜백 최상단 평가, 모든 경로). 기본 1000/분/IP, SSE(`/api/zalo/stream`) 제외, env 튜닝(`RATE_LIMIT_GLOBAL_MAX`)·킬스위치(`RATE_LIMIT_GLOBAL_DISABLED=1`)
- **요청 본문 크기 상한**: content-length > 30MB → 413(`MAX_REQUEST_BODY_BYTES`). 정상 업로드 최대 20MB보다 위
- **비용 엔드포인트 스로틀**: `lib/cost-throttle.ts`(사용자별 200/분, RATE_LIMIT 기록) → 번역·OCR·전사 3라우트
- **인프라 런북**: `docs/ops/ddos-protection.md`(Cloudflare proxied·WAF·rate-limit이 진짜 방어선)

## 완료 기준
- typecheck 0 · vitest 2135 통과(신규 7) · **build 통과(미들웨어 edge 번들 — prisma 미유입)** ✅
- 플러드: 1000/분 초과 429+Retry-After, IP 격리, SSE 제외, 본문 30MB 초과 413, 킬스위치 ✅
- 비용 스로틀: 3엔드포인트 사용자별 한도, 초과 429 ✅
- **자기-DoS 방지**: 넉넉한 한도 + env 무배포 튜닝/킬스위치 ✅
- 미들웨어 가드가 기존 인증·권한 게이트를 우회/손상하지 않음(플러드/초대형만 조기차단, 나머지 통과)

## 한계(문서화)
- 미들웨어 인메모리 = 인스턴스별(단일 컨테이너 가정). 다중 인스턴스/분산 플러드는 인프라(Cloudflare) 담당.
- 볼류메트릭 DDoS는 앱 무력 — Cloudflare 적용이 OPS 필수 액션.
