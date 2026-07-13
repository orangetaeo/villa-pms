# 계약서: 셀프 체크인 여권 사진 필수화 (guest-passport-photo-required)

- 상태: 착수 (2026-07-13)
- 담당: FE (Opus) / QA 독립 검증
- 발단: 테오 지시 — "여권 사진을 필수 입력으로". 여권 스킵 → OCR 명단 부재 → 티켓 인원별 모드 불가 연쇄(ticket-variant-qty-precheckin 후속)

## 배경 (Triage)

- G4 여권 단계(guest-flow.tsx step 3)의 "체크인 완료" 버튼이 업로드 여부와 무관하게 활성 + "나중에 하기" 스킵 버튼 존재 → 여권 0장으로 체크인 완료 가능.
- 업로드 상태는 GuestPassportStep 내부 state라 부모(GuestFlow)가 완료 수를 모름.
- 재방문 시 슬롯이 전부 empty로 초기화 — 서버(guestCheckinToken.passportPhotoUrls)에 누적된 기존 업로드가 UI에 반영 안 됨.

## 범위

1. **완료 게이트**: G4에서 투숙 인원 수(guestCount)만큼 슬롯 전원 업로드 완료(done)일 때만 "체크인 완료" 활성. 미달 시 disabled + 진행 안내("여권 사진 n/N — 전원 업로드 후 완료 가능" 취지, 신규 i18n 키 5언어).
2. **스킵 제거**: "나중에 하기" 버튼 제거(라벨 키는 잔존해도 미사용 처리 가능).
3. **재방문 반영**: 로더(/g/[token] page → GuestFlowProps)에 기존 업로드 장수(passportPhotoUrls.length) additive 전달 → 슬롯 초기 상태 done 처리(min(기존 장수, 슬롯 수)). 기존 업로드 게스트가 재업로드를 강요당하지 않게.
4. GuestPassportStep 완료 수를 부모로 리프트(콜백 or state 리프트) — GuestFlow가 게이트 판정.

## 수정 금지 구역

- app/api/** (여권 업로드 API 불변 — 서버 강제 없음: "체크인 완료"는 클라 단계 개념), prisma/schema.prisma.
- 동의서·비품·완료 화면 등 타 단계 로직.

## 완료 기준 (테스트 가능)

- [ ] 여권 0장 상태에서 "체크인 완료" disabled + 진행 안내 노출, "나중에 하기" 부재.
- [ ] guestCount명 전원 업로드 시 버튼 활성 → 완료 화면 진입.
- [ ] 업로드 이력이 있는 토큰 재방문 시 해당 슬롯 done 표시·게이트에 반영.
- [ ] 신규 문구 5언어(ko/en/ru/zh/vi), 하드코딩 없음.
- [ ] `next build` 통과.

## 검증 방법

QA가 dev 서버 + 라이브 토큰(읽기 전용)으로 Playwright 실렌더 검증. 실제 여권 업로드는 더미 이미지 1장 이내로 제한(증빙 저장소 오염 최소화)하거나 DOM 상태 조작 없이 버튼 disabled 상태 확인 중심.
