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
- 등록 대상: 홀드 만료 처리(5분), iCal 수신 동기화(30분), Zalo 발송 재시도(10분)
- 모든 cron 라우트는 `Authorization: Bearer ${CRON_SECRET}` 검증 — 검증 없는 cron 라우트는 배포 차단
- cron 실패는 조용히 죽지 않게: 실패 시 로그 + (Phase 1은 콘솔, Phase 2는 ADMIN 알림)

## PWA
- TravelDiary 패턴 재사용 (reference/ 폴더, [SHARED-MODULE] 주석 표기)
- manifest: 공급자용 이름은 vi, 운영자는 별도 진입점 불필요 (PC 위주)
- 이미지 업로드가 핵심이므로 오프라인 캐시는 조회 화면만 — 업로드는 온라인 전제

## 교훈 축적
- **cron 라우트 모범 패턴 (T1.6 ical-sync)**: ① CRON_SECRET 미설정 시 500 — 무인증 개방 금지 ② Bearer 검증이 어떤 DB 접근보다 선행 ③ `export const dynamic = "force-dynamic"` (GET 캐싱 방지) ④ 엔티티 단위 실패 격리(한 건의 예외가 전체 cron 중단 금지) ⑤ 요약 JSON 반환 + 에러·충돌은 console.error (Phase 1)
