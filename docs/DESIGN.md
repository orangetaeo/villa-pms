# DESIGN.md — Stitch 디자인 워크플로우

디자인은 **Google Stitch** (stitch.withgoogle.com)에서 생성한다.
Stitch 출력(HTML + Tailwind)을 Claude Code가 Next.js 컴포넌트로 변환한다.

## 워크플로우

1. Stitch에서 아래 프롬프트로 화면 생성 (Standard 모드 위주, 최종 폴리시만 고급 모드)
2. 마음에 들 때까지 Direct Edit / 추가 프롬프트로 수정 (화면당 1~3회)
3. Export → **Code (HTML/Tailwind)** 다운로드 → 이 레포 `design/stitch/<화면명>/` 에 저장
   (Stitch MCP 연동이 가능하면 MCP 우선)
4. Claude Code 지시: "design/stitch/<화면명> HTML을 참고해서 해당 페이지를 Next.js + Tailwind 컴포넌트로 구현해. 레이아웃·색·간격은 디자인을 따르되, 데이터는 Prisma 모델에 연결."
5. 첫 화면 변환 시 디자인 토큰(색·radius·간격)을 `tailwind.config` / `globals.css`로 추출 → 이후 화면은 토큰 재사용

## 디자인 시스템 방향

| | 운영자 (ADMIN) | 공급자 (SUPPLIER) | 공개 제안 페이지 |
|---|---|---|---|
| 테마 | 다크 대시보드 | 라이트, 고대비, 큰 터치 영역 | 라이트, 신뢰감 |
| 언어 | 한국어 | 베트남어 | 한국어 |
| 기기 | PC 우선 + 반응형 | **모바일 전용 수준** (390px) | 모바일 우선 |
| 톤 | 데이터 밀도 높게 | 1화면 1작업, 텍스트 최소 | 사진 중심, 호텔 예약 느낌 |

공급자 화면 원칙: 아이콘+사진 위주, 입력은 토글·스테퍼·숫자패드만, 한 화면에 버튼 3개 이하.

### 용어·표기 확정 (LOC 합의, 2026-06-11 — 전 화면 공통)

- 베트남어 빌라 명칭은 **"villa"로 통일** — "biệt thự" 사용 금지
- 빌라 등록 마법사 헤더는 전 단계 **"Đăng ký villa"**로 통일 (a2의 "Thông tin cơ bản"은 섹션 제목으로 이동, 대문자 "Villa" 금지)
- 단계 표기는 **"Bước N/4"** — 슬래시 양옆 공백 없음 (a0-zalo는 "Bước 2/2")
- 청소 관련 어휘는 **"dọn dẹp"** — "vệ sinh" 사용 금지 (a4 헤더 "Dọn dẹp xong")
- 운영자(ko) 화면에 영어 잔존 금지 — 침실/욕실은 **"침실 N · 욕실 N"**, 영어 병기 괄호("거실 (Living Room)" 등)·프로필 영어("Admin User", "Manager", "Master Admin") 금지, 요율 단위는 "% / 정액"
- VND 천단위: **운영자(ADMIN) 화면은 쉼표(1,500,000₫)**, **공급자(vi) 화면은 점(1.500.000₫)**
- 운영자 화면 브랜드 서브타이틀: **"Villa PMS Admin"**
- 운영자 표준 사이드바 8메뉴(순서 고정): **대시보드 / 예약 / 제안 / 빌라 / 청소 검수 / 정산 / 사용자 / 설정**
- ※ Stitch 다크 디자인 시스템(designMd)에는 아직 "VND with dots"로 남아 있음 — 디자인 시스템 문서 갱신 필요(후속)

## Stitch 프롬프트 모음 (영어 입력이 결과가 가장 좋음)

> 공통 팁: 모바일 화면은 "mobile app screen"으로 시작. 5개 화면 동시 생성 기능으로 같은 영역(공급자/운영자)끼리 묶어 생성하면 일관성 유지됨.

### A. 공급자 화면 (모바일, 라이트, 베트남어 라벨)

**A0. 자가 가입 + Zalo 연결 안내 (SPEC F0)**
```
Two mobile app screens for Vietnamese property managers, light theme, very simple.
Screen 1 "Đăng ký": large inputs for name, phone number (numeric keypad style),
password, one big primary button "Đăng ký". Minimal text, no marketing copy.
Screen 2 "Kết nối Zalo": friendly illustration, short instruction text, a large
Zalo-blue button "Kết bạn với OA trên Zalo" with Zalo icon, QR code below,
and a skip link "Để sau". Suitable for non-technical users.
```

