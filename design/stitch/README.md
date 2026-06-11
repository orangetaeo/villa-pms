# design/stitch — Stitch 디자인 (1차 + 검수 보완, 2026-06-11)

Stitch MCP로 생성. 수정 요청 시 아래 screen ID로 `edit_screens` 호출.

- **Stitch 프로젝트**: `14837850287160773673` (Villa PMS — 푸꾸옥 빌라 임대 플랫폼)
- **디자인 시스템**: 라이트(공급자·공개) `assets/16166333700622029900` — Be Vietnam Pro, 틸 #0D9488 / 다크(운영자) `assets/16997822837865073105` — 네이비 #0F172A, 블루 #3B82F6
- 각 폴더: `index.html` (Tailwind export) + `screenshot.png`
- ⚠ Stitch export 다운로드 URL은 수 분 내 만료됨 — 재다운로드 시 list_screens/get_screen으로 새 URL 즉시 사용

## 공급자 (모바일, vi, 라이트)
| 폴더 | 화면 (SPEC) | Stitch screen ID |
|---|---|---|
| a0-signup | 자가 가입 (F0) | 8addecae46cc4f46917ce3c812946128 |
| a0-zalo-connect | Zalo 연결 안내 (F0) | d2284bd4e6bb4eec90779ec2fbf946a9 |
| a2-basic-info | 등록 마법사 1/4 기본 정보 (F1) | 265de449110042e08b15b53dd019e1f6 |
| a2b-location-info | 등록 마법사 2/4 위치·참고 (F1) | 63d04abdca874510bc84e51e56271104 |
| a1-photo-upload | 등록 마법사 3/4 사진 업로드 (F1) | 0f770913c9864add9f7f3d4a39bf572f (구버전 953127ff… 미사용) |
| a5-rate-input | 등록 마법사 4/4 원가 입력 (F1) | aff4c074e02a45fcabb8c99a4bf8e8c5 (구버전 a0816ae5… 미사용) |
| a6-my-villas | 내 빌라 홈 + 하단 탭 4종 (F1) | da38e00c1c744b8fa2e49bb6536ba804 |
| a3-calendar | 캘린더 (F2) | cc6f5095fd5a47879d17e81b665c8599 |
| a4-cleaning-photos | 청소 사진 제출 (F4) | 772dfcded1c542a6b6ec762a261a0c96 |
| a7-my-earnings | 내 수익 — 원가만 (F6) | 619e1b1433e340e383034adbf7b1007d |
| a9-amenities | 등록 마법사 4/5 비품 입력 (F1, ADR-0003) | (Stitch 미생성 — 로컬 컴포지션, 2라운드 참조) |
| a10-villa-detail | 빌라 상세·수정 진입 + 반려 상태 변형 (F1) | 13088a6d78be48f185b591f5986f701d (미사용 후보 c97c8793…, 483321a4…) |

## 운영자 (PC, ko, 다크) — 사이드바 8메뉴 통일됨
| 폴더 | 화면 (SPEC) | Stitch screen ID |
|---|---|---|
| b1-dashboard | 대시보드 (F7) | 7bea607c644a48cda3869d707dea77cd |
| b5-bookings | 예약 목록 (F7) | d2b8885290c049eab69487dc28b15114 |
| b11-booking-detail | 예약 상세 + 상태별 액션 (F7) | 622b22be33394094849858d1789a532d |
| b12-proposals-list | 제안 목록 (F3·F7) | 9a28ef29932f4f41a7fb56e9095e0b27 |
| b2-proposal-create | 제안 만들기 (F3) | a095f94d961d4086b702e28e6ac8a7c3 |
| b9-villas-list | 빌라 목록 + 승인 대기 (F1) | eb55f8e9632c462a844ec871c77d7a62 |
| b10-villa-detail | 빌라 상세·요율 편집·iCal (F1) | 43b8d318a2c44f0b87af7bfc94f64767 |
| b3-checkin | 체크인 검수 (F4) | 5a36baea9e3f4d2c9c164700001d37c4 |
| b4-checkout | 체크아웃 비교 검수 (F4) | 9ce61235238048d581c1b056410ea117 (구버전 a52ac208… 미사용) |
| b6-inspections | 청소 검수 승인 (F7) | b6ac78ff2b354314933bbd5e52ea9cce (구버전 23d1653a… 미사용) |
| b7-settlements | 정산 (F6) | 2a3e56d9f77740ce8cbfefad918ff305 |
| b13-users | 사용자 관리 (F0·F7) | 64ef6f6c6f444ce3b82b5e3b475b2aee (구버전 f7a45506…, 중복본 ee420eae… 미사용) |
| b8-settings | 설정 — 시즌·홀드 (F1·F7) | 368b8a04d9eb41d8960405b0ab08595e |
| b14-zalo-chat | 메시지 — Zalo 채팅 (F7, ADR-0003) — 9메뉴 사이드바 첫 적용 | (Stitch 미생성 — 로컬 컴포지션, 2라운드 참조) |
| b1-mobile | 대시보드 모바일 변형 390px (ADR-0003 결정4) | (Stitch 미생성 — 로컬 컴포지션, 2라운드 참조) |

