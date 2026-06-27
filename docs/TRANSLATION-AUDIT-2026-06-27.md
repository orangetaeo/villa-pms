# 번역·다국어 체계 전수 점검 (2026-06-27)

> 요청: "번역 기능 — ko/vi 기본 정상 여부, 상황별 ru/en/zh 정상 표시 여부, 실시간 번역 vs 미리 번역의 중복·자원 낭비, '언어변경 버튼과 별개의 또 다른 번역 버튼' 정체"를 점검하고 문서화.
> 결론 한 줄: **번역은 3개의 독립 레이어로 깔끔하게 분리돼 있고 ko/vi·5개 언어 모두 정상.** 런타임 번역 중복은 거의 없으나 **채팅 발송 1건당 Gemini 2회 호출(미리보기+본발송)** 1건만 실질 낭비. "또 다른 번역 버튼"은 **Zalo 채팅(/messages) 헤더의 번역 드롭다운(OFF/VI/EN)**.

---

## 0. 한눈에 보는 3-레이어 구조

번역은 서로 **목적·비용·트리거가 다른 3개 레이어**로 분리돼 있다. 이 분리가 핵심이고, 서로 중복되지 않는다.

| 레이어 | 무엇 | 지원 언어 | 비용 | 트리거 | 스위처 |
|---|---|---|---|---|---|
| **L1. 앱 UI 정적 i18n** (next-intl) | 로그인 앱의 화면 라벨 | **ko / vi** (2개) | 0 (정적 JSON) | 언어 토글 | LocaleSwitcher / AdminSidebar |
| **L2. 공개·게스트 정적 i18n** (자체 딕셔너리) | /p 제안·/g 게스트 화면 라벨 | **ko / en / ru / zh / vi** (5개) | 0 (정적 TS 딕셔너리) | 언어 선택기(지구본) | LangSelector / guest-flow |
| **L3. 동적 콘텐츠 번역** (Gemini API) | 채팅 메시지·빌라명·서비스명·동의서·OCR | ko↔vi/en/zh/ru | **API 호출** (일부 DB 캐시) | 자동/버튼 | (스위처 아님) |

- **L1·L2는 사람이 미리 작성한 정적 번역**이라 런타임 API 비용이 0. 화면 라벨은 전부 여기 속한다.
- **L3만 Gemini를 실제로 호출**한다. 사용자가 입력하거나 운영자가 등록한 "데이터"를 번역할 때만.
- 쿠키도 분리: L1 = `locale`(ko/vi), L2 = `p-locale`(5개 언어). 미들웨어가 L1만 매 요청 산출.

---

## 1. L1 — 앱 UI 정적 i18n (next-intl, ko/vi) ✅ 정상

로그인 사용자(운영자·공급자·파트너·벤더·청소) 화면. **베트남어 기본, 한국어 토글.**

- 설정: [next.config.ts:4](../next.config.ts) → [i18n/request.ts](../i18n/request.ts) 가 `locale` 쿠키만 읽음(기본 ko)
- locale 결정 우선순위는 [middleware.ts](../middleware.ts)가 경로별로 산출:
  - 운영자: `pref-locale > 계정 locale > ko`
  - 공급자/인증: `pref-locale > 계정 locale > vi`
  - 파트너: `pref-locale > 계정 locale > ko`
- 번들: [messages/ko.json](../messages/ko.json) · [messages/vi.json](../messages/vi.json)
  - **둘 다 3,654줄 · 59개 네임스페이스로 완전 대칭** (구조 누락 없음) ✅
  - vi.json에 한글 잔존은 **3개뿐이며 전부 의도된 것**(한국식 상품명 입력 플레이스홀더 `nameKoPlaceholder`: `adminMinibar`·`adminVendors`·`adminServices`). 번역 누락 아님.

**판정: ko/vi 기본 설정 건강함.** 구조 대칭·미번역 잔존 사실상 0.

> ⚠️ 단, **L1은 ko/vi 2개 언어만 지원**한다. en/ru/zh 메시지 번들은 존재하지 않는다. 로그인 앱 화면에서는 영어·러시아어·중국어가 나오지 않는 것이 **설계상 정상**(공급자는 베트남인, 운영자는 한국인).