> 등록 마법사 4단계 확정: 1) 기본 정보(A2) 2) 위치·참고(A2b) 3) 사진 업로드(A1) 4) 원가 입력(A5)

**A0L. 공급자 로그인 (a0-login)**
```
Mobile app screen "Đăng nhập" (login) for Vietnamese villa suppliers, light theme
with teal primary (#0D9488), same visual tone as "Đăng ký tài khoản". Very simple,
large touch targets (56px+), minimal text, no marketing copy. Small app logo +
"Villa PMS" at top, two large inputs: "Số điện thoại" (phone icon, numeric keypad)
and "Mật khẩu" (lock icon, show/hide eye toggle), one big primary teal button
"Đăng nhập", centered link "Chưa có tài khoản? Đăng ký". Use "villa", never "biệt thự".
```

**A8. 청소 태스크 목록 (a8-cleaning-tasks) — a6 하단 탭 "Dọn dẹp" 목적지**
```
Mobile app screen "Dọn dẹp" (cleaning task list) for Vietnamese villa suppliers and
cleaning staff, light theme teal primary, very simple, large touch targets. Vertical
list of assigned cleaning task cards: villa photo thumbnail, villa name, checkout
date "Trả phòng: 12/06", one status badge per card — four states: Chờ dọn (orange),
Đã gửi (blue), Đã duyệt (green), Bị từ chối (red outline). Right chevron = tap opens
the cleaning photo submission screen (A4). Bottom tabs: Villa, Lịch, Dọn dẹp (active),
Thu nhập. No prices, no KRW, no margin. Use "villa".
```

**A2b. 빌라 등록 마법사 — 위치·참고 정보 (2/4)**
```
Mobile app screen, step 2 of 4 ("Bước 2/4") of a villa registration wizard for
Vietnamese property managers. Light theme. App bar header "Đăng ký villa"
(lowercase v). Optional inputs: "Địa chỉ" address with
pin icon, read-only complex row ("Khu: Sonasea") with map thumbnail, numeric
"Giá thuê tháng (tham khảo)" with VND suffix. All tagged "Không bắt buộc".
Primary "Tiếp tục" + skip link "Bỏ qua bước này".
```

**A5. 빌라 등록 마법사 — 원가 입력 (4/4)**
```
Mobile app screen, final step 4 of 4: nightly supplier cost per season. Header
"Đăng ký villa" (Bước 4/4), title "Giá gốc mỗi đêm", description exactly
"Nhập giá bạn nhận cho mỗi đêm, theo từng mùa." (no commission/fee mention;
never use "muốn nhận" — it reads like a negotiable asking price. LOC 확정 2026-06-11).
Three season cards: Mùa thấp điểm (green), Mùa cao điểm (orange), Cao điểm lễ Tết
(red), big numeric inputs with dot separators and ₫ suffix. Empty season row shows
red warning "Chưa nhập giá" and the submit button "Hoàn tất & Gửi duyệt" is
disabled (gray) until all prices are entered. Flat numeric keypad at bottom.
No KRW, no margin, no pricing advice text.
```

**A6. 내 빌라 홈**
```
Mobile home screen "Villa của tôi" for a Vietnamese villa supplier. Greeting header
with name only (no hardcoded honorific "anh", e.g. "Xin chào, An!"), vertical villa
cards (photo, name, bed/bath as icon+number "🛏 4 · 🛁 3" or "4 phòng ngủ · 3 phòng
tắm" — no English "beds/baths", one status badge: Đang hoạt động green / Chờ duyệt
orange / Chưa thể bán red outline with "Xem việc dọn dẹp" button). Floating teal
"+ Thêm villa". Bottom tabs: Villa (active), Lịch, Dọn dẹp, Thu nhập.
```

**A7. 내 수익**
```
Mobile screen "Thu nhập" for a supplier. Month selector, big summary card (total VND,
paid vs pending split), list grouped by villa: stay date range, nights, supplier cost
in VND, per-row badge Đã thanh toán/Chờ thanh toán. NO sale price, NO margin,
NO customer names. Bottom tabs with Thu nhập active.
```