## 공개 (모바일, ko, 라이트)
| 폴더 | 화면 (SPEC) | Stitch screen ID |
|---|---|---|
| c1-proposal-page | 공개 제안 /p/[token] (F3) | 941e488d403a43d5a9ea20c3058b4fee |
| c1-vnd | c1 여행사용 VND 변형 (ADR-0003 결정1) — KRW 원본 유지 | (로컬 변형 — Stitch 화면 없음) |
| c3-vnd | c3 여행사용 VND 변형 (ADR-0003 결정1) — KRW 원본 유지 | (로컬 변형 — Stitch 화면 없음) |

## 검수 이력 (DESIGN 에이전트, 2026-06-11)
- 기획 대비 누락 8장 추가 생성: a2b, a5, a6, a7, b9, b10, b11, b12
- 불일치 수정 (Stitch edit_screens):
  - C1: 하단 탭바 제거 (1회성 공개 페이지) — export 지연으로 로컬 index.html에서도 직접 제거함
  - B2: 기획에 없는 "채널 수수료·예상 수익" 블록 → "총 판매가 합계"로 교체, 만료 옵션 "무제한" 제거
  - B3·B4·B6·B8u·B8s: 사이드바 메뉴를 SPEC F7의 8개(대시보드/예약/제안/빌라/청소 검수/정산/사용자/설정)로 통일
  - A5: Stitch 임의 생성 "가격 할인 팁" 카드 제거 (Stitch + 로컬 모두)
- 미생성 (의도): 로그인 화면(가입 화면 변형으로 구현 시 처리), 마법사 완료 화면(토스트로 충분)
- 권한 점검: 공급자 화면(a*) 전체에서 판매가(KRW)·마진·고객 상세 노출 없음 확인

## 2차 LOC 감수 반영 (DESIGN 에이전트, 2026-06-11)
- a5: 원가 설명문 "Giá gốc bạn muốn nhận mỗi đêm theo từng mùa." → **"Nhập giá bạn nhận cho mỗi đêm, theo từng mùa."** (muốn nhận 금지), 문서 title의 "biệt thự" → "villa"
- a4: 헤더 "Hoàn tất vệ sinh" → **"Dọn dẹp xong"** (vệ sinh 금지)
- a2·a2b: 마법사 헤더 **"Đăng ký villa"** 통일 (a2 "Thông tin cơ bản"은 섹션 제목으로 이동, a2b 대문자 "Villa" 소문자화)
- a1·a0-zalo: 단계 표기 공백 제거 — "Bước 3 / 4"→"Bước 3/4", "Bước 2 / 2"→"Bước 2/2" (a2/a2b/a5는 이미 공백 없음)
- b4: "Admin User"→관리자, "Manager"→운영자, "Sonasea V12"→쏘나씨 V12, 영어 병기 괄호 제거(Baseline/Checkout/Living Room/Kitchen/Pool)
- b6: "Master Admin"→관리자, "(Cleaning Team A)"→(청소팀 A)
- b10: "Operations Manager"→운영 관리, "Admin"→관리자, "Master Level"→최고 관리자, 요율 단위 "Fix"→정액, "화장실 2"→욕실 2
- **잔존 이슈**: ① Stitch MCP에 화면 삭제 도구가 없어 미사용 중복 3건(a8 중복 1bef1975…, b13 중복 ee420eae…, c2 구버전 83ca80d7…)은 Stitch 웹에서 수동 삭제 필요 ② 1차와 동일하게 edit 후 export 파일 재생성이 지연됨 — 로컬 index.html은 Stitch가 보고한 dom_operations와 동일한 텍스트 치환을 직접 적용해 동기화함(치환 내용은 위와 동일), screenshot.png는 재생성 전 캡처라 갱신 보류

