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
- 운영자 표준 사이드바 **10메뉴**(순서 고정, ADR-0003으로 "메시지" 삽입 + "공실 보드" 추가): **대시보드 / 예약 / 제안 / 빌라 / 공실 보드 / 청소 검수 / 정산 / 메시지 / 사용자 / 설정**
  - 디자인 산출물 중 9메뉴 적용은 b14 1장뿐 — 기존 b1~b13 디자인은 8메뉴 그대로 두고, **Next.js 변환 단계의 공통 Sidebar 컴포넌트에서 일괄 10메뉴로 구현**한다 (화면별 재수정 금지). "공실 보드"(/availability, T-admin-availability-board)는 빌라 다음에 배치
- ※ Stitch 다크 디자인 시스템(designMd)에는 아직 "VND with dots"로 남아 있음 — 디자인 시스템 문서 갱신 필요(후속)

### 레이아웃·타이포 규칙 (DESIGN 확정, 2026-06-11 — 한국어 화면 전수 적용)

테오 보고 "글자 세로 낙하"(b10 시즌 태그, b12 채널/상태 배지·날짜·버튼) 박멸 규칙. **Next.js 변환 시 전역 CSS(globals.css)로 강제할 것** — 화면별 클래스 누락에 의존하지 않는다.

- **`word-break: keep-all`** — 한국어 본문 전체(`body`)에 적용. 한글 단어가 1자씩 세로로 꺾이는 현상 방지
- **`white-space: nowrap`** — 모든 배지·칩·태그(`span[class*="rounded"]`), 버튼(`button`), 테이블 헤더(`th`), 날짜·금액·카운트다운 셀(`.tabular-nums`)에 적용
- 좁은 열의 보조 정보(이메일 등)는 nowrap 대신 **`truncate` + `max-w-*`**로 말줄임 처리 (예: b12 고객 이메일 `max-w-[170px]`)
- 모바일(390px) 공개 화면에서 제목과 칩이 한 행에 있으면 제목은 `text-xl` 이하 + 칩에 `shrink-0`, CTA 버튼은 `px-4` 이하로 overflow 방지
- **한글 폰트 폴백 필수**: 운영자(b) `"Public Sans", "Noto Sans KR", sans-serif`, 공개(c) `"Be Vietnam Pro", "Noto Sans KR", sans-serif` — Public Sans·Be Vietnam Pro는 한글 글리프가 없어 폴백 없이는 시스템 폰트로 제각각 렌더링됨
- 날짜는 **YYYY.MM.DD 점 표기** (2026-07-15 같은 하이픈 금지), 샘플 연도는 2026으로 통일
- 다크(운영자) 색 표준: 본문/사이드바 배경 `#0F172A`, 카드 `#1E293B`, 보더 `#1E293B(slate-800)`, 포인트 블루 `#3B82F6` — 사이드바에 `#1E293B`·`slate-950`·teal 액센트 금지 (예외: 역할 시맨틱 컬러 — 공급자=teal, 청소=퍼플 배지는 유지)
- 사이드바 브랜드 블록 표준: `Villa PMS`(white) + 서브타이틀 `Villa PMS Admin`(10px, slate-500, uppercase, tracking-widest), 프로필은 "관리자 / 최고 관리자"

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

> 등록 마법사 **5단계** 확정(ADR-0003 결정2로 비품 단계 삽입): 1) 기본 정보(A2) 2) 위치·참고(A2b) 3) 사진 업로드(A1) 4) **비품(A9)** 5) 원가 입력(A5)
> 기존 A1·A2·A2b·A5 디자인의 "Bước N/4" 표기는 재생성하지 않고 변환 단계에서 ICU 변수(`Bước {n}/{total}`)로 N/5 재번호 처리

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

