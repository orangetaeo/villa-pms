# Skill: Stitch 디자인 생성 패턴

## 워크플로우 (MCP 우선)
1. docs/DESIGN.md에서 해당 화면 프롬프트(A1~C1) 확인 — 신규 화면이면 같은 형식으로 프롬프트 작성
2. Stitch MCP 사용 순서: 프로젝트 확인(list_projects/get_project) → 디자인 시스템 적용(apply_design_system) → 화면 생성(generate_screen_from_text) → 수정(edit_screens, 1~3회)
3. 같은 영역 화면은 한 번에 묶어 생성 (공급자끼리/운영자끼리) — 색·간격 일관성 확보
4. 결과 HTML/Tailwind를 design/stitch/<화면명>/index.html로 저장 + 같은 폴더에 NOTES.md(디자인 의도·상태색 정의) 작성
5. MCP 불가 시: stitch.withgoogle.com에서 수동 생성 → Export Code 다운로드 → 동일 경로 저장

## 프롬프트 작성 규칙
- 영어로 작성, 결과가 가장 좋음. 모바일 화면은 "mobile app screen ..."으로 시작
- 반드시 포함: 테마(light/dark), 언어 라벨(Vietnamese/Korean labels), 기기(desktop web/mobile), 사용자 맥락(for Vietnamese property managers 등)
- 공급자 화면: "very simple, large touch targets, minimal text, suitable for non-technical users" 상시 포함
- 상태 색상은 프롬프트에 명시: green=공실, blue solid=확정, blue dashed=홀드, gray=차단, red outline=판매불가 — 전 화면 동일

## 자가 채점 (제출 전 필수 — docs/DESIGN.md 평가 4기준)
| 기준 | 체크 |
|---|---|
| 디자인 품질 | 하나의 정체성으로 응집되는가, 부품 나열인가 |
| 독창성 | AI 기본값(흰 카드+보라 그라디언트) 탈피했는가 |
| 완성도 | 타이포 위계·간격 일관성·대비 |
| 기능성 | 추측 없이 과업 완수 가능한가 (공급자 화면은 이 항목 최상 비중) |

- 1차 출력 만족 금지: 채점 후 "현재 방향 다듬기 vs 다른 미학 전환" 판단 1회 이상
- 공급자 화면 추가 체크: 버튼 3개 이하인가, 텍스트 입력 요구하는가(있으면 토글·스테퍼로 교체), 가격·마진 요소가 한 픽셀이라도 있는가

## 교훈 축적 (디자인 반려·재작업 시 여기 추가)
- (없음 — 개발 착수 전)
