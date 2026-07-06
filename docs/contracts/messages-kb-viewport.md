# 계약: /messages 모바일 키보드 첫 포커스 시 입력창 가림 수정

- **브랜치**: `wt/messages-kb-viewport`
- **버그 (테오, 2026-07-06, iPhone Safari 스크린샷 2장)**: 채팅을 처음 열고 입력창을 탭하면 키보드는 올라오는데 입력창이 키보드 뒤에 가려 안 보임. 빈 곳을 탭해 키보드를 내렸다가 다시 탭하면 그때는 정상(사파리가 두 번째부터 화면을 팬).
- **원인**: /messages 컨테이너가 `h-[calc(100dvh-7.5rem)]` 고정 — iOS는 키보드가 떠도 layout viewport(100dvh)를 줄이지 않고 visual viewport만 줄인다. 첫 포커스에서 사파리의 자동 팬이 동작하지 않으면 입력창(컨테이너 하단)이 키보드 아래 남는다.

## 범위
- `messages-client.tsx`: visualViewport 추적 — 모바일(<lg)에서 키보드 열림(innerHeight−vv.height>150px) 감지 시 컨테이너 인라인 height = vv.height − 헤더(3.5rem)로 축소 + `window.scrollTo(0,0)`으로 사파리 팬 상쇄(고정 헤더 유지). 키보드 닫히면 원복(인라인 제거). 데스크톱 무영향.
- `chat-pane.tsx`: visualViewport resize 시 스레드가 바닥 근처였으면(atBottomRef) 바닥 유지(scrollToBottom) — 키보드로 높이가 줄어도 최신 메시지가 보이게.

## 완료 기준
1. tsc·vitest·build 통과. 데스크톱(lg+) 렌더 경로 변화 0(인라인 height는 모바일 키보드 열림에만 부여).
2. 코드 리뷰 기준: visualViewport 리스너 등록/해제 누수 0, vv 미지원 브라우저 무해(early return).
3. 실기기(iOS) 검증은 배포 후 사용자 확인 — 에뮬레이션으로는 iOS 키보드 팬 재현 불가함을 명시.

## 수정 금지 구역
- chat-pane 발송·번역·붙여넣기 로직, 다른 포털 레이아웃.
