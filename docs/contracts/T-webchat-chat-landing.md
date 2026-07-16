# 계약서 — T-webchat-chat-landing: 소비자 직행 채팅 페이지 /chat

> 착수 2026-07-16 · 약식 사이클(소규모 단일 라우트 — PR #314 선례) · 선행: T-webchat-mvp/expand
> 테오 지시: 소비자가 로그인창 없이 바로 채팅으로 연결되게

## 범위
1. 공개 라우트 `/chat` — 로그인 불필요, 위젯을 전체 화면으로 렌더(iframe 아닌 직접 렌더 허용). 모바일 우선(인스타 인앱 브라우저 유입)
2. `?src=` 쿼리(화이트리스트: ig·kakao·direct 등)를 sourcePage로 — 기본 `chat`. 전체 화면이므로 닫기 버튼은 불필요(뒤로가기)
3. 스플래시 게이트 `/chat` 제외 추가 (★필수 — 미제외 시 인스타 유입마다 2.3s 스플래시)
4. 운영자 인박스 parseSourcePage에 chat/ig 라벨 추가(ko/vi)
5. 완료 기준: 비로그인 모바일에서 villa-go.net/chat?src=ig 접속 → 즉시 채팅 UI·발신 가능·스플래시 없음·admin 미노출·tsc/build 통과

## 수정 금지 구역
- API·스키마 무변경, 기존 위젯 iframe 경로(/webchat/widget) 동작 불변
