# T-business-contract-esign — 사업 계약서 전자서명·프린트·포지션별 페이지

> 테오 확정(2026-07-16): 계약서 v0.3 조건 확정 → ① 베트남어 번역본 ② 프린트 ③ 프로그램 내 서명 ④ 포지션별 페이지에서 서명본 열람 ⑤ 별표 값(ID·취소 수수료율·정산 주기 등) 입력 공간 필요 ⑥ 가입은 그대로, admin 승인 후 계약 발송(가입 시 서명 안 받음 — 테오 합의).

## 핵심 설계

### 문서 2벌 체계 (누수 방지 ★)
- **내부 초안**(기존 docs/business/contracts/00~03): `[협상 여지]`·`[변호사 확인]` 등 내부 전략 메모 포함 — **ADMIN /documents 전용 유지, 상대방 절대 노출 금지**. 00 프레임워크는 특히 금지.
- **서명용 정본**(신규 docs/business/contracts/signing/): 내부 메모 전부 제거 + 별표 값 자리에 `{{token}}` 플레이스홀더. 파일: `villa-supply.ko.md`·`villa-supply.vi.md`·`service-vendor.ko.md`·`service-vendor.vi.md`·`partner-agency.ko.md`(파트너=한국어만). 이 정본만 상대방 화면·프린트에 렌더.

### 데이터 모델 (additive)
```prisma
model BusinessContract {
  id            String   @id @default(cuid())
  type          BusinessContractType  // VILLA_SUPPLY | SERVICE_VENDOR | PARTNER_AGENCY
  counterpartId String   // User.id (SUPPLIER/VENDOR/PARTNER 계정)
  status        BusinessContractStatus // DRAFT | SENT | SIGNED | VOID
  standardVersion String  // 서명용 정본 버전 (예: "v0.3")
  termsJson     Json     // ADMIN 입력 별표 값 (아래 타입별 필드)
  locale        String   @default("vi") // 상대방 표시 언어(파트너=ko)
  counterpartIdNumber String?  // 서명 시 본인 입력 (신분증/여권)
  counterpartSignName String?  // 서명자 성명
  signatureUrl  String?  // savePassportFile "sig-" 비공개 저장
  signedAt      DateTime?
  contentHash   String?  // 서명 시점 렌더된 전문 SHA-256 (증빙 봉인)
  sentAt        DateTime?
  createdById   String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([counterpartId, type])
}
```
같은 (counterpartId,type)에 SIGNED 있으면 신규 생성은 VOID 처리 후만(재계약). enum 추가는 raw `CREATE TYPE`.

### termsJson 필드 (타입별 — ADMIN 폼)
- 공통: companyPassport(갑 여권번호), specialTerms?(특약 텍스트)
- VILLA_SUPPLY: cancelFreeDays(기본 14), cancelPartialPct(기본 50), payMethod(CASH|BANK), bankInfo?(이체 선택 시)
- SERVICE_VENDOR: settleCycle(MONTHLY|WEEKLY|PER_ORDER), settleDetail?(예: 매월 5일), payMethod, bankInfo?
- PARTNER_AGENCY: partnerCompany, partnerBizNo, partnerRep, partnerContact
- 단가·원가·서비스 목록은 계약 문안대로 "시스템 등록값 정본" — 별표 수기 입력 없음.

### 렌더링
- `lib/business-contract.ts`: 정본 md 로드(fs, slug 화이트리스트) + `{{token}}` 치환(counterpart 이름·전화는 User에서, 별표는 termsJson에서, 서명 정보) + 미치환 토큰 잔존 시 에러. contentHash = 치환 완료 본문 SHA-256.
- 렌더는 기존 MarkdownView 재사용(서버 컴포넌트).

### 플로우
1. ADMIN이 상대방 승인(기존 플로우 불변) → `/documents` "계약 관리" 섹션에서 상대 선택(役割별)·별표 폼 입력·생성(DRAFT)·**서명 요청(SENT)**.
2. 상대방 포털 페이지 — supplier `(supplier)/contract`(vi)·vendor `/vendor/contract`(vi)·partner `/partner/contract`(ko): SENT 계약 열람(완성 렌더본) → 본인 ID 번호·성명 입력 → 캔버스 서명(기존 guest-signature-pad 패턴 재사용) → POST → SIGNED(서명 이미지+contentHash+시각 봉인).
3. SIGNED 후: 상대방 페이지=서명본 열람+프린트, ADMIN=/documents 계약 관리에서 전체 목록·서명본 열람+프린트.
4. 프린트: A4 print CSS(`no-print` 툴바 패턴 재사용), 서명 이미지·서명 정보 포함.

### API (전부 role 첫 줄 검사 + AuditLog)
- ADMIN(canViewFinance): GET/POST `/api/admin/business-contracts`, PATCH `/[id]`(DRAFT만 수정), POST `/[id]/send`, POST `/[id]/void`
- 상대방: GET `/api/business-contracts/mine`(자기 것만 — counterpartId=세션), POST `/api/business-contracts/[id]/sign`(FormData: 서명 PNG+idNumber+signName. 자기 계약+SENT만, 멱등: 이미 SIGNED=409)
- 서명 이미지 서빙: 기존 `/api/passports/[fileName]` 재사용 가능하면 재사용, 권한=본인+운영자.

## 완료 기준 (QA)
- [ ] 서명용 정본에 내부 메모(`협상 여지`·`변호사 확인`·`v0.x` 헤더·back-to-back 문구) 0건 — grep 검증
- [ ] 상대방 라우트에서 00 프레임워크·내부 초안 접근 경로 0 (기존 /documents는 ADMIN 유지)
- [ ] 역할 스코프: 상대방은 자기 계약만(타인 id 404), SUPPLIER↔VENDOR↔PARTNER 교차 접근 차단
- [ ] 서명 봉인: SIGNED 후 termsJson·본문 변경 불가(PATCH 거부), contentHash 저장, 서명 이미지 비공개 저장
- [ ] SENT 전(DRAFT)은 상대방에게 미노출
- [ ] 미치환 `{{` 잔존 렌더 0
- [ ] 프린트: 인쇄 미리보기에서 툴바 제외·A4 정상(빌라 vi/ko, 파트너 ko)
- [ ] i18n: 페이지 UI 문자열 ko/vi(포털 관례), 계약 본문=정본 파일
- [ ] 누수: 마진·판매가·타 계약 정보 미노출. termsJson에 원가·마진 없음
- [ ] tsc·lint·build·신규 테스트(스코프 403/404·SENT 게이트·서명 멱등·해시)

## 수정 금지 구역
- 가입 폼 4종·승인 플로우(vendor/partner approval) — 불변
- lib/agreement.ts(체크인 동의서)·게스트 /g
- 내부 초안 00~03 md 내용