---

## 2. L2 — 공개·게스트 정적 i18n (5개 언어) ✅ 정상

ru/en/zh가 "나와야 하는 페이지"가 바로 여기다. **비로그인 외부 손님(한국 여행객·여행사·외국 게스트)** 대상.

- 딕셔너리: [lib/public-i18n.ts](../lib/public-i18n.ts) — `PublicLang = ko|en|ru|zh|vi`, 5개 언어 라벨을 **손으로 전부 작성**(API 호출 0)
- 적용 화면:
  - **/p/[token]** 제안·가예약·완료·명단 (여행사·여행객용)
  - **/g/[token]** 게스트 셀프 체크인·부가옵션
- 언어 선택 방법(스위처):
  - **/p**: [app/p/_components/lang-selector.tsx](../app/p/_components/lang-selector.tsx) — 지구본 아이콘 + 모국어 라벨(한국어/English/Русский/中文/Tiếng Việt)
  - **/g**: [app/g/_components/guest-flow.tsx:432](../app/g/_components/guest-flow.tsx) · [guest-options.tsx:292](../app/g/_components/guest-options.tsx) — 동일 패턴
  - 선택 시 **`p-locale` 쿠키(1년) + `?lang=` 쿼리** 동시 갱신 → 서버 재렌더
- 언어 해석 우선순위: `?lang= > p-locale 쿠키 > ko` ([resolvePublicLang](../lib/public-i18n.ts))

**판정: ru/en/zh 정상 동작.** 5개 언어 선택기로 전환되며 라벨·날짜·요일·통화기호까지 언어별 처리됨.

> ⚠️ ru(러시아어)는 2026-06-25 1차 감수만 반영. **원어민 최종 감수는 미완**(코드 주석에 `TODO: ru-native-review` 명시). 동작은 정상, 문구 품질만 추후 보강 대상.

### 2-b. 게스트 가격의 언어별 환율 환산 (L2에 부속)

게스트 부가옵션 화면은 **금액을 VND로 표기**하고, 하단 합계에만 언어 모국통화로 "≈ 오늘 환율" 보조 표기:

- [lib/fx-rates.ts](../lib/fx-rates.ts) `CURRENCY_BY_LANG` = `ko→KRW · en→USD · ru→RUB · zh→CNY · vi→null(환산 없음)`
- 환율은 open.er-api.com에서 **하루 1회 캐시**(AppSetting), 장애 시 마지막 캐시 폴백 → API 낭비 없음 ✅
- 환산값은 **표시용 근사치("≈")**, 저장·정산은 항상 VND

---

## 3. L3 — 동적 콘텐츠 번역 (Gemini, 실시간 vs 미리저장)

여기만 실제 Gemini API를 호출한다. **실시간(매번 호출)** 과 **미리 번역해 DB 저장(1회 호출 후 재사용)** 으로 나뉜다.

### 3-a. 미리 번역해 저장 (효율적 ✅ — 재번역 없음)

운영자가 데이터를 등록·수정하는 그 순간 1회 번역해 DB에 저장하고, 화면은 저장값만 읽는다.

| 데이터 | 원문→저장 | 번역 시점 | 호출 수 | 화면 |
|---|---|---|---|---|
| 부가서비스 카탈로그 | `nameKo/descKo` → `nameI18n/descI18n{en,vi,zh,ru}` | 저장 시 | 4언어 병렬 | 게스트 `pickI18n` 재사용 |
| 미니바 품목 | `nameKo` → `nameVi` | 저장 시 | 1회 | `minibarItemName` 재사용 |
| 이용 동의서 | ko → `{vi,en,zh,ru}` | 발행 시 | 8회(제목4+본문4) | 저장값 재사용 |
| 빌라명 병기 | ko → `nameVi`(음역 제안) | 제안 버튼 | 1회 | ADMIN 확정 후 저장 |

→ 화면 로드 때마다 재번역하지 않으므로 **중복 낭비 없음.** 실패해도 ko 폴백이라 화면 안 깨짐.

### 3-b. 실시간 번역 (Zalo 채팅 중심)