**A9. 빌라 등록 마법사 — 비품 입력 (4/5, ADR-0003 결정2)**
```
Mobile app screen, step 4 of 5 of a villa registration wizard for Vietnamese property
managers (non-technical users). Light theme, teal primary #0D9488, large touch targets,
minimal text. Header "Đăng ký villa", step "Bước 4/5", section title "Tiện nghi & đồ
dùng" with a small chip "Không bắt buộc". Four category tabs as a horizontal chip row:
Đồ bếp (active), Đồ phòng tắm, Thiết bị điện, Minibar — size the chips so the 4th tab
peeks into view (scroll affordance). Active tab content: 2-column grid of large
checkbox tiles, each = icon + short Vietnamese label, NO text inputs (Nồi cơm điện,
Chảo, Dao & thớt, Bát đĩa, Ly cốc, Ấm đun nước, Lò vi sóng, Gia vị), 3 selected with
teal border + check. Below a dashed divider captioned "Tham khảo — tab Minibar":
the Minibar tab content as a vertical list with +/− quantity steppers (Nước suối 4,
Nước ngọt 2, Bia 0, Bánh kẹo 3). Bottom: primary teal "Tiếp tục" + centered link
"Bỏ qua bước này". Use "villa", never "biệt thự". No prices, no currency, no KRW,
no margin — nothing about money.
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
(24h/48h — never "무제한"), and a primary button "링크 생성". Selected villas shown
as a stack. Channel-based currency switching (ADR-0003): show 여행사 selected, so all
sale prices switch to VND with comma separators ("9,800,000₫"); helper caption under
the channel selector "여행사·랜드사 채널은 VND로 결제됩니다"; bottom chip
"환율 참고: 1,000,000₫ ≈ 53,000원 (수동 환율 기준)". Summary = 총 판매가 합계 +
마진 요약 + 최종 제안 금액 (all consistent numbers; margin allowed on ADMIN screens) —
NO "채널 수수료/예상 수익" commission block (1차 검수 결정).
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
right "체크아웃 사진" with a camera upload slot. Between the photo comparisons and
the damage toggle (ADR-0003): a READ-ONLY section "미니바 확인" with "읽기 전용" chip —
checklist rows of minibar items with stocked quantity (생수 비치 4개 / 음료 2개 /
맥주 0개 / 과자 3개, inspector checkboxes) and a gray info note "소모된 품목은 자동
계산되지 않습니다 — 차감액(VND) 입력란에 수기로 기록하세요." Below: a toggle
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
check-in/out dates, nights, channel badge, 금액 column, status badge — HOLD rows show
an orange countdown badge like "23시간 남음". The 금액 column mixes currencies by each
booking's saleCurrency (ADR-0003): direct rows "450,000원", agency rows "12,800,000₫"
(commas) — right-aligned, tabular-nums, nowrap, ONE column only. Sorted by upcoming
check-in. Row click opens booking detail. Pagination at bottom. Dense but readable,
dark navy with blue accents.
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
picker and summary cards — TWO separate revenue cards by currency (ADR-0003):
"KRW 매출 12,450,000원 (직접 채널)" and "VND 매출 86,200,000₫ (여행사·랜드사 채널)"
with a gray note "통화별 별도 집계 — KRW와 VND는 합산하지 않습니다", plus 지급 대상
공급자 수 and 총 지급액 VND (supplier payouts stay VND only). Table grouped by
supplier: supplier name, bookings count, total cost in VND (comma separators like
12,500,000₫ — admin screens use commas), status badge (초안/확정/지급완료), action
button per row "지급 완료". Expandable rows showing each booking line item (Korean
villa names only). Clean financial table style.
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
Right: rate table — 3 season rows, columns in this exact order (ADR-0003):
시즌 | 공급자 원가(VND, read-only) | 마진(% / 정액 — FIXED_VND) | 판매가(VND, editable,
commas) | 판매가(KRW 환산 참고, "자동 제안" tag), 저장 button. Below the rate table:
a READ-ONLY card "비품 현황" with a small "읽기 전용" chip — 2x2 category summary
(주방용품 N종/화장실용품 N종/가전류 N종/미니바 N종) + compact minibar quantity line
(생수 4 · 음료 2 · 맥주 0 · 과자 3), no edit buttons (supplier manages amenities).
Below: iCal import URL list + "+ URL 추가".
```