## QA 반려 수정 (DESIGN 에이전트, 2026-06-11)
- c2-proposal-expired: index.html 마크다운 펜스(```html/```) 2줄 제거 + 빈 head 복구(meta charset·viewport·script·style을 body→head 이동), Playwright Chromium 390×844 @2x로 screenshot.png 재캡처(780×1688 PNG, 한글 정상)
- c3-booking-request: 확장자만 png였던 JPEG 106×512 저해상도 screenshot.png를 동일 조건(390×844 @2x)으로 재캡처(780×1688 진짜 PNG, 한글 정상) — 디자인 내용은 변경 없음

## 3차 타이포·통일성 전수 수정 (DESIGN 에이전트, 2026-06-11)
- 테오 보고 "한국어 글자 세로 낙하" 박멸: b1~b13·c1~c3 전체에 `word-break: keep-all`(body) + `white-space: nowrap`(th·button·.tabular-nums·span[class*="rounded"]) 공통 CSS 주입, b12 이메일 truncate. 규칙 상세는 docs/DESIGN.md "레이아웃·타이포 규칙" 참조 (변환 시 전역 CSS로 강제)
- 한글 폰트 폴백: b 계열 Public Sans, c 계열 Be Vietnam Pro 모두 한글 글리프 없음 → **Noto Sans KR** 폴백 추가(link + tailwind config + body)
- 브랜드·프로필 통일: 서브타이틀 "Villa PMS Admin"(b2 신설, b5·b7 "Admin Operations", b9 "Admin" 칩, b10 "운영 관리", b12 "Operations Manager" 교체), 프로필 "관리자/최고 관리자"(b1·b2·b5·b6·b7·b8·b9·b11·b12 영문/가명 제거), b9 브랜드 가로 칩 → 표준 세로 스택
- 색 표준화: 사이드바 배경 #0F172A 통일(b1·b4·b5·b7 #1E293B, b2 slate-950 이탈 수정), b2 teal 액센트(.selected-card #0D9488, text-teal-*) → 블루 #3B82F6 (b13 "공급자" teal 배지는 역할 시맨틱으로 유지)
- 표기 통일: b10 VND 점→쉼표(2,500,000₫), b1 1.000.000₫→콤마, 날짜 하이픈→YYYY.MM.DD 점(b7·b8·b11), 샘플 연도 2023~2025→2026, c1 © 2026
- c1: 1차 결정대로 하단 탭바(영문 Booking/Calendar/Settings) 재제거(2차 재생성 때 부활했던 것), 제목 text-xl + 칩 shrink-0 + CTA px-4로 390px overflow 해소
- screenshot.png 16장 전부 재캡처 — b 계열 1440×900 @2x(Chrome headless), c 계열 390×844 @2x(puppeteer-core+시스템 Chrome; **Chrome headless=new는 창 최소폭 ~463px 클램프가 있어 390px 모바일 캡처는 반드시 뷰포트 에뮬레이션(puppeteer/Playwright) 사용**)
- Stitch 클라우드 동기화: edit_screens 완료, "(최종 업데이트)" 신규 버전 생성됨 — **로컬 export가 canonical** (Stitch 재생성본은 받지 않음). 새 screen ID: b1 3d6ad6c6…, b2 4977d15e…, b4 534bfc89…, b5 694d40f2…, b6 b0be5db4…, b7 3531aaca…, b8 36b11a52…, b9 c81f2544…, b10 5f848be7…, b11 16ec3fe7…, b12 26cca21c…, c1 84ff3c4e… (b3·b13·c2·c3은 클라우드 미반영 — 공통 CSS는 변환 시 전역 적용이라 무관)
- 잔존: ① b2 "채널 수수료·예상 수익" 블록이 로컬에 여전히 존재(2차 README는 교체 완료로 기록) — 콘텐츠 사안이라 본 타이포 작업에서 미수정, 재확인 필요 ② Stitch 웹 수동 삭제 대기 중복 화면은 이번 12건 추가로 누적

