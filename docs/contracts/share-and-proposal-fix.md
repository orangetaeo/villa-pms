# 계약서: 채팅 공유 개선 (판매가 0원·빌라 블로그 링크·제안 대화 귀속)

- 담당: TDA(스키마) → BE(구현) → QA(독립 검증). 메인 세션(Fable)=설계·병합
- 브랜치/worktree: `wt/share-and-proposal-fix`
- 배경(테오 2026-07-24): Zalo 채팅 공유 3건 개선 요청
  1. 빌라 공유 모달에 "판매가 0원 / 박"으로 뜨는 버그
  2. 빌라 공유 메시지를 간단정보 + 대표가 + 블로그 링크로 변경(블로그 없으면 폴백)
  3. 제안서 공유가 모든 ACTIVE 제안을 다 노출 → 대화 상대와 매칭된 제안만

## 수정 금지 구역 (다른 세션 작업)
- 없음(메인 폴더 병렬 세션 없음 전제). 공유 파일 `messages/ko.json`·`vi.json`은 **키 추가만**.

---

## 결정 (TDA)

### D1. 대표가 = base 행이 아니라 "실제 판매가(>0) 중 최저값"
- 원인: 빌라 생성 시 `lib/pricing.ts:170`이 base 행 `salePriceKrw=0`으로 초기화. 후보 API는
  `where:{isBase:true}` 행만 읽어 0을 그대로 대표가로 반환 → 모달 "0원", 본문 "기본: ₩0".
- ADR-0014("base 행이 대표가")는 base에 값이 있을 때만 유효. base가 0인 실데이터가 존재하므로
  **대표가 산정을 "전체 요율 중 salePrice>0 최저값"으로 변경**(누수 불변식 유지 = salePrice 컬럼만 select).

### D2. 빌라 공유 메시지(고객 경로)만 변경. 공급자 경로(원가)는 현행 유지.
- 블로그 글이 있으면 간단정보 + 대표가 + 링크, 없으면 기존 상세 본문 폴백.
- 채팅은 운영자↔고객 **비공개 DM**이라 헤더 실명(formatVillaName) 유지. 블로그 링크는 이미 익명 공개.

### D3. 제안 대화 귀속 = 공유 시점 bind (스키마 additive 1필드)
- `Proposal.conversationId String?` 추가(additive raw SQL, nullable, FK 없음 — ZaloConversation.id 참조값).
- Zalo 채팅엔 제안 **생성** 경로가 없고 **공유**만 있으므로, 매칭 키는 공유 시점에 심는다.
- 통계·이력 테이블은 과설계 — 현재 귀속만 스냅샷.

---

## 범위 (Scope)

### A. Q1 대표가 버그 — `app/api/zalo/conversations/[id]/candidates/route.ts`
- 판매가측 빌라 쿼리 `ratePeriods` select에서 `where:{isBase:true}` 제거 → 전체 요율 로드
  (select는 `season, isBase, salePriceKrw, salePriceVnd`만 — 원가·마진 미조회 불변식 유지).
- 대표가 산정 헬퍼 신설 `lib/pricing.ts`:
  `pickLowestSalePrice(rates, useKrw): {krw:number|null, vnd:bigint|null} | null`
  → salePrice > 0 인 행 중 최소. 전부 0이면 null(모달은 가격줄 생략).
- 공급자측 빌라 쿼리도 동일하게 `pickLowestSupplierCost`로 원가 최저값(0 제외) 대표.
- `VillaCandidate`에 `priceIsFrom: boolean` 추가(대표가가 "~부터"임을 UI가 표시). chat-pane.tsx 타입 동반 수정.

### B. Q1 표시 — `app/(admin)/messages/share-modals.tsx` + i18n
- 가격 라벨을 `priceIsFrom`일 때 "…원 ~ / 박"(부터) 형태로. 0/ null이면 "가격 미설정" 회색 문구.
- i18n 키 추가: `adminMessages.shareModal.salePerNightFrom` 등(ko/vi).

### C. Q1 본문 0원 숨김 — `lib/zalo-share.ts`
- `buildVillaShareTextForCustomer`·`buildVillaShareTextForSupplier`: 가격 0(≤0)인 요율 행은 출력 생략.
  전부 0이면 "— 가격(1박)" 섹션 자체 생략.

