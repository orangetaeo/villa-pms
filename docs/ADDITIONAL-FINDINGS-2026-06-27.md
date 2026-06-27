# 추가 발견 + 두 문서 최종 확인 (2026-06-27)

> 테오 요청: ROLE-AUDIT·MOBILE-RESPONSIVE 두 문서가 모두 처리됐는지 최종 확인 + 문서 밖 신규 이슈 발굴·문서화·수정.

---

## Part A — 두 문서 전 항목 최종 상태 (모두 처리됨)

### ROLE-AUDIT-2026-06-27.md
| 항목 | 상태 |
|---|---|
| H1/C1 라이트포털 pagination i18n | ✅ 수정·배포·프로덕션 검증(PR #91) |
| H2 파트너↔운영자 미수 불일치 | ✅ 173,516,468로 일치 검증(PR #91) |
| H3 청소직원 네비·리다이렉트 | ✅ 청소 탭만·에러0 검증(PR #91) |
| M1 게스트 옵션 가격 | ✅ 선택 변형가 표시 검증(PR #91) |
| M2/C2 빌라명 병기 | ✅ 공급자 통계·벤더 발주 검증(PR #91) |
| M3 공급자 차트 빈 | ✅ **비-버그 확정**(데이터 probe·DOM 막대5개·정착스크린샷 정상 — recharts mount 애니메이션 스크린샷 타이밍 아티팩트) |
| M4 모바일 헤더 겹침 | ✅ 검증(PR #91) |
| M5 벤더 발주 무페이징 | ✅ **누락이었음→PR #92 수정·배포·검증**(79→20건/4602px) |
| M6 게스트 만료 문구 | ✅ guestExpired 전용 5개언어 검증(PR #91) |
| L1 빌라명 쓰레기 데이터 | ✅ **5건 하드삭제**(TEST1·,ㅏㅏㅏㅏ·DDDD·QA 타인빌라·sddsd, 트랜잭션 원자삭제, 73→68, 프로덕션 검증) |
| L2 데모 데이터 시점 | ℹ️ INFO(조치 불요) |
| L3 정식 STAFF 계정 | ⏸️ 운영 결정(코드 아님) — 미착수 |

### MOBILE-RESPONSIVE-AUDIT-2026-06-27.md
| 항목 | 상태 |
|---|---|
| /revenue·/bookings/[id]·/statistics 표/칩 오버플로 | ✅ origin/main(PR #85·#88 등)에 이미 overflow-x-auto 반영 확인 |
| /users +12px | ℹ️ 경미(서브픽셀, 허용) |
| 공급자 헤더 겹침(M4) | ✅ 수정·검증 |
| 라이트 포털 5종 | ✅ 모바일우선·오버플로0 확인 |

**→ 두 문서의 코드 결함은 전부 처리됨.** 잔여는 L3(운영)뿐.

---

## Part B — 문서 밖 신규 발굴

정적 분석으로 같은 버그 클래스를 전수 재검했다.

### 🔴 N1. 공급자 사진 화면 i18n 네임스페이스 누락 (C1과 동일 클래스, 신규)
- **증상**: 공급자 빌라 사진 관리(`photo-manager.tsx`)·라이트박스(`photo-lightbox.tsx`)가 `useTranslations("photoManage")`·`("photoLightbox")`를 쓰는데, `SUPPLIER_CLIENT_NAMESPACES` 화이트리스트에 **없음** → 사진 화면 라벨이 `photoManage.*`·`photoLightbox.*` raw 키로 깨짐(ko·vi 둘 다). 키는 messages에 존재.
- **원인**: C1(partner·vendor pagination 누락)과 동일 — 라이트 포털 클라 네임스페이스 화이트리스트 미갱신.
- **수정**: `app/(supplier)/layout.tsx`의 SUPPLIER_CLIENT_NAMESPACES에 `photoManage`·`photoLightbox` 추가.
- **재발 방지**: `tests/light-portal-i18n.test.ts`를 **pagination 단건 검사 → 전체 완성도 테스트로 강화**. 공급자·파트너·벤더 각 포털의 모든 클라 컴포넌트 useTranslations 네임스페이스가 레이아웃에 직렬화되는지 전수 검증((admin)/layout.tsx의 admin-i18n-whitelist.test.ts 라이트 포털판). 이 테스트는 수정 전이라면 공급자에서 실패한다(버그를 실제로 잡음).

### ✅ N2. ko/vi 키 대칭 — 정상
- messages/ko.json·vi.json 각 **3009키, 차이 0건**. 한쪽 로케일에만 있어 raw 키로 깨지는 키 없음.

### ✅ N3. 운영자 i18n — 기존 테스트로 커버
- (admin) 클라 네임스페이스는 기존 admin-i18n-whitelist.test.ts가 완성도 검증(통과).

---

## 검증
- typecheck·lint·build·전체 **2061 테스트 통과**(강화 테스트 7건 포함).
- 배포 후 공급자 사진 화면에서 raw 키 사라짐 라이브 확인 예정.
