# T-tutorial-onboarding-4 — 튜토리얼 보강: 마법사 인라인 안내 + "?" 발견성 + 실사용 테스트 킷

- 상태: 착수 (2026-07-09, worktree `worktree-tutorial-onboarding` 계속)
- 배경: 테오 질문 "전산 모르는 사람도 문제 없겠어?" → 갭 3건 합의. 투어 에픽(PR #207/#208/#210)의 후속 보강.

## 범위

### 1. 빌라 등록 마법사 단계별 인라인 안내 (가장 큰 갭)
- 마법사 6단계(app/(supplier)/my-villas/new/step-*) 중 안내가 빈 단계에 **한 줄 가이드 배너**(아이콘+짧은 문장, 라이트 teal 톤 — step-location의 rentInfo 배너 패턴 재사용) 추가.
- 대상·문구는 UX-VN 회의로 확정 (원칙: 전산 초보 기준 "지금 뭘 하면 되는지 + 왜"를 한 문장, 텍스트 최소화 — 이미 subtitle 있는 단계는 중복 금지).
- 코치마크 아님 — 항상 보이는 정적 안내(한 번 보고 사라지는 투어와 달리 매번 참조 가능).
- i18n: wizard NS에 키 추가(ko/vi 동시). wizard는 이미 SUPPLIER_CLIENT_NAMESPACES에 있음 — 화이트리스트 무변경.

### 2. 투어 마지막 스텝에 "?" 발견성 한 줄 (아주 작은 인프라 보강)
- CoachMark 마지막 스텝 말풍선 하단에 보조 문구: ko "다시 보려면 ? 버튼을 누르세요." / vi "Muốn xem lại, nhấn nút ?."
- `TourLabels`에 `replayHint` 추가 + `buildTourLabels`가 tour NS `replayHint` 키를 읽음 → **전 투어 9종에 자동 적용**(호출부 무수정).

### 3. 실사용 테스트 관찰 킷 (문서 — 테오용)
- `docs/usability-test-checklist.md` (ko): 역할별 시나리오(공급자: 로그인→빌라 등록→캘린더 잠금→청소 제출 / 청소원: 태스크→사진 제출 / 파트너·벤더 간단), 관찰 규칙(개입 금지·막힌 지점 기록), 기록 표, 판정 기준(설명 없이 완주?), 결과→개선 매핑 방법.
- docs/INDEX.md 등록.

## 완료 기준
1. 마법사 각 대상 단계에 가이드 배너 렌더(ko/vi), 기존 폼 동작·유효성 무영향.
2. 아무 투어나 마지막 스텝에서 replayHint 문구 표시(1·2·3단계 투어 전부 자동 적용), 마지막 아닌 스텝엔 미표시.
3. tour·wizard NS ko/vi 패리티(기존 테스트 확장 자동 커버 — tour NS는 tour-onboarding 테스트가, wizard 신규 키는 양쪽 동시 추가).
4. tsc·build·전체 vitest 통과. 마진·금액 데이터 무참조.
5. 체크리스트 문서 완성 + INDEX 등록.

## 수정 금지 구역
- prisma/schema.prisma, worker/, lib/zalo-*, package.json. coach-mark.tsx는 §2 replayHint 렌더만.

## 검증
- QA 독립 평가: 로컬 prod 실측 — 마법사 배너(vi 기본) + 투어 마지막 스텝 힌트(공급자·벤더 각 1개 투어 샘플).
