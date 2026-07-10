# T-users-zalo-link-ux — 회원관리 Zalo 수신 연결 패널 실사용 가능하게 개선

- 상태: **완료** (2026-07-10, PR #221 머지·배포 87e98af·프로덕션 E2E PASS)
- 발단: 테오 "알림 발송 건은 사용자관리에서 관리할 수 있게 하자". LINK_ZALO/UNLINK_ZALO API·감사로그·중복 409는 이미 완비(T1.8)이나, 연결 후보 드롭다운이 **미연결 대화방 507개(그룹 42 포함)를 검색 없이 나열** — 동명 계정("Villa Go" 3개) 구분 불가로 실사용 불가. 김태진 알림 연결도 DB 수동 작업으로 처리했던 배경.

## 범위 (2개 파일 + i18n)

1. `app/(admin)/users/page.tsx`
   - 후보 쿼리: `userId: null` → `userId: null, threadType: "USER"` (그룹 제외)
   - select에 `lastMessageAt` 추가, 정렬 `lastMessageAt desc`(null은 뒤로 — Prisma `{ sort: "desc", nulls: "last" }`)
   - 연결 표시용: 사용자별 연결 대화방 이름 매핑(`zaloConversation.findMany({ where: { userId: { not: null } }, select: { userId, displayName } })`) → UserRow에 `zaloName: string | null` 추가
2. `app/(admin)/users/users-manager.tsx`
   - 매칭 패널에 검색 입력 추가(클라 필터, displayName 부분일치·대소문자 무시), 결과 상위 30개만 렌더 + "N건 더 있음, 검색으로 좁히세요" 안내
   - 후보 행: 이름 + 최근 활동일(YYYY.MM.DD, 없으면 "대화 없음" 뱃지) — 동명 구분용. select 대신 클릭 선택 리스트(라디오 스타일)
   - 연결된 사용자: "연결됨" 옆에 연결 대화방 이름 표시 + "변경" 버튼(패널 열어 바로 재연결 — 기존 LINK_ZALO가 이전 연결 자동 해제하므로 API 변경 불필요)
3. `messages/ko.json`·`vi.json` — adminUsers.zalo 신규 키 동시 추가 (운영자 화면 vi 필수 규칙)

## 불변 조건 (수정 금지)

- `app/api/users/[id]/route.ts` — API 변경 없음 (LINK_ZALO 기존 동작 그대로)
- 알림 발송 로직(lib/zalo, villa-notify 등) 무변경
- passwordHash 등 민감 필드 select 금지 유지, 대화 내용(text)은 후보 목록에 미노출(이름·활동일만)

## 완료 기준 (QA)

- [x] /users에서 미연결 사용자 → 연결: "Sungjun" 검색 → 후보 1건(활동일 뱃지) → 연결됨 + "Sungjun Park" 표시 (프로덕션 실측)
- [x] 연결된 사용자에 대화방 이름 표시 — 김태진 "Villa Go"·DK "Lee Dokyung" 실측 (리뷰 중 zaloName 매핑 키 버그 수정: Zalo uid → User.id)
- [x] 해제 → confirm → DB에서 User.zaloUserId null + ZaloConversation.userId null 원복 확인
- [x] 그룹 대화방 후보 제외 (서버 쿼리 threadType USER)
- [x] ko/vi 키 패리티 (adminUsers 89/89·관련 vitest 7/7)
- [x] tsc·next build 통과. 테스트 계정 생성·검증·삭제 완료
