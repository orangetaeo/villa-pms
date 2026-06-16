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
- (2026-06-11 T2.2 QA) **미신고 디자인 편차는 합리적이어도 반려 대상** — 디자인 export와 다른 구현(버튼 수 축소·배경 단순화·요소 누락)은 그 자체가 타당해도 계약서 "디자인 편차" 절에 명시 없으면 충실도 기준 미달로 반려. 변환 중 즉석 판단이 생기면 코드가 아니라 계약서에 먼저 적을 것.
- (2026-06-11 T2.1-FE QA) **상태 전이 API는 read-then-write 금지 — 조건부 updateMany가 표준**: PATCH revoke가 findUnique→유효성 검사→update({where:{id}})로 구현되면, 검사와 쓰기 사이에 HOLD가 ACTIVE→USED를 커밋했을 때 update가 USED를 REVOKED로 덮어씀(가예약 살아있는데 제안은 회수됨). lib/hold.ts의 `updateMany({where:{id, status:ACTIVE}})` + count 검사(QA D-1)가 이미 코드베이스 표준 — 모든 상태 전이 route 검토 시 "update의 where에 기대 상태가 들어있는가"를 grep으로 확인할 것.
- (2026-06-11 T2.1-FE QA) **타임스탬프 표기는 ISO slice 금지** — createdAt 같은 timestamp를 `iso.slice(0,10)`으로 자르면 UTC 날짜가 나와 VN 17시 이후 생성 건은 하루 어긋남(CLAUDE.md: Asia/Ho_Chi_Minh 표시 규칙). @db.Date 컬럼(checkIn 등)만 slice 허용. 검토 시 slice(0,10) 사용처마다 "원본이 Date-only인지 timestamp인지" 구분 판정.
- (2026-06-11 T3.5 QA) **Windows에서 vitest가 전 파일 `Cannot read properties of undefined (reading 'config')`로 즉사하면 드라이브 문자 대소문자부터 의심** — cwd가 소문자 `c:\...`면 러너 모듈이 이중 로딩되어 describe()가 깨짐(코드 회귀로 오판하기 쉬움). `cmd /c "cd /d C:\Projects\... && npm test"`처럼 대문자 드라이브로 실행하면 정상. 최소 smoke 테스트 1개로 "전부 실패 = 환경, 일부 실패 = 코드"를 먼저 분리할 것.
- (2026-06-11 T3.5 QA) **cron 디스패치 QA는 큐에 남아있던 타 태스크의 PENDING도 함께 소비함** — summary 건수가 기대보다 크면 내 테스트 데이터 오염이 아니라 기존 큐 잔량인지 먼저 inspect로 구분. 정리(cleanup)는 반드시 내 qaTag 붙은 레코드만 삭제하고, 타 레코드의 상태 전이는 정상 처리이므로 되돌리지 않는다(테스트 데이터에 qaTag 같은 식별자를 payload에 심는 것을 표준으로).
- (2026-06-11 T2.2 QA) **globals.css 동결 계약 시 디자인 보조 클래스는 컴포넌트 안에서 해결** — export의 .no-scrollbar·bg-mesh 같은 커스텀 클래스를 globals.css에 못 넣는 병렬 세션 상황에서는 Tailwind arbitrary variant(`[&::-webkit-scrollbar]:hidden`)나 컴포넌트 인라인 스타일 상수로 구현. 정의 없는 클래스명을 그대로 옮겨 적으면 조용히 무시됨(공허 통과의 CSS판).