| 지점 | 무엇 | 시점 | 저장(캐시) |
|---|---|---|---|
| 수신 메시지 자동번역 | 상대 메시지 → ko | 수신 즉시(fire-and-forget) | `translatedText` 저장 → 재조회 시 캐시 ✅ |
| **발송 미리보기** | 내 ko 입력 → vi/en | 입력 중(debounce) | 저장 안 함 |
| **발송 본발송** | 내 ko 입력 → vi/en 발송 | 전송 시 | `translatedText` 저장 |
| 사진 OCR 번역 | 수신 사진 글자 → ko | "번역" 버튼(on-demand) | 저장(멱등) ✅ |
| 음성 받아쓰기 | 음성 → 텍스트(번역 아님) | 녹음 후 | 저장 안 함 |

관련 API: [app/api/zalo/translate](../app/api/zalo/translate/route.ts)(미리보기) · [app/api/zalo/messages](../app/api/zalo/messages/route.ts)(본발송) · [.../translate-photo](../app/api/zalo/messages/[id]/translate-photo/route.ts)(OCR) · [.../transcribe](../app/api/zalo/transcribe/route.ts)(음성)

---

## 4. ⚠️ 발견: 중복·자원 낭비

**⭐ 가장 눈에 띄는 중복(사용자 지적)은 코드/UX 차원 — 게스트 언어 선택기가 디자인 2종·정의 4벌로 복제됨.** 그 외 런타임 번역 낭비는 채팅 발송 1건뿐.

### 🔴 W0. 게스트 언어 선택기 UI/코드 중복 (사용자 지적 — 우선 수정)

같은 게스트 플로우(/g) 안에서 **언어 선택기가 두 디자인으로 따로 구현**됨:
- 셀프 체크인 화면 = 🌐 지구본 **드롭다운**([guest-flow.tsx:440 `HeaderLangSelect`](../app/g/_components/guest-flow.tsx))
- 부가옵션 신청 화면 = 5개 **칩 나열**([guest-options.tsx:282 `LangChips`](../app/g/_components/guest-options.tsx))
- → 게스트가 체크인→부가옵션으로 넘어가면 **버튼 모양이 바뀜**(일관성 깨짐).

게다가 같은 기능이 **손으로 만든 컴포넌트 4벌**로 복제:
1. `LangSelector` — /p 제안 5곳·expired-view (드롭다운, `router` 기반)
2. `HeaderLangSelect` — /g 헤더 (드롭다운, `window.location.href` 기반)
3. `LangChips` — guest-options.tsx (칩)
4. `LangChips` — **guest-flow.tsx에 또 복붙**(동일 코드 2벌)

→ 동작 로직(`p-locale` 쿠키 + `?lang=` + 재렌더)이 전부 같은데 4벌 유지. **공용 `<PublicLangSelector>` 1개(헤더 지구본 드롭다운)로 통일** 결정(2026-06-27, 테오 선택).

**✅ 수정 완료(2026-06-27)**: [components/public-lang-selector.tsx](../components/public-lang-selector.tsx) 공용 컴포넌트 신설(지구본 드롭다운·`router` soft refresh). 적용:
- /p 6곳 = [lang-selector.tsx](../app/p/_components/lang-selector.tsx)를 공용 re-export로 전환(호출부 무변경).
- /g 체크인·동의서·부가옵션 = 로컬 `HeaderLangSelect`·`LangChips`(2벌) 삭제 → 공용으로 교체. 부가옵션은 칩 줄을 **헤더 우측 드롭다운**으로 이동(체크인과 동일 위치·디자인).
- 결과: 게스트 플로우 전 화면이 **헤더 지구본 드롭다운 하나로 통일**. 컴포넌트 정의 4벌 → 1벌. typecheck·lint 통과.

### 그 외 런타임 번역 낭비
실질 낭비는 1건, 잠재적 비효율 1건.

### 🔴 W1. 채팅 발송 시 같은 텍스트 Gemini 2회 번역 (실질 낭비, 경미)