## 2라운드 — 신규 요구 4건 반영 (DESIGN 에이전트, 2026-06-11, ADR-0003 / T6.1·T6.2)

### 신규 3장 (T6.1)
- **b14-zalo-chat** (다크 PC, ko): 공급자 인박스(검색·미읽음 뱃지·48시간 경과 태그) + 대화창(수신 vi 원문+ko 번역 병기·번역 토글, 시스템 알림 미러 말풍선) + 발신 입력창(ko 입력 + 베트남어 미리보기 스트립) + "디자인 참고 — 48시간 경과 상태" 비활성 입력창·경고 배너. **사이드바 9메뉴(메시지 삽입) 첫 적용 화면** — 기존 화면은 변환 단계 공통 컴포넌트(Sidebar)에서 일괄 9메뉴 전환.
- **b1-mobile** (다크 390px, ko): 햄버거 헤더 + iCal 충돌 경보 배너(최상단) + 스탯 카드 2×2 + 타임라인 매트릭스 대신 "오늘 중심 리스트"(오늘 체크인/체크아웃/청소 검수 대기/만료 임박 홀드).
- **a9-amenities** (라이트 teal 390px, vi): 마법사 "Bước 4/5" Tiện nghi & đồ dùng — 카테고리 탭 4종(Đồ bếp/Đồ phòng tắm/Thiết bị điện/Minibar, 4번째 탭이 화면 끝에 살짝 보이도록 스크롤 단서 처리) + 아이콘 체크박스 타일 그리드(텍스트 입력 없음) + Minibar 수량 스테퍼(참고 블록, 변환 시 탭 전환 콘텐츠) + "Bỏ qua bước này". 금액·통화·마진 0건.
- ⚠ **Stitch 클라우드 생성 실패**: generate_screen_from_text 4회·우회 edit 1회 전부 transport 타임아웃, list_screens는 캐시 고정(53,097B 동일 응답 3회)으로 신규 화면 회수 불가 → 3장 모두 **기존 canonical export의 쉘·토큰을 재사용한 로컬 컴포지션**으로 산출(다크: b13 쉘+b1 카드 토큰 / 라이트: a2 쉘). 추후 Stitch 웹에서 재생성 시 DESIGN.md B14/B1-M/A9 프롬프트 사용.

### 수정 9장 (T6.2) — Stitch edit_screens 후 신규 export 채택(+로컬 결함 수술), b11만 dom_operations 로컬 적용
| 화면 | 변경 | 새 Stitch screen ID |
|---|---|---|
| b2-proposal-create | 여행사 채널 선택 상태 → 판매가 전부 VND(쉼표), 채널 캡션 "여행사·랜드사 채널은 VND로 결제됩니다", 환율 칩 "환율 참고: 1,000,000₫ ≈ 53,000원 (수동 환율 기준)", "채널 수수료·예상 수익" 블록 제거 → 총 판매가 합계+마진 요약(ADMIN이므로 마진 노출 허용) | 3e983a28be624af19187b1f89d59b6d2 |
| b5-bookings | "금액" 열 신설 — 행별 saleCurrency 혼재(원 5행/₫ 3행), nowrap·tabular-nums | f7b30763a74a4d13b47829526ff3a691 |
| b12-proposals-list | "금액" 열 신설 — 혼재(₫ 5행/원 1행) | 8b142f098099472594736b7f320d39b0 |
| b11-booking-detail | 가격 스냅샷에 "판매 통화: KRW" 칩, 결제 기록 혼재 행(1,350,000원 / 보증금 7,500,000₫) | 16ec3fe7… (in-place dom_operations) |
| b7-settlements | 매출 요약 통화별 분리 카드(KRW 매출 12,450,000원 / VND 매출 86,200,000₫) + "통화별 별도 집계 — KRW와 VND는 합산하지 않습니다", 공급자 지급은 VND 유지 | 8abee00e3f1c4f60a03b58f4559d4517 |
| b10-villa-detail | 요율 표 5열(시즌/원가 VND/마진/판매가 VND/판매가 KRW 환산 참고+자동 제안 태그) + "비품 현황" 읽기 전용 섹션(카테고리 4종 + 미니바 품목·수량) | ff188b2938c34eb59e73921e15de5075 |
| b4-checkout | "미니바 확인" 읽기 전용 체크리스트(품목·비치 수량) + "소모된 품목은 자동 계산되지 않습니다 — 차감액(VND) 입력란에 수기로 기록하세요." | c4c4b19d66b34eec8dc1a88924f4dac4 |
| c1-vnd / c3-vnd | KRW 원본 보존, 별도 변형 폴더 — 가격만 ₫ 쉼표 표기(8,500,000₫/박, 총 24,200,000₫ 등), c3 은행명 Vietcombank | (로컬 변형) |

