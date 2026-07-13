# 계약: 운영자 Zalo 알림 → 그룹방 발송 (villa go 주문 알림방)

## 배경
운영자(ADMIN/OWNER/MANAGER/STAFF) 대상 Zalo 알림이 현재 운영자 수만큼 개별 1:1 DM으로 발송된다.
테오가 Zalo 그룹방 **"villa go 주문 알림방"**을 개설 — 운영자 알림을 이 그룹방 1건으로 모아 받고자 함.

## 범위
1. **스키마(additive)**: `Notification.groupThreadId String?` — 설정 시 그룹 발송 대상. 라이브 DB에 raw SQL 적용 + `prisma/migrations-manual/` 보존.
2. **설정**: `AppSetting` 키 `ZALO_ADMIN_NOTIFY_GROUP_ID`(그룹 thread id). 운영자 설정 UI에서 시스템봇 소유자의 GROUP 대화(ZaloConversation threadType=GROUP) 목록 중 선택/해제.
3. **적재 경로 단일화**: 운영자 fan-out 지점(villa-notify·vendor-dispatch·roster-reminder·consumer-signal-notify·security-alerts·zalo-health 등 "운영자 전원" 대상)을 공유 헬퍼로 통일 — 그룹 설정 시 **1행(groupThreadId 부착)**, 미설정 시 기존 개별 DM 유지(폴백).
4. **발송**: `dispatchOne`에서 `groupThreadId` 있으면 시스템봇 `ThreadType.Group` 발송. 미러는 기존 규칙 유지(그룹 대화 미러 가능 시 기록, 불가 시 mirrorSkipped).
5. **문서**: docs/NOTIFICATIONS.md 발송 채널 갱신(운영자 알림 = 그룹 or 개별 DM 폴백), ADR 1건.

## 수정 금지 구역
- 체크아웃 혼합 수납 관련 파일(타 세션 선점: checkout-mixed-settlement)
- 메인 폴더 untracked 파일(design-audit/, kakao-icon-*, villa-go-*.png)

## 완료 기준 (테스트 가능)
- [ ] 그룹 설정 시 운영자 알림이 Notification 1행으로 적재되고 그룹방에 1건 발송된다 (개별 DM 미발송)
- [ ] 그룹 미설정 시 기존과 동일하게 운영자별 개별 DM 발송 (회귀 없음)
- [ ] 공급자·벤더·게스트 대상 알림은 변경 없음 (그룹으로 새지 않음 — 누수 검사)
- [ ] 그룹 발송 본문에 마진·판매가 등 기존 화이트리스트 외 필드 미노출 (빌더 재사용)
- [ ] 설정 UI에서 그룹 선택·해제 가능, 해제 시 개별 DM 복귀
- [ ] next build 통과 + 기존 zalo 테스트 통과

## 검증 방법
- 단위: dispatchOne 그룹 분기·fan-out 헬퍼(설정 on/off) 테스트
- QA: 권한 누수 체크리스트(그룹 오발송·마진 노출) + 실 그룹방 발송 확인(프로덕션, 시스템봇이 그룹 멤버여야 함)

담당: INTEG(구현) + TDA(스키마 승인) + QA. 세션: worktree `wt/zalo-admin-group-notify`.
