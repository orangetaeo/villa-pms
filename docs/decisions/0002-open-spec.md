# ADR-0002: 오픈 스펙 확정 (SPEC v1.1)

- 날짜: 2026-06-11 / 상태: 승인 (테오)
- 배경: "최소로 오픈하고 오픈 후 개선" 사업 방침에 따라 미결 이슈를 확정하고 오픈에 필수인 공백(가입·정산·증빙)을 보강.

## 결정

1. **이미지 저장소 = Cloudflare R2** — 증빙 사진(분쟁 대비) 영구 보존, 서버 재배포와 무관
2. **인증 = 전화번호+비밀번호 자가 가입** — 계정 승인 절차 없음, 빌라 승인 게이트(PENDING_REVIEW)가 검증 역할. Zalo 로그인은 Phase 2
3. **Zalo 연결 = OA 팔로우 webhook + 전화번호 매칭** — 사용자는 각자 본인 Zalo 계정 사용, 가입 전화번호로 zaloUserId 매핑. 실패 시 ADMIN 수동 매칭
4. **홀드 기본 48h** — AppSetting(`HOLD_HOURS_DEFAULT`) 모델 신설, 운영 중 조정 가능
5. **정기 방역 월 1회 고정** — 빌라별 설정은 오픈 후 개선(IDEAS)
6. **스키마 추가: AuditLog + AppSetting** — AuditLog는 글로벌 표준(audit-log-system 템플릿). 보증금 차감·정산·요율 변경의 분쟁 증빙이 사업적으로 필수
7. **F6 최소 정산을 Phase 1에 포함** — 오픈 다음 달부터 공급자 지급이 필요. 월 원가 집계 + PAID 처리 + 공급자 원가 조회만 (다중 통화·환차·PDF는 Phase 2)
8. **예약 변경 미지원(MVP)** — 취소 후 재생성. 가격 스냅샷 무결성 우선
9. **여권 사진 체크아웃 90일 후 삭제** — 민감정보 최소 보관

## 영향
- prisma/schema.prisma v1.1 (AuditLog·AppSetting), docs/SPEC.md v1.1 (F0·F6 신설), docs/LAUNCH.md 신설, TASKS.md 태스크 추가 (T0.9, T1.7, T3.7, T4.5)