- 입력 중 **미리보기**가 `/api/zalo/translate`로 번역(debounce) → 전송 시 `/api/zalo/messages`가 **같은 텍스트를 다시** `translateText` 호출([route.ts:282](../app/api/zalo/messages/route.ts))
- 즉 **발송 1건당 Gemini 최소 2회**(마지막 미리보기 + 본발송). 번역문은 stateless라 캐시 안 됨.
- 영향: 비용·지연 소폭. 운영자 채팅 빈도만큼 누적.
- **✅ 수정 완료(2026-06-27)**: 클라이언트가 미리보기 번역문을 들고 있다가, **발송 시 입력·번역모드가 미리보기 시점과 동일**하면 본발송 payload에 `clientTranslated`로 전달 → 서버([messages/route.ts](../app/api/zalo/messages/route.ts))가 재번역 생략하고 그대로 사용(발송당 Gemini 2회→1회). 가드: `previewForRef`/`previewModeRef`로 입력·모드 일치 확인, 번역 진행 중·입력 변경·모드 변경 시엔 미첨부 → 서버가 기존대로 번역(오발송 위험 0). 미리보기 OFF면 영향 없음. typecheck·lint 통과.

### 🟡 W2. 수신 메시지 전수 자동번역 (의도된 비용, 모니터링 대상)

- 번역 모드(VI/EN/ZH/RU)가 켜진 대화는 **수신 메시지마다** Gemini 1회([lib/zalo-inbound.ts](../lib/zalo-inbound.ts) `maybeTranslateInbound`)
- ko 의심 메시지는 사전 필터로 스킵, 결과는 `translatedText` 저장(재조회 무료) → 구조는 멱등 ✅
- 낭비는 아니나 **L3에서 가장 큰 비용 항목**. 대화량 늘면 여기가 토큰 소비 1위. OFF 모드면 0 호출.

### 🟢 중복 아님으로 확인된 것
- **L1(ko/vi) ↔ L2(5언어) 두 정적 시스템 병존**: 낭비처럼 보이나 **의도된 분리**. next-intl 글로벌은 ko/vi 전용(공급자·운영자), 공개 5언어는 글로벌을 오염시키지 않으려 별도 딕셔너리. 런타임 비용 0, 단 **유지보수는 2곳**(개념적 중첩 — 신규 라벨 추가 시 양쪽 인지 필요).
- **정적 라벨을 Gemini로 번역하지 않음**: 화면 고정 문구는 전부 손번역(L1/L2). Gemini는 데이터에만. 올바른 분리 ✅
- **미리저장 데이터 재번역 안 함**: 카탈로그·미니바·동의서 전부 저장값 재사용 ✅

---

## 5. ❓ "언어변경 버튼과 별개의 또 다른 번역 버튼" — 정체

화면에 **언어/번역 관련 컨트롤이 2종류 이상 보이는 곳**은 다음. 사용자가 본 것은 거의 확실히 **①의 채팅 번역 드롭다운**이다.

### ⭐ 가장 유력: Zalo 채팅 헤더의 번역 드롭다운 (TranslateDropdown)
- 위치: **운영자 /messages 대화 헤더 우측** ([chat-pane.tsx:942~1043](../app/(admin)/messages/chat-pane.tsx))
- 옵션: **🚫 OFF / 🌐 VI / 🌐 EN** (translate 아이콘, 청록색)
- 역할: **상단 사이드바의 VI/KO 언어토글(=화면 라벨 언어, L1)과 전혀 다름.** 이건 **대화 상대에게 보낼/받을 메시지 내용을 Gemini로 번역**하는 대화별 설정(`ZaloConversation.translateMode` 저장).
- 즉 한 화면에 **「화면 언어 토글(VI/KO)」 + 「메시지 번역 드롭다운(OFF/VI/EN)」** 두 개가 공존 → 헷갈리기 쉬움.

### 부가로 같은 채팅에 더 있는 번역 컨트롤
- **메시지별 "번역 보기/숨기기" 토글** (수신 버블 내, `visibility` 아이콘) — [chat-pane.tsx:1394~1481](../app/(admin)/messages/chat-pane.tsx)
- **사진 "번역" 버튼** (수신 사진 좌하단, OCR 후 ko) — [chat-pane.tsx:1699~1810](../app/(admin)/messages/chat-pane.tsx)
- **입력창 번역 미리보기** (발송 전, "베트남어/영어 미리보기")

