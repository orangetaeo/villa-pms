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
- (2026-06-11 2라운드 최종 검수) `overflow-x-auto` 테이블은 정적 스크린샷에서 마지막 열이 잘려 시각 검증이 불가(b10 "판매가 KRW 환산" 5열째) → 스크린샷만 믿지 말고 HTML `<th>` 개수와 스크린샷 노출 열 수를 반드시 대조. 열 누락처럼 보여도 스크롤 가능 여부(overflow 래퍼)를 먼저 확인.
- (2026-06-11 2라운드 최종 검수) 영어 잔존·하이픈 날짜 grep은 비가시 텍스트가 오탐됨 — img alt/data-alt(이미지 생성 프롬프트), HTML 주석, material icon명(`bathroom` 등), CSS 주석의 작성일 → 매치 컨텍스트를 열어 "렌더링되는 텍스트인지" 확인 후 판정할 것.
- (2026-06-11 T1.1 QA) 파일 업로드 확장자를 클라이언트 MIME에서 fallback 유도(`mimeType.split("/")[1]`)하면 stored XSS 벡터가 됨 — `Content-Type: image/svg`(비표준)로 위장 업로드 시 `.svg`로 저장되고 정적 서버가 image/svg+xml로 응답해 SVG 내 스크립트가 동일 출처에서 실행됨. 업로드 검증은 반드시 **MIME 화이트리스트(사전에 있는 키만 허용, fallback 금지)** + 가능하면 매직바이트 검사. `startsWith("image/")` 검사만으로는 불충분.
- (2026-06-11 T1.1 QA) 업로드 파일명 안전 패턴(재사용 가능): `Date.now()-새니타이즈된 uploaderId-randomUUID().ext` — 사용자 입력이 파일명에 들어갈 때는 `[^a-zA-Z0-9_-]` 전부 제거하면 path traversal 원천 차단됨. 단 확장자도 동일하게 새니타이즈+화이트리스트 필요(위 항목).
- (2026-06-11 T1.7 QA) lib/pricing.ts `StayQuote`는 공급자 원가(totalSupplierCostVnd·nightly[].costVnd)를 항상 포함 — 소비처(T2.1 제안·T2.3 HOLD·/p/[token])가 이 객체를 ADMIN 외 응답에 그대로 직렬화하면 마진 역산 가능한 원가 누수. 견적 객체를 반환하는 모든 route에서 "판매가 필드만 추려 매핑했는지" 검사할 것.
- (2026-06-11 T1.2 QA) **공허 통과(vacuous pass) 주의**: DB에 공급자가 1명뿐이면 "SUPPLIER가 타인 빌라 미노출" 테스트가 데이터 부재만으로 통과해 버림 — 스코프 검사는 반드시 **제2 공급자 + 빌라를 시드한 뒤** 교차 조회로 실증할 것 (이번엔 0900000003 시드 후 SUPPLIER1 응답에 타인 villaId 부재 + ADMIN 응답에 2건 모두 존재를 동시 확인).
- (2026-06-11 T1.2 QA) 마진 누수 grep은 응답 JSON 원문에 `grep -oiE "margin|saleprice"`로 **키 이름 자체**를 훑는 게 가장 빠르고 확실 — 필드 값이 0이어도 키가 있으면 누수다. select 화이트리스트(BE)와 응답 grep(QA)의 이중 확인을 표준으로.
- (2026-06-11 T1.2 QA) Windows에서 dev 서버가 떠 있으면 `prisma generate`가 query engine DLL rename EPERM으로 실패 → `npm run build` 검증 전에 dev 프로세스를 내리고, 빌드 후 재기동할 것.
- (2026-06-11 T1.7 settings QA) Windows git-bash에서 `curl -d '{"label":"한글"}'` 인라인 바디는 CP949 바이트로 전송돼 DB에 깨진 문자열이 그대로 저장됨 — 앱의 인코딩 버그로 오판하기 쉬움. 한글 페이로드 검증은 node로 UTF-8 JSON 파일을 만들어 `--data-binary @file`로 보내고, 판정도 콘솔 출력이 아닌 node에서 `===` 문자열 비교로 할 것.
- (2026-06-11 T1.7 settings QA) 장시간 떠 있던 dev 서버가 "Jest worker child process exceptions" 상태로 좀비화되면 모든 라우트가 500을 반환 — 로그인 500을 권한 버그로 오판하지 말 것. 동적 테스트 전 `/api/auth/csrf`가 200 + JSON인지 먼저 확인하고, 아니면 dev 재기동 후 진행.
- (2026-06-11 T1.8 QA) SSR HTML에서 `disabled` **속성** 검증 시 `/disabled/` grep은 Tailwind `disabled:cursor-not-allowed` 등 **variant 클래스에 전부 오탐**됨(8/8 disabled로 보임) — `class="..."`를 제거한 뒤 `\sdisabled(=""|\s|>)`로 판정할 것. React SSR은 boolean true 속성을 `disabled=""`로 출력함. (이번 실측: 스위치 8개 중 본인 행 2개만 속성 disabled — 정상)
- (2026-06-11 T1.8 QA) i18n 페이지 HTML 검증은 **검증 문자열을 추측하지 말고 messages/ko.json의 실제 값을 먼저 읽고** 대조할 것 — "운영자"로 검사했으나 실제 키 값은 "관리자"라 렌더 정상인데 미검출로 오판할 뻔함.
- (2026-06-11 T2.1 QA) **신형 컬럼 타입이 직렬화 유틸을 통과하는지 매번 확인** — Prisma.Decimal(fxVndPerKrw)이 serializeBigInt의 일반 객체 순회에 걸려 내부 구조 `{s,e,d}`로 응답됨. FX 미설정 환경에선 null이라 증상이 안 보이는 "공허 통과" — 새 타입(Decimal·Bytes 등) 컬럼이 응답에 처음 등장하는 태스크는 해당 타입 인스턴스로 직렬화 단위 테스트를 동반할 것 (수정: serialize.ts에 Prisma.Decimal.isDecimal 분기).