- (2026-06-11 T3.1 QA) **비공개 파일을 공개 정적 디렉터리 하위에 두지 않는다** — 여권 사진을 ADMIN 가드 라우트로 서빙해도 저장 위치가 `public/uploads/` 하위면 Next 정적 서빙이 가드를 통째로 우회(헤더·인증 모두 무시). 가드 라우트의 보안은 저장 경로가 정적 서빙 범위 밖일 때만 성립 — 비공개 파일은 기본 경로부터 `public/` 밖(`private/` 또는 volume)으로 분리하고, 환경변수 미설정 폴백 경로까지 점검할 것.
- (2026-06-11 T4.5 QA) **NextIntlClientProvider에 messages 전체를 넘기면 i18n 사전 자체가 누수 벡터** — 루트 layout의 `getMessages()` 전체 직렬화 + (supplier) layout의 전체 JSON 전달이 겹쳐, 공급자 /earnings HTML에 adminVillas/adminProposals의 "마진"·"총 판매가" 라벨(ko·vi 양쪽)이 노출됐음. 값이 아닌 라벨이라도 운영 구조(마진 존재) 노출 + 계약 grep 기준 위반. 표준: 구역 레이아웃별 **네임스페이스 화이트리스트**(lib/intl-messages.ts pickMessages)로만 클라이언트 전달, 루트는 `messages={{}}`. 검사법: SUPPLIER 세션 HTML에서 `grep -oiE "colmargin|marginsummary|totalsale|saleprice"` — 단 next-error 인라인 CSS의 `margin:0`은 오탐이므로 컨텍스트 확인.
- (2026-06-11 T4.5 QA) **원격 DB + interactive $transaction 기본 5s 타임아웃** — 트랜잭션 내부의 행위자별 순차 N+1 쿼리(공급자마다 findUnique→deleteMany→create)는 행위자 수×왕복 지연에 비례. 공급자 2명·왕복 ~500ms 프록시에서 이미 P2028로 전멸했음. 집계류 트랜잭션은 ① 왕복 상수화(`in` 일괄 조회·일괄 deleteMany·쓰기 Promise.all) ② `{ timeout, maxWait }` 옵션 둘 다. QA 관점: 로컬→Railway 공개 프록시 환경은 의도치 않은 지연 부하 테스트 — "프로덕션에선 빠르니까"로 면제하지 말 것.
- (2026-06-11 T4.5 QA) **새 페이지 라우트가 생기는 태스크는 middleware.ts 경로 맵을 함께 검사** — /earnings가 PROTECTED_PATHS·ROLE_ALLOWED_PATHS.SUPPLIER·locale 쿠키 목록에서 전부 누락 → 미인증 차단이 페이지 가드 단독 의존 + locale 쿠키 없는 직접 진입 시 베트남 공급자에게 **한국어 렌더**. 부수 발견: `getTranslations({locale})`의 명시 locale 인자는 cookie 기반 request config의 메시지 번들을 바꾸지 못함 — 코드 주석을 믿지 말고 쿠키 없는 세션으로 실렌더 검증할 것.
- (2026-06-11 T4.5 QA) **병렬 세션 활성 중 tsc 실패는 소유권부터 분리** — 평가 도중 타 세션(T3.8)이 파일을 쓰는 순간 `Cannot find module './cleaning-submit'`로 tsc가 깨짐(해당 모듈이 1분 뒤 생성됨). 실패 파일이 내 평가 범위 밖이면 mtime·git status로 병렬 작업임을 확인하고 재실행으로 판정. 또한 `/tmp`의 node 스크립트는 프로젝트 node_modules를 못 찾으므로(ERR_MODULE_NOT_FOUND) QA 스크립트는 프로젝트 내부 임시 폴더(qa-tmp/, 종료 시 삭제)에 둘 것.
- (2026-06-11 T3.8 QA) **동적 슬롯 UI ↔ 고정 상한 API 정합 검사** — UI가 빌라 속성으로 슬롯을 동적 생성(buildPhotoSlots: 최대 3+20+20+1+1=45)하는데 소비 API zod가 고정 상한(submit `max(30)`)이면, 스키마 상한(bedrooms/bathrooms `max(20)`)을 채운 빌라에서 전 슬롯 업로드 완료 후 제출이 400으로 막히는 잠복 결함이 됨. 배열을 받는 API 검토 시 "상한이 입력을 생성하는 쪽의 이론적 최대치 이상인가"를 짝으로 확인할 것.

- (2026-06-16 T4.1 전수 스윕) **공개 페이지 margin grep은 `next-error-h1` 인라인 CSS가 영구 오탐원** — `notFound()`를 import하는 모든 페이지의 RSC payload에 Next가 기본 에러 컴포넌트 CSS `"style":{...,"margin":"0 20px 0 0",...}`를 포함시킴. 기존 회피식 `replace(/margin[:-]/g,"")`는 JSON 따옴표(`"margin":`)를 못 거름 → `margin"` 잔존으로 오탐. 표준 판정식: **실제 누수 키만 grep** `/supplierCost|salePrice|marginValue|marginType|fxVndPerKrw|원가|수수료/i` (단독 `margin`·`margin:` 금지). 매치 시 반드시 ±60자 컨텍스트를 떠서 next-error/Tailwind variant인지 확인 후 판정.
- (2026-06-16 T4.1 전수 스윕) **QA 테스트 스크립트의 페이로드 casing이 실패 원인일 수 있다** — revoke 검증이 `{action:"REVOKE"}`(대문자)를 보냈으나 API zod는 `z.literal("revoke")`(소문자)라 400 반환 → 제안이 안 회수되어 "REVOKED 페이지에 빌라명 잔존" "hold가 201" 두 건이 연쇄 FAIL로 보임. **앱 결함처럼 보이는 다중 FAIL이 한 요청의 4xx에서 파생되면 그 요청부터 의심**. 스크립트가 받은 응답 바디(`{"error":"invalid_input"}`)를 로그에 항상 찍어두면 즉시 판별됨.
- (2026-06-16 T4.1 전수 스윕) **재고 시드 충돌 → 날짜를 옮겨라(데이터 삭제 금지)** — 동시성/USED 테스트가 만든 HOLD가 같은 빌라를 점유하면 후속 제안 시드가 `BOOKING_OVERLAP` 409로 실패. 이건 availability가 정상 작동한 증거이므로, HOLD를 지우지 말고 **비충돌 먼 미래(2027+) 날짜**로 시드를 옮길 것. half-open 경계 검증(back-to-back 7/13-7/15가 7/10-7/13 직후 생성됨)도 같은 방식으로 양성 실증.
- (2026-06-16 T4.1 전수 스윕) **병렬 세션의 stale Prisma client 500을 권한 결함으로 오판 말 것** — 신규 페이지 `/my-villas/[id]`가 owner에게도 500. 로그는 `Unknown field rejectionReason for select on Villa`. 그러나 디스크의 schema(80행 rejectionReason)·생성된 client(index.d.ts 4706행)·page(42행 select)는 **모두 정합**했고 fresh PrismaClient로 동일 쿼리 성공 → 실행 중 dev 서버(타 세션 소유, T1.2b 구현 중)가 재기동 전 옛 client를 메모리에 들고 있던 것. 판정: 누수 아님·평가 범위 밖(소유권 분리). 신규 라우트의 정적 가드(`villa.supplierId !== supplierId → notFound`)는 정합하므로 재기동 후 정상. **500이 owner에게도 나면 leak이 아니라 functional/환경 — 스택트레이스 출처(디스크 vs 실행 프로세스)를 먼저 가를 것.**
