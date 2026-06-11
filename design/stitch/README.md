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

## 공개 (모바일, ko, 라이트)
| 폴더 | 화면 (SPEC) | Stitch screen ID |
|---|---|---|
| c1-proposal-page | 공개 제안 /p/[token] (F3) | 941e488d403a43d5a9ea20c3058b4fee |

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