**B11. 예약 상세 (SPEC F7)**
```
Dark admin web screen: booking detail. Status badge + timeline strip (가예약→확정→
체크인→체크아웃). Left cards: 예약 정보, 가격 스냅샷 (잠금 아이콘 "홀드 시점 가격으로
고정됨", title chip "판매 통화: KRW" — booking's saleCurrency, ADR-0003), 결제 기록
table where each amount row shows its currency explicitly and rows may mix (입금
"1,350,000원" / 현지 보증금 "7,500,000₫" — right-aligned, tabular-nums, nowrap). Right: status-contextual action buttons (체크인 진행/취소/
노쇼 처리) + activity log + "내부 메모" panel (Korean placeholder, 저장하기 button —
no English "Internal Memo"). VND with commas (7,500,000₫). Standard 8-item sidebar,
subtitle "Villa PMS Admin".
```

**B12. 제안 목록 (SPEC F3·F7)**
```
Dark admin web screen: proposals list. Status tabs (전체/활성/사용됨/만료/회수),
"+ 제안 만들기" button. Table: 고객명, villa chips, dates, channel badge, 생성일,
만료 카운트다운 (orange), 금액 column mixing currencies by channel (agency rows
"12,800,000₫" with commas, direct rows "1,280,000원" — right-aligned, tabular-nums,
nowrap, ADR-0003), status badge, row actions 링크 복사 / 회수.
```

**B14. 메시지 — Zalo 채팅 (b14-zalo-chat, ADR-0003 결정3)**
```
Dark admin web screen "메시지" (Zalo chat with suppliers), desktop, ALL labels Korean,
dark navy (#0F172A bg/sidebar, #1E293B cards, blue #3B82F6), Noto Sans KR fallback.
Sidebar: standard NINE menus (대시보드/예약/제안/빌라/청소 검수/정산/메시지(active)/
사용자/설정), brand "Villa PMS" + subtitle "Villa PMS Admin", profile "관리자/최고
관리자". Main = two-pane messenger. LEFT inbox (~320px): search "공급자 검색",
conversation rows (avatar, supplier name, truncated last message, time, blue unread
badge); one row tagged gray "48시간 경과"; first row selected. RIGHT conversation:
header with supplier name + green "Zalo 연결됨" badge + villa chip. Incoming bubbles
(slate, left) show the Vietnamese original, then INSIDE the bubble a divider + Korean
translation line with tiny label "번역" and a hide-translation toggle icon. Outgoing
bubbles (blue, right) in Korean; one outline bubble tagged "시스템 알림" (F5 mirror).
Composer: Korean input labeled "메시지 입력 (한국어)" + attached strip "베트남어
미리보기" with the Vietnamese translation and refresh icon + blue "전송" button.
Below a dashed divider "디자인 참고 — 48시간 경과 상태": the same composer DISABLED
with an amber banner exactly "마지막 수신 후 48시간이 지나 응답할 수 없습니다.
시스템 알림은 정상 발송됩니다." (변환 시 단일 상태만 렌더)
```