**A1. 빌라 등록 마법사 — 사진 업로드 단계**
```
Mobile app screen for Vietnamese property managers. Light theme, very simple,
large touch targets, minimal text. Header "Đăng ký villa", step wizard (Bước 3/4),
section title "Tải ảnh lên". A grid of photo upload cards, one per room: Bên ngoài,
Phòng khách, Bếp, Phòng ngủ 1, Phòng ngủ 2, Phòng ngủ 3, Phòng tắm 1, Phòng tắm 2,
Ban công (balcony), Hồ bơi. Each card shows a camera icon or a photo thumbnail with
a green checkmark when uploaded. Progress counter must equal the number of done
cards (e.g. "3/10 ảnh"). Landscape-photo helper note at bottom: ≥14px, dark gray
(#374151) high contrast. Big primary button "Tiếp tục" at bottom.
```

**A2. 빌라 등록 마법사 — 기본 정보 단계**
```
Mobile app screen, step 1 of 4 of a villa registration wizard for Vietnamese users.
Light theme. App bar header "Đăng ký villa" (Bước 1/4), section title "Thông tin cơ
bản". Fields: villa name text input, complex dropdown, bedrooms stepper (+/-),
bathrooms stepper, max guests stepper, two large toggle rows with icons:
"Hồ bơi" (pool) and "Bữa sáng" (breakfast available). One question per visual block,
very large controls, almost no helper text. Primary button "Tiếp tục".
```

**A3. 공급자 캘린더**
```
Mobile app screen: monthly calendar for a villa owner, Vietnamese labels, light theme.
Date cells use color AND pattern (never color alone): Trống = white with green
outline, Đã đặt = solid blue (#2563EB) white text, Giữ chỗ = light blue (#DBEAFE)
with dashed blue border, Đã khóa = gray fill with diagonal hatch stripes. Tapping a
date opens a bottom sheet with two big buttons: "Khóa ngày" and "Hủy khóa". Villa
selector chip row at top. Legend below the calendar: swatches ≥16px, text ≥14px
dark (#1F2937), patterns identical to the date cells. No prices shown anywhere.
```

**A4. 청소 사진 제출**
```
Mobile app screen: cleaning completion checklist for Vietnamese cleaning staff,
light theme. App bar header "Dọn dẹp xong", title "Dọn dẹp xong - Tải ảnh" with
villa name (never "vệ sinh"). List of room photo
upload tiles (same rooms as villa registration), each with camera icon and
done-checkmark state. Progress indicator "5/9 ảnh". Big submit button
"Gửi để duyệt" (submit for approval) disabled until all photos uploaded.
```

### B. 운영자 화면 (PC, 다크, 한국어 라벨)

**B1. 대시보드**
```
Dark admin dashboard for a villa rental operations manager, Korean labels,
desktop web. Top stat cards: 오늘 체크인, 오늘 체크아웃, 가예약 (with countdown
badges), 청소 승인 대기. Below: a horizontal timeline matrix — rows are villas
(쏘나씨 V11, 쏘나씨 V12, 썬셋 사나토 A3...), columns are the next 30 days,
cells colored by status: empty, hold (striped), confirmed (solid blue),
blocked (gray), not-sellable (red outline). Right sidebar: recent activity feed.
Top header bar: a high-contrast bordered chip with direct VND→KRW conversion
"1.000.000₫ ≈ 53,000원". Chart/legend labels in light gray (#D1D5DB) or white.
All VND on admin screens with comma separators (1,500,000₫). Sidebar brand
subtitle "Villa PMS Admin". Modern, dense but readable, dark navy with blue accents.
```

**B2. 제안 링크 생성**
```
Dark admin web screen, Korean labels: "제안 만들기" (create proposal).
Left panel: date range picker, guest count, channel select (여행사/랜드사/직접).
Center: list of available villas as horizontal cards with photo, name, bedrooms,
pool icon, breakfast icon, computed price per night in KRW; checkboxes to select
2-3 villas. Right panel: proposal summary with client name input, expiry select
(24h/48h), and a primary button "링크 생성". Selected villas shown as a stack.
```

**B3. 체크인 검수**
```
Dark admin web screen, ALL labels in Korean (체크인 검수/서명/금액/지우기/업로드 —
no English): check-in inspection for booking #. Sections top to bottom:
1) passport upload area with OCR result chips (name, passport number) and a button
"공급자에게 전달" with Zalo icon, 2) deposit form: amount input, currency select
KRW/VND/USD, status badge, 3) agreement panel showing safety rules text with a
signature pad area and "서명 완료" state, 4) final confirm button "체크인 완료".
Standard 8-item sidebar (대시보드/예약/제안/빌라/청소 검수/정산/사용자/설정),
subtitle "Villa PMS Admin". Tight layout, no large empty area at the bottom.
```