### 그 외 화면의 "언어변경 버튼"(번역 버튼 아님)
- 공개 /p·게스트 /g: **지구본 언어 선택기**(5개 언어) — 화면 라벨 언어만 바꿈(L2). 별도 번역 버튼 없음.
- 운영자: **사이드바 하단 VI/KO 토글**(L1)
- 공급자/파트너/벤더/인증: **우측 상단 VI/KO LocaleSwitcher**(L1)

> **요약**: "언어변경 버튼"은 화면 라벨 언어 토글(L1/L2), "또 다른 번역 버튼"은 **/messages 채팅의 콘텐츠 번역 드롭다운(L3)**. 둘은 목적이 완전히 다르며 같은 채팅 화면에서 동시에 보인다.

---

## 6. 종합 판정 & 권고

| 점검 항목 | 판정 |
|---|---|
| ko/vi 기본 설정 | ✅ 정상 (구조 대칭·미번역 잔존 0, 한글 3개는 의도) |
| ru/en/zh 표시(공개·게스트) | ✅ 정상 (5언어 선택기 동작, 라벨·날짜·통화 처리) |
| 실시간 vs 미리번역 분리 | ✅ 명확 (정적=손번역 0비용, 동적=Gemini, 미리저장 재사용) |
| 자원 낭비/중복 | ✅ W0 게스트 선택기 4벌→1벌 통일 완료 · ✅ W1 채팅 발송 재번역 제거(2회→1회) 완료 · 🟡 W2 수신 전수번역만 모니터링 |
| "또 다른 번역 버튼" | ✅ 규명 = /messages 채팅 번역 드롭다운(OFF/VI/EN) |

**권고(우선순위순)**
1. ✅ (완료) **W0 게스트 언어 선택기 통일** — 공용 `<PublicLangSelector>` 1개로 4벌 제거, 헤더 드롭다운 표준화.
2. ✅ (완료) **W1 발송 중복 번역 제거** — 미리보기 결과 재사용으로 발송당 Gemini 2회→1회.
3. (운영) **W2 토큰 소비 모니터링** — 채팅 번역 모드 ON 대화가 늘면 Gemini 비용 1위. 필요시 대화별 기본 OFF 유지 정책 점검.
4. (품질) **ru 원어민 최종 감수**(자원 확보 시) — 동작 정상, 문구만.
5. (UX·선택) **/messages에서 두 토글 혼동 완화** — 채팅 번역 드롭다운에 "메시지 번역" 같은 라벨/툴팁 보강 검토(현재 아이콘만).

> ⚠️ 빌드 주의: 점검 시점 `.next/types`에 삭제된 라우트(`bookings/[id]/services`·`services/[id]`) 참조 stale 에러가 남아 있었음(이번 변경과 무관). 배포 전 클린 `next build`로 재생성 필요.

---

### 부록: 핵심 파일 인덱스
- L1: [i18n/request.ts](../i18n/request.ts) · [middleware.ts](../middleware.ts) · [messages/*.json](../messages/) · [components/locale-switcher.tsx](../components/locale-switcher.tsx) · [components/admin/sidebar.tsx](../components/admin/sidebar.tsx)
- L2: [lib/public-i18n.ts](../lib/public-i18n.ts) · [app/p/_components/lang-selector.tsx](../app/p/_components/lang-selector.tsx) · [lib/fx-rates.ts](../lib/fx-rates.ts)
- L3: [lib/gemini.ts](../lib/gemini.ts) · [lib/zalo-inbound.ts](../lib/zalo-inbound.ts) · [app/api/zalo/translate](../app/api/zalo/translate/route.ts) · [app/(admin)/messages/chat-pane.tsx](../app/(admin)/messages/chat-pane.tsx) · [lib/service-i18n.ts](../lib/service-i18n.ts) · [lib/minibar.ts](../lib/minibar.ts) · [lib/partner-country.ts](../lib/partner-country.ts)
</content>
</invoke>
