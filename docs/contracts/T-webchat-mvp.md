# 계약서 — T-webchat-mvp: 홈페이지 다국어 웹 채팅 (MVP)

> 착수 2026-07-16 · 담당: 메인 세션(worktree-webchat) + BE/FE/INTEG/LOC/QA
> 기획 정본: docs/plans/webchat-multilingual.md (TDA·FE·INTEG 3자 회의 + QA·OPS 2차 감사 반영본)
> 스키마: ADR-0045 (본 태스크에서 작성)

## 범위 (MVP)

1. **스키마**: `WebChatSession` + `WebChatMessage` 신규 2테이블 — additive raw SQL(`prisma/migrations-manual/`), 금액 컬럼 없음
2. **API** (`/api/webchat/*`): 세션 원자 생성(Turnstile siteverify, 미설정 시 스킵 폴백)·방문자 발신(eager ko 번역)·방문자 폴링·운영자 답장(발송 직전 번역, 실패 시 **ko 원문 발송+실패 플래그**)·운영자 인박스·차단/해제·연락처 남기기. 전 변경 API writeAuditLog
3. **알림**: NotificationType `WEBCHAT_NEW_MESSAGE`(enum ALTER + zalo.ts switch case + GROUP_ROUTED_TYPES + NOTIFICATIONS.md 동시 갱신). 대화당 첫 메시지 즉시 + 후속 10분 디바운스
4. **위젯**: `/webchat/widget`(iframe 본체) + `public/webchat-loader.js`(버블 토글) + intro 3종 임베드(`?v=` 캐시버스팅) + Next 공개 홈. 스플래시 게이트 `/webchat` 제외. 5언어 자체 판정(p-locale→navigator.language→en), PII 고지 1줄, 오프라인 안내, 연락처 카드, 폴링 3~5s+유휴 백오프
5. **인박스**: /messages에 "웹 채팅" 탭(자체 커서 — Zalo 목록과 병합 금지), 원문+ko 병기, 답장, 차단 버튼, 열람 시 unread 리셋
6. **LOC**: 위젯 문구·오프라인 안내·PII 고지·3상태(paused/cap/expired) 문구 5언어(vi/ko/en/zh/ru) + admin 탭 ko/vi 키

## 완료 기준 (테스트 가능)

- [ ] 비로그인 방문자: 세션 생성→발신→운영자 답장 폴링 수신, 재방문 시 쿠키로 대화 복원
- [ ] 방문자 메시지 → ko 번역 저장(translatedText 캐시, 재호출 0) → Zalo 그룹 알림(ko 미리보기, 판매가·마진 미포함)
- [ ] 운영자 ko 답장 → 방문자 언어 번역 발송, 번역 실패 시 ko 원문+플래그(발송 누락 금지)
- [ ] BLOCKED 5종: 차단 API(+AuditLog)·차단 세션 폴링 403·발신 403·알림/번역 억제·인박스 필터
- [ ] 3상태 방문자 응답: WEBCHAT_PAUSED(안내 버블)·일일캡 초과(저장은 되되 번역 스킵+안내)·세션 만료(새 세션 유도)
- [ ] 스로틀: 세션 15msg/분·ipHash(HMAC-SHA256) 40msg/분·2000자 상한(서버 400)·ko/무문자 번역 스킵
- [ ] 일일 번역 카운터 = DB(AppSetting) — 재배포 후에도 유지
- [ ] 권한 누수 0: 방문자 payload 화이트리스트(타 세션·재고·KRW·마진 접근 불가), realtime-bus 신호만
- [ ] intro.html iframe에서 스플래시 미재생, 위젯 정상 동작
- [ ] WebChatSession에 lastMessageText 비정규화(인박스 N+1 금지)
- [ ] `npm run build` + lint + typecheck 통과

## 수정 금지 구역 (병렬 세션 보호)

- instagram-marketing-p1 관련 파일 일체 (타 세션 진행 중)
- prisma/schema.prisma 외 기존 모델 정의 변경 금지 (additive만)
- messages/ko.json·vi.json은 키 추가만

## 검증 방법

QA 독립 검증: 누수 체크리스트(웹챗 섹션 신설) + 완료 기준 전 항목 + 실제 200 렌더 확인. 작성자 자기평가 무효.
