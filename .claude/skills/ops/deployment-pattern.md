# Skill: 배포·환경 관리 패턴 (Railway + Neon)

## 환경변수 관리
- 키 목록은 CLAUDE.md "환경 변수" 섹션이 원본 — 새 키 추가 시 CLAUDE.md + .env.example + Railway 대시보드 3곳 동기화
- .env.example에는 키 이름만, 값은 비움. 실제 값은 절대 커밋 금지
- 환경별 분리: 로컬(.env) / Railway(production variables) — DATABASE_URL은 Neon branch로 분리 (dev/prod)

## 배포 절차 (체크리스트)
1. `npm run lint && npm run typecheck` 통과 확인
2. 미적용 마이그레이션 확인 (`npx prisma migrate status`) — 있으면 TDA 승인 여부 확인 후 적용
3. Railway 배포 → 빌드 로그에서 prisma generate 성공 확인
4. 스모크 테스트 3종: ① ADMIN 로그인 ② SUPPLIER 홈(vi) 렌더 ③ 무효 토큰 /p/xxx → 404/만료 안내
5. 결과를 PM에 보고 (URL·버전·마이그레이션 여부)

## Cron (Railway)
- 등록 대상: 홀드 만료 처리(5분 ✓), iCal 수신 동기화(30분 ✓), Zalo 발송 재시도(10분 — T3.5에서 등록)
- 모든 cron 라우트는 `Authorization: Bearer ${CRON_SECRET}` 검증 — 검증 없는 cron 라우트는 배포 차단
- cron 실패는 조용히 죽지 않게: 실패 시 로그 + (Phase 1은 콘솔, Phase 2는 ADMIN 알림)
- **등록 방식 (확정 패턴, 2026-06-11)**: 프로젝트에 `curlimages/curl` Docker 이미지 미니 서비스 추가 →
  Custom Start Command `sh -c 'curl -fsS -m 120 -H "Authorization: Bearer $CRON_SECRET" https://villa-pms-production.up.railway.app/api/cron/<이름>'` +
  Cron Schedule 입력 + Variables에 `CRON_SECRET=${{villa-pms.CRON_SECRET}}` 참조. 도메인 생성 금지(외부 접근 불필요).
  **`sh -c '...'` 래핑 필수** — 아래 교훈 참조. 현재 가동(2026-06-26 6개): `cron-ical-sync`(*/30)·`cron-expire-holds`(*/5)·`cron-notifications`(*/5)·`cron-partner-overdue`(0 0 * * *)·`cron-roster-reminder`(0 1 * * *)·`cron-periodic-cleaning`(0 2 1 * *) — 실행 이력은 각 서비스 Cron Runs 탭. 상세 등록 런북: docs/ops/cron-registration.md
  - **빈 서비스로 만들 때 함정(2026-06-26)**: Docker 이미지는 Settings §Source의 **Connect Image** 버튼으로 넣는다(그 아래 **Root Directory** 칸 아님 — 거기 넣으면 시작명령 칸이 안 생긴다). 2번째부터는 기존 cron 서비스 **Duplicate(복제)** 후 URL·스케줄·이름만 변경이 최단(이미지·변수·명령 형식 상속).

## PWA
- TravelDiary 패턴 재사용 (reference/ 폴더, [SHARED-MODULE] 주석 표기)
- manifest: 공급자용 이름은 vi, 운영자는 별도 진입점 불필요 (PC 위주)
- 이미지 업로드가 핵심이므로 오프라인 캐시는 조회 화면만 — 업로드는 온라인 전제

## 교훈 축적
- **(T1.6/T2.4 cron 등록, 2026-06-11) Start Command의 `$VAR`는 반드시 `sh -c '...'`로 감쌀 것** — Deploy 직후의 1회 실행은 셸 확장이 되지만, **스케줄에 의한 자동 실행은 확장 없이 리터럴 `$CRON_SECRET`를 전송**해 매번 401(curl -f → 실패)이 난다. 직후 실행만 보고 성공으로 판단하면 안 됨. 증상: Run now·초기 배포는 성공, 정각 실행만 연속 실패
- **cron 검증 4단계**: ① 무인증 curl 401(라우트 게이트) ② 시크릿 포함 수동 호출 200+요약 JSON ③ Run now 성공 ④ **스케줄 트리거 자동 실행 성공**(Cron Runs 탭 초록 / `railway deployment list --json`) — ③과 ④는 실행 경로가 달라 둘 다 확인해야 한다. 변수는 Deploy 전에 넣기(직후 1회 실행 실패 방지)
- **cron 라우트 모범 패턴 (T1.6 ical-sync)**: ① CRON_SECRET 미설정 시 500 — 무인증 개방 금지 ② Bearer 검증이 어떤 DB 접근보다 선행 ③ `export const dynamic = "force-dynamic"` (GET 캐싱 방지) ④ 엔티티 단위 실패 격리(한 건의 예외가 전체 cron 중단 금지) ⑤ 요약 JSON 반환 + 에러·충돌은 console.error (Phase 1)
