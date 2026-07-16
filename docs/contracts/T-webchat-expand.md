# 계약서 — T-webchat-expand: 웹챗 운영자 3등급 개방 + 부착면 확장

> 착수 2026-07-16 · 담당: worktree-webchat 세션 (BE/FE/QA) · 선행: T-webchat-mvp(PR #324 배포됨)
> 테오 지시: ① admin 웹챗을 오너/매니저/직원 3그룹이 사용 ② 추천 부착면 전부 적용

## 범위

### A. 운영자 3등급 개방 (OWNER·MANAGER·STAFF — ADR-0013 RBAC)
1. /api/webchat 운영자 라우트 5종(inbox·sessions/[id]·reply·block + 후속) 가드를 `isSystemAdmin` → `isOperator`로 전환 (ADMIN은 transition 동일취급 포함)
2. **세션 스코프 = 조직 전체**: 운영자 웹챗 조회·답장·차단은 ownerAdminId 불문 전 세션 접근 (단일 조직 제품 — Zalo 인박스의 개인 스코프와 다름을 코드 주석·leak-checklist에 명시). ownerAdminId 컬럼은 알림 라우팅용으로 유지
3. **실시간 보치**: 웹챗 publish 대상을 시스템봇 소유자 1인 → 활성 운영자 3등급 전원으로 확장 (bounded fan-out)
4. /messages 페이지·admin 사이드바가 MANAGER/STAFF에게 열려 있는지 확인, isSystemAdmin 게이트면 isOperator로 완화 (Zalo 탭은 개인 스코프 유지 — 자기 대화 없으면 빈 목록이 정상)
5. reply의 sentBy는 실제 응답자 userId 기록(감사 추적) — 이미 구현돼 있으면 확인만

### B. 위젯 부착면 확장 (승인된 추천 3곳 전부)
6. **/g/[token] 4화면**(체크인·options·orders·receipt): 게스트 레이아웃 or 페이지 마운트, sourcePage=`g:<토큰 앞 8자>` (전체 토큰 DB 저장 금지)
7. **/p/[token] 4화면**(제안·book·done·roster): sourcePage=`p:<토큰 앞 8자>`
8. **auth 8화면**(login·signup 4종·forgot/reset): app/(auth)/layout.tsx 1곳, sourcePage=`auth`
9. 로더가 Next 라우트에서 동작하도록 필요 시 개선(currentScript 의존 제거 등) — 개선 시 intro 3종 `?v=` 버전업 동시
10. 모바일 FAB가 /g·/p 하단 고정 CTA·서명 캔버스와 겹치지 않게 오프셋 처리
11. 운영자 인박스 sourcePage 표시가 새 값(g:/p:/auth)에서 읽기 좋게

## 완료 기준
- [ ] MANAGER·STAFF 계정으로 웹챗 인박스 조회·답장·차단 가능(API 200), SUPPLIER/VENDOR/PARTNER는 403
- [ ] STAFF 접근 화면·응답에 금액 데이터 없음(웹챗은 구조적 무금액 — 확인만)
- [ ] 신규 웹챗 메시지 도착 시 3등급 전원 SSE 신호 수신
- [ ] /g·/p·auth 화면에서 위젯 오픈·발신 동작, admin(dashboard 등)에는 미표출
- [ ] sourcePage에 토큰 전체 미저장(앞 8자 프리픽스만)
- [ ] /g 모바일에서 FAB·하단 CTA 겹침 없음
- [ ] Zalo 인박스(개인 스코프) 회귀 없음
- [ ] tsc·build 통과, QA 독립 검증

## 수정 금지 구역
- 인스타그램 P1 파일 일체, Zalo 대화 스코프 로직(ownerAdminId), prisma 스키마(이번엔 변경 불요)