### D. Q2 빌라→블로그 역조회 — `lib/seo/article.ts`
- 신설 `getPublishedArticleForVilla(villaId, db?): Promise<{slug:string; title:string} | null>`
  - `SeoArticle` where `status=PUBLISHED, publishedAt not null, publicHidden=false, relatedVillaIds has villaId`.
  - `category='villa'` 우선, 없으면 아무 발행글. `orderBy publishedAt desc`, take 1.

### E. Q2 간단+블로그 본문 — `lib/zalo-share.ts`
- 신설 `buildVillaShareBriefWithBlog(villa, from, saleCurrency, blog:{url,title}): string`
  ```
  🏠 {name} ({complex})
  침실 4 · 욕실 4 · 최대 8인
  수영장 · 조식 가능
  {from가격} ~ / 박            ← from 있을 때만
  
  📖 상세 소개: {blog.title}
  {blog.url}
  ```
- from 가격 인자는 CustomerRateView 최저값(D1 헬퍼 재사용). saleCurrency로 KRW/VND 표기.

### F. Q2 분기 — `app/api/zalo/conversations/[id]/share/route.ts` (handleVilla 고객 경로)
- 고객 경로에서 `getPublishedArticleForVilla(villaId)` 조회:
  - 있으면 `buildVillaShareBriefWithBlog(...)` + 블로그 URL = `absoluteUrl(blogPaths.article(slug))`.
  - 없으면 기존 `buildVillaShareTextForCustomer(...)` 폴백(현행 그대로).
- 공급자 경로 무변경.

### G. Q3 스키마 — `prisma/schema.prisma` + `prisma/migrations-manual/`
- `Proposal.conversationId String?` 추가. migration SQL 파일 `YYYYMMDD-proposal-conversation-id.sql`
  = `ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;`
- 인덱스 `CREATE INDEX IF NOT EXISTS "Proposal_conversationId_idx" ON "Proposal"("conversationId");`

### H. Q3 공유 시 bind — `app/api/zalo/conversations/[id]/share/route.ts` (handleProposal)
- 제안 공유 실행 시 대상 proposal의 `conversationId`:
  - null이면 이 대화 id로 set(bind).
  - 이미 **다른** 대화에 bind돼 있으면 409 거부(오발송 차단). 같은 대화면 통과.
- AuditLog(UPDATE Proposal conversationId).

### I. Q3 후보 필터 — `app/api/zalo/conversations/[id]/candidates/route.ts` (proposal 쿼리)
- 기본: `where` 에 `OR:[{conversationId:null},{conversationId:id}]` 추가
  (미귀속 + 이 대화 귀속만. 다른 대화 귀속 제안은 숨김).
- 응답에 `proposalScope` 플래그 or 각 후보 `boundHere:boolean`(선택) — UI 구분용.
- "전체 보기" 요청 시 필터 해제: `?allProposals=1` 쿼리 지원(토글).

### J. Q3 모달 토글 — `app/(admin)/messages/share-modals.tsx` (ProposalShareModal) + chat-pane
- 기본은 매칭된(+미귀속) 제안만. 하단에 "전체 제안 보기" 링크 → allProposals=1 재조회.
- i18n 키 ko/vi.

---

## 테스트 가능한 완료 기준 (QA)
1. **판매가 0 해소**: base=0·시즌가만 있는 빌라를 고객 대화 공유 모달에서 열면 "최저 시즌가 ~ / 박"이 뜬다(0원 아님). 전부 0인 빌라는 "가격 미설정".
2. **본문 0 숨김**: 공유 메시지 본문에 "기본: ₩0" 줄이 없다.
3. **블로그 링크**: 발행 빌라글이 있는 빌라 공유 시 간단정보 + `/blog/{slug}` 링크. 없는 빌라는 기존 상세 본문.
4. **제안 귀속**: 제안 A를 대화1에 공유 → 대화2 후보 목록에서 A 사라짐. 대화1에선 계속 보임. "전체 보기"로는 A도 보이나 대화2에 공유 시도하면 409.
5. **누수 불변식**: 모든 변경 쿼리에서 원가·마진이 고객 경로에 미조회(select 화이트리스트 grep). `tests/` 회귀 유지.
6. `npm run lint && npm run typecheck && npm run build` 통과.

## 검증 방법
- 유닛: `pickLowestSalePrice`/`pickLowestSupplierCost` 0·혼합·전부0 케이스. `getPublishedArticleForVilla` 카테고리 우선순위·미발행 제외. 제안 bind 409 가드.
- 통합: candidates/share route 스냅샷(누수 필드 부재 assert).
