# T-zalo-chat-dnd-attach — Zalo 대화창 드래그앤드롭 첨부

## 범위
- `/messages` 대화창(ChatPane Composer)에 파일·사진 드래그앤드롭 첨부 추가
- 기존 붙여넣기(Ctrl+V) 이미지 미리보기 흐름을 "첨부 대기열"로 일반화 (이미지 + 일반 파일, 복수 허용)
- 업로드 파이프라인은 기존 재사용: 이미지 = resizeImage → share photo 경로 / 비이미지 = type=FILE 경로 (AttachMenu와 동일)
- i18n: `adminMessages.dragDrop` 키 ko/vi 동시 추가

## 수정 파일
- `app/(admin)/messages/chat-pane.tsx`
- `messages/ko.json`, `messages/vi.json` (키 추가만)

## 수정 금지 구역
- `worker/`, `lib/zalo-runtime*.ts`, `lib/zalo-inbound.ts`, `instrumentation.ts` (타 세션 WIP — ADR-0032 작업)
- `prisma/` 전체 (스키마 변경 없음)

## 완료 기준 (테스트 가능)
1. 대화창에 이미지 파일을 드래그하면 오버레이("여기에 놓아 첨부")가 뜨고, 드롭 시 미리보기 대기열에 추가된다 — 즉시 발송되지 않는다(오전송 방지 2단계 유지)
2. 비이미지 파일(PDF 등) 드롭 시 파일 아이콘 카드로 대기열에 추가되고, 전송 시 FILE 메시지로 발송된다
3. 복수 파일 드롭 시 순차 전송, 실패 항목부터 대기열에 남고 에러코드별 안내(fileError.*) 표시
4. 대화 전환 시 대기열 리셋(QA D1 패턴), objectURL 누수 없음(QA D2 패턴)
5. 텍스트 드래그(파일 아님)에는 오버레이가 뜨지 않는다
6. `next build` 통과

## 검증 방법
- typecheck + next build
- Playwright 프로덕션 검증(배포 후): 오버레이 표시·드롭 첨부는 실기기/브라우저 수동 확인 항목으로 보고