**B4. 체크아웃 사진 비교 검수**
```
Dark admin web screen, Korean labels: checkout inspection with side-by-side
photo comparison. For each room, two photos: left "기준 사진" (baseline),
right "체크아웃 사진" with a camera upload slot. Below comparisons: a toggle
"파손 발견", conditional fields for damage photos and deduction amount in VND
(comma separators 1,500,000₫; deductions in bright red #F87171 for contrast),
and two action buttons: "보증금 전액 환불" (green) and "차감 후 환불" (orange).
Standard 8-item sidebar, subtitle "Villa PMS Admin".
```

**B5. 예약 목록 (SPEC F7)**
```
Dark admin web screen, Korean labels: bookings list for a villa rental operator.
Top filter bar: status tabs (전체, 가예약, 확정, 체크인, 체크아웃, 취소/만료),
date range picker, villa select, channel select. Table rows: villa name, guest name,
check-in/out dates, nights, channel badge, status badge — HOLD rows show an orange
countdown badge like "23시간 남음". Sorted by upcoming check-in. Row click opens
booking detail. Pagination at bottom. Dense but readable, dark navy with blue accents.
```

**B6. 청소 검수 목록·승인 (SPEC F7)**
```
Dark admin web screen, ALL labels in Korean (승인 대기/기준 사진/청소 후 — no
English): cleaning inspection queue. Left: list of cleaning tasks with villa name,
type badge (체크아웃/정기), status badge, submitted time — pending approval items
on top. Right detail panel: grid of submitted room photos side-by-side with
baseline photos, each pair labeled by room name in bright light gray (#E5E7EB)
for contrast. Bottom action bar: green button "승인" and red button "반려" with a
reason text field appearing when 반려 selected. Standard 8-item sidebar,
subtitle "Villa PMS Admin".
```

**B7. 정산 (SPEC F6)**
```
Dark admin web screen, Korean labels: monthly supplier settlements. Top: month
picker and summary cards (지급 대상 공급자 수, 총 지급액 VND). Table grouped by
supplier: supplier name, bookings count, total cost in VND (dot separators like
12.500.000₫), status badge (초안/확정/지급완료), action button per row "지급 완료".
Expandable rows showing each booking line item. Clean financial table style.
```

**B9. 빌라 목록 (SPEC F1)**
```
Dark admin web screen, Korean labels: villas list. Filter tabs (전체/승인 대기/운영 중/
중단) with orange dot on pending, search, complex filter. 3-column villa card grid:
photo, name, supplier name, bed/pool/breakfast icons, status badge, red "판매불가"
tag where cleaning pending, blue "검토하기" button on pending cards.
```

**B10. 빌라 상세·요율 편집 (SPEC F1)**
```
Dark admin web screen: villa detail for approval. Header with status badge, supplier
chip (Zalo 연결 여부), 승인/반려 buttons. Left: room photo grid + basic info card.
Right: rate table — 3 season rows, columns 공급자 원가(VND read-only), 마진(원 고정/%),
판매가(KRW, 자동 제안 tag), 저장 button. Below: iCal import URL list + "+ URL 추가".
```

**B11. 예약 상세 (SPEC F7)**
```
Dark admin web screen: booking detail. Status badge + timeline strip (가예약→확정→
체크인→체크아웃). Left cards: 예약 정보, 가격 스냅샷 (잠금 아이콘 "홀드 시점 가격으로
고정됨"), 결제 기록 table. Right: status-contextual action buttons (체크인 진행/취소/
노쇼 처리) + activity log + "내부 메모" panel (Korean placeholder, 저장하기 button —
no English "Internal Memo"). VND with commas (7,500,000₫). Standard 8-item sidebar,
subtitle "Villa PMS Admin".
```

**B12. 제안 목록 (SPEC F3·F7)**
```
Dark admin web screen: proposals list. Status tabs (전체/활성/사용됨/만료/회수),
"+ 제안 만들기" button. Table: 고객명, villa chips, dates, channel badge, 생성일,
만료 카운트다운 (orange), status badge, row actions 링크 복사 / 회수.
```

**B8. 설정 (SPEC F7)** — (구 B8 묶음에서 분리, 사용자 관리는 B13으로 이동)
```
Dark admin web screen "설정", Korean labels: simple form cards — season calendar
list (시즌 기간: 비수기/성수기/극성수기 rows with date ranges and add button), and
a numeric setting field "가예약 기본 유지 시간" with hours stepper (default 48).
Standard 8-item sidebar (설정 active), subtitle "Villa PMS Admin".
```

