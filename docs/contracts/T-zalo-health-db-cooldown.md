# T-zalo-health-db-cooldown — 워치독 경보 쿨다운 영속화

> 착수: 2026-07-09. 테오 보고: "Jini QR 재로그인 경보가 계속 반복" (16:45·17:40·18:50·19:15·20:05).

## 원인 진단
- 워치독 쿨다운(6h)이 `globalThis` Map **인메모리** — 배포 재시작마다 리셋.
- 오늘 PR 5건 배포(재시작 5회) → 매 재시작 후 2회 연속 점검(~10분) 시점에 재경보. 경보 시각이 배포 시각과 일치.
- Jini 계정 자체는 진짜 미연결(credential 만료) — 경보 내용은 정당, 빈도가 문제.

## 범위
- lib/zalo-health.ts: 경보 발송 시각을 AppSetting(`zalo-health:last-alert:<accountId>`)에 영속화.
  경보 직전 DB의 마지막 경보 시각이 쿨다운(6h) 이내면 발송 억제 + 인메모리 동기화(이후 DB 재조회 없음).
- tests/zalo-health.test.ts: 재시작 시뮬레이션(fresh Map + DB 최근 경보 → 무경보) / 쿨다운 경과 → 발송+upsert.

## 완료 기준
1. 재시작(새 Map) 후에도 6h 내 재경보 없음 (테스트로 증명)
2. 쿨다운 경과 시 정상 경보 + AppSetting 갱신
3. DB 읽기/쓰기 실패는 경보 동작을 깨지 않음 (fail-open)
4. 기존 테스트·typecheck·build 통과

## 수정 금지 구역
- prisma/schema.prisma (AppSetting 기존 모델 재사용, 스키마 무변경)
- worker/ (ADR-0032)
