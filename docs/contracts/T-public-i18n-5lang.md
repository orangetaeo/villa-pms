# T-public-i18n-5lang — 공개 제안 페이지 5개 언어 (#5, 1차)

## 배경 / 결정
테오 2026-06-24 #5: 공개 제안 페이지(`/p`)를 ko/en/ru/zh/vi 5개 언어로. 현재 /p는 i18n 0%(한국어 ~120개 distinct 하드코딩, 15개 파일). **1차 = 정적 UI 텍스트만** 5개 언어화 — 빌라명·설명·가격·날짜 등 **동적 데이터는 원문 유지**.

테오 결정·전제:
- 1차는 정적 UI만(빌라명 원문). en/ru/zh 감수 자원 미확보(특히 ru) → 기계품질 번역 제공 + ru는 감수 플래그(후속 LOC 감수).
- 동의서는 이미 5개 언어(`lib/agreement.ts`, [[agreement-content-module]]) — /p에서 참조만(중복 작업 없음).

## 아키텍처 결정 (TDA)
**next-intl 글로벌 설정(ko/vi 전용)을 건드리지 않는다.** 대신 **기존 5개 언어 딕셔너리 모듈 패턴**(`lib/checkin-sheet-i18n.ts` `SHEET_LABELS: Record<lang, labels>`, `lib/agreement.ts`)을 그대로 따른다.
- 신규 `lib/public-i18n.ts`: `PublicLang = "ko"|"en"|"ru"|"zh"|"vi"`, `PUBLIC_LABELS: Record<PublicLang, PublicLabels>`(전 UI 문자열), 라벨 헬퍼(침대·셀링포인트·요일·취소정책 단계 — 현 `BED_LABEL_KO`·`FEATURE_LABEL_KO`·`KO_WEEKDAYS`를 5개 언어 맵으로 이전), `isPublicLang`, `resolvePublicLang(param, cookie)`.
- **로케일 결정**: `/p?lang=<5종>` URL 검색 파라미터 우선 → `p-locale` 쿠키 → 기본 `ko`(현행 보존). 선택 시 `p-locale` 쿠키 저장 + 같은 페이지 `?lang` 갱신.
- **언어 선택기**: `/p` 공통 헤더에 셀렉터 컴포넌트(클라이언트, 5개 언어). 쿠키 set + `router.replace(?lang=)`.
- 서버 컴포넌트: `lang` 해석 → `L = PUBLIC_LABELS[lang]` 만들어 자식에 props 전달. 클라이언트 컴포넌트(booking-form·roster-form·copy/share/hold-countdown)는 해석된 라벨 slice를 props로 받음(자체 next-intl provider 미도입).

## 범위 (1차)
1. `lib/public-i18n.ts` 신규 — 5개 언어 라벨 딕셔너리 + 헬퍼 + 로케일 해석. 단위테스트(키 parity 5개 언어·해석 우선순위).
2. `/p` 15개 파일 하드코딩 한국어 → `PUBLIC_LABELS` 키로 추출(서버는 L 주입, 클라는 props). 동적 데이터(빌라명·가격·전화·ID·주소) 원문 유지.
3. 공유 라벨 맵 이전: `villa-sales-section.tsx`의 `BED_LABEL_KO`·`FEATURE_LABEL_KO`, `public-format.ts`의 `KO_WEEKDAYS`·"원"·만료 문구, 취소정책 단계 문구 → 5개 언어.
4. 언어 선택기 컴포넌트 + `/p` 헤더 배치 + `p-locale` 쿠키.
5. 5개 언어 채움: ko(기존 원문)·vi(품질)·en·zh·ru(기계품질, **ru 감수 플래그 주석**). 빌라명·설명은 번역 대상 아님.
6. i18n·단위테스트·QA.

## 범위 밖
- 동적 데이터(빌라 설명·셀링포인트 custom 라벨·빌라명) 번역 — 원문 유지(1차 정적 UI만).
- 글로벌 admin/supplier next-intl을 5개 언어로 확장(ko/vi 유지). en/zh/ru 메시지 파일 신설 안 함(딕셔너리 모듈로 격리).
- Accept-Language 자동 감지 — 1차는 명시 선택(?lang)+쿠키만. 기본 ko 보존.
- 동의서 본문(이미 5개 언어, lib/agreement.ts) 재작성.

## 수정 금지 구역 (병렬)
- 다른 세션 활성: `app/(admin)/users/*`·`auth.ts`·`app/api/users/*`(회원삭제), `app/(admin)/settings/*`·`bookings/checkin-sheet`·`bookings/[id]/checkin/*`(동의서 에디터 머지 중) — 비접촉.
- 공유 파일: `messages/*.json`은 **추가-only**(필요 시 `pageTitles`·`p` 네임스페이스 최소 키), [[shared-git-index-private-commit]] 전용 인덱스 커밋. `middleware.ts`는 /p 로케일 쿠키 set이 필요하면 **추가만**(기존 매처·분기 무변경) — 가능하면 미들웨어 무수정(페이지 레벨 ?lang 해석으로 회피).
- `lib/agreement.ts`·`lib/checkin-sheet-i18n.ts` 무변경(참조만).

## 완료 기준 (테스트 가능)
- [ ] `/p?lang=en|ru|zh|vi|ko` 전환 시 정적 UI가 해당 언어로 렌더(빌라명·가격은 원문). 미지정은 ko.
- [ ] 언어 선택기로 전환 → `p-locale` 쿠키 저장 + 재방문 유지.
- [ ] `/p` 15개 파일에 하드코딩 한국어 UI 문자열 0(동적 데이터 제외). grep 가드.
- [ ] `PUBLIC_LABELS` 5개 언어 키 parity 100%(단위테스트). 침대·셀링포인트·요일 5개 언어.
- [ ] 누수 불변식 유지 — /p는 여전히 원가·마진·판매 KRW·타재고 미노출(i18n 추출이 select·데이터 무변경).
- [ ] typecheck 0, `npm test` 그린, `next build` 통과. ru 감수 플래그 주석 존재.

## 검증
- 단위테스트: public-i18n 5개 언어 parity·로케일 해석 우선순위(param>cookie>ko)·라벨 헬퍼.
- QA 독립: 5개 언어 실렌더(Playwright `?lang=` 5종)·하드코딩 0 grep·누수 0 재확인·선택기 쿠키 왕복.

## 단계 / 담당
TDA(public-i18n 모듈·로케일 해석 설계) → LOC(5개 언어 번역, ru 플래그) → FE(15파일 추출·선택기) → QA 독립 → PM 보고. ADR 불요(기존 딕셔너리 패턴 재사용).