**B13. 사용자 관리 (SPEC F0)** — (구 b8-users → b13-users 번호 변경)
```
Dark admin web screen "사용자", Korean labels: table of users with name, phone,
role badge (공급자/청소), Zalo connection status (green "연결됨" or gray "미연결"
badge), villa count, active toggle, and a "Zalo 수동 연결" action. Inactive rows
keep readable contrast (#9CA3AF or lighter text, subtle gray "비활성" badge —
no heavy dimming). Standard 8-item sidebar (사용자 active), subtitle "Villa PMS Admin".
```

### C. 공개 제안 페이지 (모바일 우선, 한국어)

**C1. /p/[token]**
```
Mobile-first hotel-booking style page in Korean, light clean theme, trustworthy.
Header: travel agency greeting "OO여행사님을 위한 제안" with expiry countdown badge
"47시간 후 만료". Then 2-3 villa option cards stacked: each with a photo carousel,
villa name, badges (침실 3 · 수영장 · 조식 포함), nightly price and total in KRW,
check-in/out dates, and a large primary button "이 빌라로 가예약". Footer note about
deposit policy with Korean footer links: 보증금 정책 / 개인정보처리방침 / 이용약관
(no English). Premium but warm feeling, lots of photo space.
```

**C2. 제안 링크 만료/마감 (c2-proposal-expired)**
```
Mobile-first Korean public page, light clean trustworthy theme, same tone as C1:
proposal link expired/closed. Two stacked message states on one screen for design
reference. State 1 만료: soft gray clock icon in a circle, heading "제안이
만료되었습니다", short apologetic text asking to request a new proposal. State 2
마감 (re-validation failed): calendar-x icon, heading "이미 마감되었습니다", text
saying the dates are no longer available. Each state: two large contact buttons —
"카카오톡으로 문의" (KakaoTalk yellow #FEE500, dark text, chat bubble icon) and
"전화 연결" (outline, phone icon). Korean footer links (보증금 정책/개인정보처리방침/
이용약관) + "Villa PMS". No navigation bar, lots of white space.
```

**C3. 가예약 입력 + 완료 확인 (c3-booking-request)**
```
Mobile-first Korean public booking request page, light trustworthy hotel-booking
style, same tone as C1, brand "Villa PMS". Two states stacked for design reference.
State 1 입력: selected villa summary card (photo, name, dates "12.20 (금) ~ 12.24
(화) · 4박", total "1,280,000원"), form with 이름 / 연락처 inputs, info banner with
clock icon "제출 후 24~48시간 동안 해당 빌라가 홀드됩니다. 입금 확인 후 예약이
확정됩니다.", large primary button "가예약 신청하기". State 2 완료: green check
icon, "가예약이 접수되었습니다", booking number chip "예약번호 B-2611", deposit
guide card (은행/계좌번호/입금액/예금주), countdown badge "47:59 남음 — 시간 내
입금 시 예약 확정". Reassuring deposit-policy footer note.
```

## 변환 규칙 (Claude Code용)

- Stitch HTML의 Tailwind 클래스는 출발점일 뿐 — 토큰화 후 컴포넌트로 재구성 (인라인 임의값 남발 금지)
- 이미지 placeholder는 next/image + 실제 업로드 파이프라인으로 교체
- 공급자 화면 변환 시 모든 라벨을 next-intl 키로 추출 (vi 기본, ko 번역 병기)
- 폼은 react-hook-form + zod, 상태 색상은 globals.css 변수로 통일
- Stitch가 만든 임의 데이터(빌라명·가격)는 전부 Prisma 쿼리로 대체

## 디자인 평가 4기준 (QA 채점용 — Anthropic frontend harness 기준 적용)

| 기준 | 질문 | 비중 |
|---|---|---|
| 디자인 품질 | 색·타이포·레이아웃이 하나의 정체성으로 응집되는가, 부품의 나열인가 | 높음 |
| 독창성 | 의도적인 선택의 흔적이 있는가, 템플릿·AI 기본값(흰 카드+보라 그라디언트)인가 | 높음 |
| 완성도 | 타이포 위계, 간격 일관성, 색 조화, 대비 — 기본기 점검 | 보통 |
| 기능성 | 미적 요소와 무관하게, 사용자가 추측 없이 과업을 완수할 수 있는가 | 보통 |

- 공급자(UX-VN) 화면은 기능성 비중 최상 — "베트남 중계인이 설명 없이" 기준이 곧 기능성
- Stitch 1차 출력에 만족하지 말 것: 평가 후 "현재 방향 다듬기 vs 완전히 다른 미학으로 전환" 전략 판단을 1회 이상 수행