### 재생성 export 회귀 수습 (이번 라운드에서 발견·즉시 수정)
- b5: Stitch가 "금액 (VND)"+"금액" 중복 2열 생성 → 로컬 수술로 1열 혼재로 교정, 여행사 행 VND 스케일 현실화(28,400,000₫ 등)
- b2: 만료 옵션 "무제한" 부활(1차 결정 위반) 제거, "최종 제안 금액" 38,400,000₫ → 54,600,000₫(합계와 일치)
- b4: 2차 LOC 감수 제거분 부활 — "거실 (Living Room)"류 영어 병기 5건·"Sonasea V12" 재제거
- b7: Stitch 임의 영어 빌라명(Grand Horizon Villa 02 등) → 쏘나씨/썬셋 사나토 교체
- b12: 우상단 "Manager" → 관리자
- ※ 교훈: edit_screens 재생성 export는 이전 검수 결정을 잊는다 — 채택 전 회귀 grep(영어 병기·무제한·임의 영어명) 필수

### 스크린샷
- b 계열 8장: Playwright(playwright-core+시스템 Chrome) 1440×900 @2x / a9·b1-mobile·c1-vnd·c3-vnd: 390×844 @2x 뷰포트 에뮬레이션 (headless CLI 463px 클램프 회피)

### 잔존 이슈 (2라운드)
1. Stitch 클라우드와 로컬 canonical 괴리 확대 — 신규 3장은 클라우드에 없음, 타임아웃된 생성 4건+우회 edit 1건이 클라우드에 고아 화면으로 생성됐을 가능성 → T5.4 수동 정리 시 Stitch 웹에서 확인 필요
2. ADR-0003 결정1의 "c1·c3 VND ₫ 천단위 점 표기"와 테오 지시·DESIGN.md 표기 규칙(한국어 화면 = 쉼표)이 상충 → c1-vnd/c3-vnd는 **쉼표(24,200,000₫)** 적용, ADR 문구 정정 필요(TDA)
3. 기존 마법사 단계 표기(a2 1/4 ~ a5 4/4)는 비품 단계 삽입으로 N/5 재번호 필요 — 화면 재생성 대신 변환 단계에서 ICU 변수(`Bước {n}/{total}`)로 처리
4. b4·b10의 신규 섹션은 1440×900 뷰포트 스크린샷 하단 밖에 위치 — index.html에는 존재(QA는 HTML 열람으로 확인)

## 3라운드 — a10 신규 + 반려 플로우·설정 보강 7건 (DESIGN 에이전트, 2026-06-12)

### 신규 1장
- **a10-villa-detail** (라이트 teal 390px, vi): SUPPLIER 빌라 상세 — arrow_back 헤더 + 상태 배지 3종 레퍼런스 행(Chờ duyệt amber/Đang hoạt động green/Bị từ chối red), 반려 변형 카드(Lý do từ chối + 빨강 "Sửa và gửi lại" 56px 버튼), 섹션 카드 4개(기본 정보·Hình ảnh 썸네일 그리드+장수·Tiện nghi & đồ dùng 카테고리 개수·Giá gốc 시즌 3종 — 자기 원가만, 점 구분 ₫), 하단 iCal URL 행+Sao chép 복사 버튼, 탭바 없음. generate 2회 transport 타임아웃 → 폴링으로 클라우드 생성분 3장 회수, **13088a6d 채택**(빨간 재제출 버튼·탭바 없음·₫ 점 표기 충족). 로컬 보정: Hình ảnh·Giá gốc 카드 chevron 추가, Noto Sans KR 폴백+keep-all/nowrap 주입.

