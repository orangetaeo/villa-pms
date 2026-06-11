# Skill: QA 검토 체크리스트

## 권한 누수 4종 (매 검토 필수)
1. SUPPLIER가 타인 villaId로 접근 → 403 확인
2. SUPPLIER 응답 JSON에 salePriceKrw/margin* 포함 여부 grep
3. 만료/REVOKED 토큰으로 /p/[token] 접근 → 만료 화면 확인
4. 비로그인으로 보호 API 호출 → 401 확인

## 도메인 검증
- HOLD 동시성: 동일 빌라·날짜 동시 2건 요청 → 1건만 성공
- half-open: checkOut일 = 다음 checkIn일 예약 가능
- 검수 게이트: 체크아웃 → isSellable=false, 승인 전 제안 생성 목록에 미노출
- 금액: Float 사용 grep, 정산 합계 = 항목 합
- BigInt 직렬화 오류 (JSON.stringify throw)

## 교훈 축적 (발견 버그 → 패턴화하여 추가)
- (2026-06-11 T5.2 디자인 재검수) Stitch export HTML에 마크다운 펜스(```html / ```)가 본문에 섞여 들어오고 <head>가 비면서 <meta charset>이 body로 밀리는 경우 발생(c2) → 브라우저 캡처에서 한글 전체가 깨짐. export 저장 직후 ① 첫/끝 줄 펜스 grep ② 빈 <head></head> grep을 전 폴더 정적 검사에 포함할 것.
- (2026-06-11 T5.2 디자인 재검수) screenshot.png가 실제로는 JPEG이거나 폭 106~152px 저해상도인 경우(c3, c2) 글자 크기·대비 평가 불가 → 스크린샷 수령 기준: PNG + 폭 226px 이상. 미달 시 채점 보류 + 재캡처 요구 (코드 리뷰만으로 통과 금지 원칙의 디자인판).
- (2026-06-11 T5.2 디자인 재검수) 용어 금지어 grep 시 NOTES.md·README.md의 "금지 규칙 설명 문장"이 오탐됨 → HTML만 검사하려면 glob **/*.html로 한정.
