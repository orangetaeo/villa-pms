# T-public-proposal-bank-info — 공개 제안 메인 페이지에 입금 계좌 표시 (#6a)

## 배경
2026-06-24 테오 신규요구 #6: 공개 제안 페이지에 더 많은 정보(입금 계좌 등).
테오 결정: ① 입금 계좌를 메인 페이지에도 ② 취소·환불 정책 ③ 체크인/아웃 시간·이용 규칙.

그라운딩 실측:
- **②③ 중 체크인/아웃 시간 + 이용 규칙(흡연·반려동물·파티)은 메인에 이미 표시됨** (`VillaSalesSection`, page.tsx:222-247에 checkInTime/checkOutTime/smoking/pets/party 전달).
- **취소·환불 정책**은 문구(테오 콘텐츠) + 신규 AppSetting 키 필요 → seed 충돌(BANK_VN 세션 진행 중)·콘텐츠 의존으로 **#6b 분리**.
- **입금 계좌**는 현재 완료 페이지(`done/[bookingId]`)에만 있고 **메인 제안 페이지엔 없음** → 본 태스크.

## 범위 (#6a)
1. 공개 제안 메인 페이지(`app/p/[token]/page.tsx`)에 **입금 계좌 안내 섹션** 추가.
   - 제안 통화(`proposal.saleCurrency`)에 맞는 계좌 세트 자동 선택(VND→베트남 BANK_VN_*, 그 외→한국 BANK_*) — done 페이지 패턴 재사용.
   - 표시: 은행명·계좌번호(복사 버튼)·예금주. **금액은 미표시**(메인은 빌라 미선택 단계).
   - 계좌 미설정 시 섹션 미렌더(또는 "담당자 별도 안내" 폴백 — done 페이지 일관).
2. 배치: 기존 "가예약 후 N시간 내 입금" 안내(shield) 섹션 근처(입금 맥락).

## 범위 밖
- 취소·환불 정책(#6b — 테오 문구 + AppSetting 키, seed 세션 정리 후).
- 체크인/아웃 시간·이용 규칙(이미 VillaSalesSection에 표시 — 작업 불요).
- /p 다국어(#5 — 별도). 본 섹션 라벨은 ko 하드코딩(#5에서 일괄 추출).
- 신규 AppSetting 키·스키마 변경 0(기존 BANK_* 키 재사용).

## 수정 금지 구역 (병렬 세션)
- `lib/cleaning.ts`·`lib/hold.ts`·`lib/proposal.ts`·`docs/DESIGN.md`·`messages/*.json` — 타 세션 WIP.
- `prisma/seed.ts`·`app/api/settings/validators.ts` — BANK_VN seed 세션 영역, 비접촉(신규 키 안 만듦).
- `app/(admin)/bookings/[id]/checkin/*`·`app/(admin)/bookings/checkin-sheet/*` — checkin-v2 세션, 비접촉.

## 완료 기준 (테스트 가능)
- [ ] 메인 제안 페이지에 통화별(KRW/VND) 입금 계좌(은행명·번호·예금주) 표시. 금액 없음.
- [ ] 계좌 미설정(AppSetting 부재) 시 안전 폴백(에러·빈 렌더 없음).
- [ ] 누수 0: bank 외 AppSetting·마진·원가 미조회. proposal select 화이트리스트 무변경(신규 필드 미추가).
- [ ] `npm run typecheck` 0, 단위테스트 그린(통화별 계좌 선택 로직).

## 검증
- 단위테스트: 통화→계좌세트 선택(VND/KRW), 미설정 폴백.
- QA 독립 평가: 공개 페이지 비로그인 렌더 + 누수(마진·계좌 외 설정 미노출) 확인.

## 담당
FE → QA 독립 평가 → PM 보고.