### 수정 6장 — edit_screens 성공(신규 클라우드 화면 생성), 회귀 방지를 위해 **로컬 canonical에 신규 섹션만 이식** 방식
| 화면 | 변경 | 새 Stitch screen ID |
|---|---|---|
| b8-settings | 섹션 3개 추가 — ① 입금 계좌·연락처(은행명/계좌번호/예금주/카카오톡 URL/전화번호 + "공개 제안 페이지의 입금 안내에 표시됩니다.") ② Zalo 연결(ADR-0005: 연결됨 green/세션 만료 red 배지, 마지막 발송 시각, QR 재로그인 버튼 + QR 모달 참고) ③ 환율(1,000,000₫ ≈ 53,000원 표시, 1 KRW = 18.87 VND 수동 입력, 갱신 시각) | 325e15cec97f4b55b3c3a06acf60e5a6 |
| b10-villa-detail | "디자인 참고 — 반려 모달": 빌라 반려 모달(필수 textarea + "사유를 입력해야 반려할 수 있습니다." + 취소/반려 확정(비활성·활성 2종), "반려 사유는 공급자에게 Zalo로 전달됩니다.") | 0f320f0f62784f9d8a0f91310cbb12ef |
| a8-cleaning-tasks | Bị từ chối 카드에 반려 사유 한 줄("Lý do: Ảnh phòng tắm bị mờ, vui lòng chụp lại.") | f46aa669ab1548fba52cf2c149daaa5b |
| a4-cleaning-photos | 상단 반려 재업로드 배너 상태 변형(rose-50, "Bị từ chối — Vui lòng chụp lại" + Lý do + 재제출 안내 — 변환 시 REJECTED만 렌더) | 251ece76f89642ebaca5ed0271d7ca3e |
| b13-users | "디자인 참고 — 사용자 추가 모달": CLEANER 계정 생성(이름/전화번호/역할 세그먼트 공급자 teal·청소 purple/임시 비밀번호 vl-7392-tmp + refresh·copy, 취소/계정 생성) | 97f7a2af514d4313981393d9d8177c97 |
| a6-my-villas | 전 카드 빌라명 행에 chevron_right(a10 진입점) + 2번 카드(Sonasea V12) Chờ duyệt → **Bị từ chối**(red outline) + 사유 한 줄("Lý do: Thiếu ảnh phòng tắm.") | 6a9f4b3f979a45d889ec907d584f8fc9 |

### 회귀 수습·일괄 보정 (이번 라운드)
- b8 재생성 export 회귀 확인 — 사이드바 구메뉴(견적 관리 등)·"Operations Manager"·"김운영 매니저"·© 2024·폴백 CSS 소실 → export 통채택 대신 canonical에 신규 섹션 3개만 이식, QR placeholder 영어 → qr_code_2 아이콘으로 교체
- a계열(a4·a6·a8·a10)에 한글 폴백 공통 CSS(Noto Sans KR + keep-all + nowrap) 신규 주입 — 기존 3차 수정이 b·c 계열만 적용했던 공백 해소
- b13 가입일 샘플 연도 2024 → 2026 통일(선존재 이슈)
- 스크린샷 7장 재캡처: a계열 390×844 @2x(뷰포트 에뮬레이션), b계열 1440×900 @2x — b8·b10·b13 신규 섹션은 뷰포트 하단 밖(HTML에 존재, QA는 HTML 열람)
- 권한 점검: a계열 4장에서 KRW·원·마진·판매가·수수료 어휘 0건, biệt thự·vệ sinh 0건 확인
- 잔존: 미채택 a10 후보 2장(c97c8793…, 483321a4…)이 클라우드에 고아로 남음 — T5.4 수동 정리 목록에 추가
