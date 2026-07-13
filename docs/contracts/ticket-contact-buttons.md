# 계약서 — 게스트 티켓 문의 안내에 카카오톡·전화 버튼 노출

## 배경
게스트 신청 내역 화면(/g/[token]/orders)의 티켓 문의 안내 박스(teal)에 지금은 안내 문구만 있다.
운영자가 카카오톡 채널을 개설했으므로 문구 아래에 카카오톡·전화 연결 버튼을 추가한다.
연락처는 DB AppSetting `CONTACT_KAKAO_URL`·`CONTACT_PHONE`에서 읽는다(만료 화면과 동일 원천).

## 범위 (3파일 + 계약서 + props 타입)
- `lib/guest-i18n.ts` — `result`에 라벨 2개(`ticketContactKakao`, `ticketContactPhone`) 타입 + 5개 언어(ko/en/ru/zh/vi).
- `app/g/[token]/orders/page.tsx` — OK 경로에서 티켓 주문이 있을 때만 `getContactSettings()` 조회 후 props 전달.
- `app/g/_components/guest-orders.tsx` — props 2개 추가, 티켓 안내 박스에 버튼 행 렌더.
- `app/g/_components/types.ts` — `GuestOrdersProps`에 `contactKakaoUrl?`·`contactPhone?` 추가.
- `docs/contracts/ticket-contact-buttons.md` — 본 계약서.

## 수정 금지 구역
위 목록 외 파일은 수정하지 않는다.

## 완료 기준 (테스트 가능)
1. 티켓 주문이 하나라도 있으면 안내 박스에 문구 + 버튼 행 노출.
2. 카카오 버튼 = teal 솔리드(`chat` 아이콘), 전화 버튼 = 아웃라인(`call` 아이콘).
3. `CONTACT_KAKAO_URL`/`CONTACT_PHONE`가 null/빈 문자열이면 해당 버튼 미노출. 둘 다 없으면 현행처럼 문구만.
4. 라벨 5개 언어 모두 존재(ko/en/ru/zh/vi).
5. 티켓 주문이 없으면 조회·박스 모두 미발생(불필요 쿼리 없음).

## 누수 점검
- 원가·마진·벤더 정보 노출 없음(연락처만). 데이터 변경 API 없음 → 감사 로그 불요.

## 검증 방법
- `npm run build` 통과(배포 빌드 게이트) + lint/typecheck.
- 코드 리뷰(QA): 버튼 노출 조건·라벨 5언어·null 가드.