**B1-M. 대시보드 모바일 변형 (b1-mobile, 390px, ADR-0003 결정4)**
```
Mobile app screen (390px), Korean, dark admin dashboard MOBILE variant. Dark navy
#0F172A, cards #1E293B, blue #3B82F6, Noto Sans KR fallback, keep-all/nowrap rules.
Header: hamburger icon, brand "Villa PMS" + tiny "Villa PMS Admin", bell with red dot.
Top of content: full-width red alert banner "iCal 충돌 · 쏘나씨 V12 ·
2026.07.15~07.17 외부 채널 예약과 겹침" with chevron. Then 2x2 stat cards: 오늘
체크인 / 오늘 체크아웃 / 가예약 (orange countdown badge "23시간") / 청소 승인 대기.
Then, INSTEAD of the timeline matrix, a today-centric list with sections: "오늘
체크인" (rows: villa name, guest + nights + time, blue 확정 badge), "오늘 체크아웃",
"청소 검수 대기" (제출 시간, orange 승인 대기 badge), "만료 임박 홀드" (client name,
orange monospace countdown "05:23 남음"). Each row = compact card with bold villa
name (nowrap), small slate detail line, badge, right chevron. Dates YYYY.MM.DD.
No timeline matrix, no English.
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

**B18. 미니바 재고 (b18-minibar-inventory, SPEC F8 · ADR-0019 §4.1·§6)**
```
Dark admin web screen "미니바 재고", Korean, standard 10-menu sidebar + 통계, brand
"Villa Go" + subtitle "Villa Go Admin", dark navy (#0F172A bg/sidebar, #1E293B cards,
blue #3B82F6), Public Sans + Noto Sans KR fallback, keep-all/nowrap. Top: a red alert
banner "재고 부족 · 3개 빌라 보충 필요" with a "부족만 보기" button. Filter row
(전체 / 부족만). Table: 빌라 | 품목 | 비치 목표 | 현재고 | 상태 badge (충분 green /
부족 red, 현재고<목표일 때 현재고 숫자 red bold) | per-row "입고" button (부족 rows =
solid blue, 충분 rows = outline). Right sticky 입고 form: 빌라 select · 품목 select ·
입고 수량 stepper · 매입 단가 (VND, commas, with a small visibility/eye icon = canViewFinance
전용) · note "매입 단가 입력 시 미니바 마진 통계가 활성화됩니다." · "입고 기록" button.
VND with commas (9,000₫). 환율 참고 chip in header. 매입 단가는 canViewFinance만 본다.
```

**B19. 서비스 카탈로그 (b19-service-catalog, SPEC F8 · ADR-0019 §4.2·§6)**
```
Dark admin web screen "서비스 카탈로그" (부가서비스 판매 메뉴 관리), Korean, standard
10-menu sidebar, brand "Villa Go" + subtitle "Villa Go Admin", dark navy palette,
Public Sans + Noto Sans KR. Header "+ 메뉴 추가" button. 3-column card grid of catalog
items: photo with a type badge overlay (BBQ orange / 티켓 sky / 가이드 violet / 차량
emerald / 오토바이 rose) + active/중단 status overlay, name (ko), 판매가 KRW
"1,800,000원" + 판매가(VND) "1,650,000₫", 매입원가 (gray, small eye icon, canViewFinance
only) "1,200,000₫", 마진 chip (emerald "마진 27%"), 옵션 chips on 차량 card (기사 포함 /
기사 불포함 −200,000원), active toggle (blue). One 중단 card grayscaled. Last grid cell =
편집 modal preview card: 이름 ko/vi/en, 판매가 KRW·VND, 원가 VND (amber text), 단위, 사진
업로드, 옵션 추가, 판매 활성 toggle, 저장 button. VND commas. 원가·마진 = 운영자 전용.
```

**B20. 예약 상세 — 부가옵션 주문 패널 + 게스트 청구서 (b20-booking-addon-orders, SPEC F8 · ADR-0019 §6·§6.5)**
```
Dark admin web screen: a "부가옵션 주문" panel inside booking detail (예약 B-2611,
쏘나씨 V11), Korean, standard 10-menu sidebar, brand "Villa Go", dark navy palette.
Panel header with a pulsing amber highlight "게스트 요청 1건 대기". Table of ServiceOrder
rows: 메뉴명 | 수량 | 출처 chip (게스트 요청 = teal "GUEST" / 운영자 = gray) | 판매가 |
원가 (canViewFinance, VND commas; REQUESTED rows show "—") | 상태 badge (요청 amber /
확정 blue / 제공완료 emerald / 취소 gray strikethrough) | per-row actions. REQUESTED row
is highlighted (amber tint) and its 처리 cell has a 확정가 input + 확정 (green) / 취소
buttons; 확정 rows show 제공완료 / 취소. Below: a 체크아웃 게스트 청구서 mini-summary —
미니바 소비 합계 (235,000₫) + 확정 옵션 합계 (890,000원) with note "통화별 별도 집계 —
KRW와 VND는 합산하지 않습니다", 보증금 별도 표기, 결제수단 select (현금/계좌이체/기타),
게스트 청구액 통화별 표기, "정산 완료 기록" button (emerald). VND commas. 통화 분리(ADR-0003).
```

### C. 공개 제안 페이지 (모바일 우선, 한국어)

> **VND 변형 (ADR-0003 결정1)**: C1·C3은 여행사·랜드사 채널용 VND 변형이 존재한다
> (`design/stitch/c1-vnd`, `c3-vnd`). KRW 원본을 대체하지 않는 별도 변형으로, 가격만
> "12,800,000₫" **쉼표** 표기(한국어 화면 표기 규칙 우선 — ADR 본문의 "점 표기"는 정정
> 대상)로 바꾸고 원가·마진·KRW 환산값은 절대 노출하지 않는다. 변환 시 단일 페이지가
> `Proposal.saleCurrency`로 분기 렌더.

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

### G. 게스트 셀프 체크인 (`/g/[token]`, 모바일 390px, 라이트, 한국어 — ADR-0019 §5, SPEC F9)

> **마진 비공개 절대원칙**: G1~G5 어디에도 원가(costVnd)·마진·KRW↔VND 환산값·다른 예약·전체
> 재고를 표시하지 않는다. 미니바·부가옵션은 **판매가만** 노출. 브랜드 "Villa Go", C1/C3 라이트·
> 신뢰감 톤 계승(teal #0D9488, Be Vietnam Pro + Noto Sans KR). 게스트는 한국 여행객 대상 ko 기본,
> 동의서만 `?lang=`로 5개국어. 4단계 진행바: 비품 확인 / 이용 동의 / 옵션 선택 / 완료.

**G1. 셀프 체크인 홈·예약 확인 (g1-guest-checkin-home, 단계 진입)**
```
Mobile-first Korean guest self check-in welcome page, light clean trustworthy hotel
tone (same as proposal page C1), brand "Villa Go". Header greeting "체크인을 시작합니다",
booking summary card: villa name "쏘나씨 V11", dates "2026.07.15 (수) ~ 2026.07.18 (토) ·
3박", guests "성인 4명", check-in/out time (15:00 / 11:00). A horizontal 4-step progress
indicator: 비품 확인 / 이용 동의 / 옵션 선택 / 완료 (step 1 active). Big primary button
"체크인 진행하기". Reassuring lock note "이 링크는 고객님의 예약 한 건에만 연결됩니다."
Footer "Villa Go". NO margin/price/cost/다른 예약 anywhere.
```

**G2. 비품 확인 (g2-guest-amenities, step 1/4)**
```
Mobile-first Korean page "비품 확인", step 1/4 (top progress bar 1/4). Room amenities
grouped (주방/욕실/가전) as read-only icon+label chips, then a "미니바" section
("소비 시 유료"): vertical list rows with item name, stocked quantity "비치 4개", and
unit SALE price only "생수 15,000₫" (NO cost, NO margin) with a gray note "소비하신
미니바는 체크아웃 시 정산됩니다 (현금/계좌이체)." A checkbox "비품을 확인했습니다".
Sticky primary button "다음". VND commas.
```

**G3. 이용 동의서 서명 (g3-guest-agreement, step 2/4)**
```
Mobile-first Korean page "이용 동의서", step 2/4. Document title "빌라 이용 동의서" +
version chip "버전 2026-06", a language selector chip row (한국어 active / Tiếng Việt /
English / 中文 / Русский), scrollable agreement clauses (안전 수칙·수영장 안전·기물
파손·보증금). A dashed signature pad with "여기에 서명해주세요" placeholder and a
"지우기" link, then "위 내용에 동의하며 서명합니다" checkbox. Primary button
"동의하고 서명 완료" (disabled gray until signed). lib/agreement.ts 본문 연결.
```

**G4. 부가옵션 선택 (g4-guest-addons, step 3/4)**
```
Mobile-first Korean page "옵션 선택", step 3/4, brand "Villa Go". Info banner "요청 후
운영자 확인 시 확정됩니다. 결제는 체크아웃 시 현금/계좌이체로 정산합니다." Vertical
cards from the service catalog: each = photo, type badge, name, short desc, SALE price
KRW only with unit, and a +/− quantity stepper. NO cost/margin anywhere. KRW commas.

Catalog item option structure (ADR-0019 §4.2): variants(상호배타 1택, 가격 대체) +
addons(다중선택, 가산) + modifiers(토글 가산). 합계는 sticky 하단바 "합계 (예상)"으로 갱신.

Cards (7종):
- 통돼지 BBQ (BBQ) 1,800,000원 / 1마리
- 입장권 (티켓) 95,000원 / 1인
- 일일 가이드 (가이드) 350,000원 / 1일
- 차량 렌트 (차량, teal border) — variants 라디오 1택: 기사 포함 700,000원 / 기사 불포함
  500,000원 (선택 시 가격 대체)
- 오토바이 렌트 (오토바이) 120,000원 / 1일
- 마사지 (마사지 섹션 — 종류별 항목, 섹션 헤더 "마사지" + spa 아이콘 아래 묶음):
  · 풋마사지 — variants 시간 1택: 30분 250,000 / 60분 400,000원 (컴팩트 카드 + 수량)
  · 바디마사지 — 종류 칩 1택(아로마·핫스톤·건식) + 시간 1택(30/60/90/120). 아로마 기준
    400,000 / 650,000 / 900,000 / 1,150,000원, 핫스톤 +50,000·건식 −50,000 보조표기
  · 전 마사지 공통 modifier 토글 "출장 (방문 마사지)" +100,000원 (끄면 센터) — 섹션 하단 1개
- 이발소 (귀) (이발소, teal border) — variants 시간 라디오 1택: 60분 400,000 / 90분
  550,000원; addons 다중선택 13종은 카드의 "세부 시술 선택 (13)" 버튼 → 바텀시트
  체크리스트(항목 가격 우측정렬 tabular-nums): 족욕 80,000·귀청소 100,000·면도 60,000·
  손·발톱 관리 150,000·콧털 정리 40,000·스톤 마사지 200,000·오이팩 90,000·허벌 케어
  180,000·전신 마사지 300,000·발 마사지 150,000·두피 마사지 120,000·태국식 스트레칭
  130,000·베트남식 샴푸 70,000원. 선택 개수·합계를 카드(칩 "N개 선택", +금액)와 하단바에 반영

Sticky bottom bar: running total "합계 (예상) 2,630,000원" + button "이 옵션 요청하기".
NO cost/margin/환산/타예약 anywhere — 게스트는 판매가만 본다.
```

**G5. 요청 완료 (g5-guest-done, step 4/4)**
```
Mobile-first Korean page "요청 완료", step 4/4 (full progress bar). Green check icon,
"체크인 정보가 접수되었습니다". Cards: 이용 동의서 서명 완료 (시각 2026.07.15 14:22 ·
버전 2026-06); 요청한 옵션 list with quantity, SALE prices and amber "확인 대기" badges,
예상 합계 "2,690,000원". A settlement note card "미니바 및 선택하신 옵션은 체크아웃 시
정산됩니다 (현금/계좌이체). 운영자 확인 후 최종 금액을 안내해 드립니다." Sticky button
"확인". Footer "Villa Go". 판매가만, NO cost/margin.
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
