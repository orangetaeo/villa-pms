# 계약: Zalo 그룹방 아바타 표시 (관리자 메시지함)

## 배경
테오가 Zalo 앱에서 그룹방 아바타를 등록했으나 /messages에는 이니셜 폴백만 표시.
원인: ZaloConversation.avatarUrl 채움 경로 3곳이 전부 개인 프로필 API(getAvatarUrlProfile) 기준 —
그룹 id로는 항상 실패해 GROUP 대화 avatarUrl이 영영 null.
getGroupInfo 응답에는 그룹 아바타(avt/fullAvt)가 있으나 저장하지 않음.

## 범위 (lib/zalo-runtime.ts 중심, 스키마 무변경)
1. GROUP 아바타 조회 헬퍼: getGroupInfo → fullAvt ?? avt (zca-js 실제 필드명 확인).
2. maybeRefreshAvatar: conv.threadType 분기 — GROUP은 그룹 조회, USER는 기존. TTL·fetchedAt 억제 로직 동일.
3. maybeRefreshGroupMembers: getGroupInfo를 이미 호출하므로 아바타도 함께 저장(avatarUrl+avatarFetchedAt).
4. backfillAvatars: threadType select 후 GROUP은 그룹 조회로 분기.
5. FE: 인박스·대화 헤더가 avatarUrl을 threadType 무관하게 렌더하는지 확인만 (렌더 경로가 이미 공통이면 FE 무변경).

## 수정 금지 구역
- 체크아웃 보증금 상계 관련 파일(타 세션 선점), 메인 폴더 untracked 파일

## 완료 기준
- [ ] GROUP 대화 수신/재연결 시 avatarUrl이 그룹 아바타로 채워진다 (기존 null 행은 백필·수신 재시도로 자동 회복 — avatarUrl null이면 TTL 무관 재조회하는 기존 로직 확인)
- [ ] USER 대화 아바타 동작 회귀 없음 (기존 테스트 통과)
- [ ] 실패 시 avatarFetchedAt만 갱신·리스너 비블로킹(fire-and-forget) 기존 계약 유지
- [ ] tsc·관련 테스트·next build 통과

담당: INTEG + QA. 세션: worktree zalo-admin-group-notify(재사용), 브랜치 wt/zalo-group-avatar.
