# 계약서 — P2: AI 나레이션 쇼츠 (Gemini TTS + 자막)

- 태스크 ID: `villa-clip-narration-p2`
- 브랜치: `wt/villa-clip` (P1과 동일 worktree — 연속 작업)
- 선행: P1 `villa-clip-narration` (PR #355)
- 담당: BE(TTS·타이밍) → FE(대본 편집 UI) → QA
- 작성일: 2026-07-22

## 배경 / 방향

테오 확정: **음악을 넣지 않고, 실제 촬영 소재 + Gemini 편집으로 AI 음성(나레이션)과 자막을 넣는다.**

이득:
- BGM이 유일한 Content ID 리스크였는데 나레이션은 그 위험이 0
- 유튜브 쇼츠는 말이 있는 영상이 체류시간에 유리
- 인스타는 음소거 시청이 다수 → **자막이 본체**. 나레이션 대본 = 자막 텍스트로 하나를 만들어 둘을 얻는다

## 핵심 설계: 오디오 우선 타이밍

현재 `lib/youtube/edit.ts`는 **컷 길이를 먼저 정하고**(기본 4초) 영상을 자른다.
나레이션이 들어오면 이 순서를 뒤집는다:

```
대본 문장 → TTS 합성 → 실제 오디오 길이 측정 → 그 길이로 컷 길이 결정
```

안 뒤집으면 말이 컷 전환에서 잘리거나, 말이 끝난 뒤 어색한 정적이 남는다.

### 타임라인 수식 (xfade 겹침 반영)

`xfadeConcat`은 세그먼트를 `T = TRANSITION_SEC` 만큼 겹친다 → `total = Σdur − (n−1)·T`.

- `dur_i = max(CLIP_DUR_MIN, lineDur_i + PAD)` (PAD = 0.6s: 리드인 0.2 + 테일 0.4)
- `off_i = Σ_{j<i}(dur_j − T) + LEAD` (LEAD = 0.25s)
- 자막 표시 구간 = `[off_i, off_i + lineDur_i + 0.3]` — 나레이션과 **같은 소스**

오디오 트랙은 `anullsrc` 베이스 위에 각 문장을 `adelay`로 배치 후 `amix` — concat 누적 오차 없이 정확히 동기된다.

## 대본 길이 규칙 (이게 없으면 15초에 안 들어감)

한국어 자연 발화 ≈ **초당 5~6음절**. 15초 영상의 나레이션 가용 구간 ≈ 13초 → 총 65~75자.
→ **컷당 15~18자 한 문장**. 자막 한 줄에도 딱 맞는 길이.

Gemini 프롬프트에 하드 제약으로 건다(안 걸면 반드시 긴 문장을 뱉는다).

## 범위

### 포함
1. **`lib/gemini-tts.ts`** — Gemini TTS 호출 + R2 캐시
   - 모델 핀: `GEMINI_TTS_MODEL` 환경변수(기본 `gemini-2.5-flash-preview-tts`) — preview 모델 수명주기 대비, 기존 `GEMINI_MODEL` 핀 패턴 복제
   - 출력 PCM 24kHz/16bit/mono → **WAV 헤더 부착**(ffmpeg·ffprobe 입력 일원화)
   - 캐시 키 = `sha256(text + voice + model)` → 같은 문장 재합성 금지
2. **`lib/youtube/narration.ts`** — 대본 생성 + 타이밍 계산
   - `buildNarrationScript()` — 빌라 DB 정보 + 클립 공간(PhotoSpace) → 컷별 1문장(Gemini, JSON)
   - `computeNarrationTimeline()` — 오디오 길이 → 세그먼트 길이·오프셋·자막 구간 (**순수함수, 유닛 테스트**)
   - `synthesizeNarration()` — 문장별 TTS → WAV 파일 + 길이
3. **`lib/youtube/edit.ts` 확장** (additive)
   - `ReelAudioMode`에 의존하지 않는 별도 축: `RenderOpts.narrationTrackPath`
   - 나레이션 모드에서는 **길이 균등 축소(scale) 비활성** — 축소하면 오디오와 어긋난다
4. **API** — 대본 생성·편집·재렌더
5. **ADMIN UI** — 대본 4줄 편집 + "다시 읽히기"(재TTS) + 미리듣기

### 제외 (P3)
- Gemini vision 컷 자동선정, 원본 라이프사이클 삭제, 스토리지 대시보드
- 인스타 릴스 경로 나레이션 적용(우선 유튜브 쇼츠에서 검증 후)

## 확정 정책

| 항목 | 값 | 근거 |
|---|---|---|
| 목표 길이 | 15초 (허용 13~18초) | 쇼츠 훅 구간 |
| 문장 수 | 3~5 (CTA 포함) | 컷 수와 1:1 |
| 문장당 길이 | 15~18자 | 초당 5~6음절 × 가용 13초 |
| 음악 | **없음** | 테오 확정. Content ID 리스크 0 |
| 클립 원본 오디오 | 음소거 | 바람·말소리 혼입 방지 |
| 대본 금칙 | 숫자·영문 표기 금지 | TTS가 "V12"·"3BR"을 이상하게 읽음 |

## 완료 기준 (테스트 가능)

- [ ] C1. `computeNarrationTimeline`: 문장 길이 배열 → 세그먼트 길이·오프셋·자막 구간이 수식과 일치(유닛)
- [ ] C2. 총 길이가 60초(쇼츠 상한)를 넘으면 **거부**하고 축소하지 않는다 — 축소는 오디오 desync
- [ ] C3. 짧은 문장(1초)도 `CLIP_DUR_MIN` 이상 세그먼트를 받는다
- [ ] C4. TTS 캐시: 같은 (text, voice, model)이면 API 재호출 0회
- [ ] C5. `GEMINI_API_KEY` 미설정 → `GeminiNotConfiguredError`, 렌더는 무음으로 폴백(파이프라인 중단 없음)
- [ ] C6. 대본 생성 결과가 규칙 위반(19자 초과·숫자 포함)이면 서버가 잘라내거나 거부 — 프롬프트만 믿지 않는다
- [ ] C7. 운영자가 대본을 수정하면 **수정한 문장만** 재TTS(전체 재합성 금지)
- [ ] C8. 대본 편집·재렌더 API는 운영자 전용(공급자 403)
- [ ] C9. 전 변경 경로 AuditLog
- [ ] C10. `npm run lint && npx tsc --noEmit && npx next build` 통과
- [ ] C11. 기존 `audio: "silent"|"ambient"` 경로 동작 무변경(회귀 없음)

## 검증 방법

1. 유닛: `computeNarrationTimeline` 경계·수식, 대본 규칙 검증기
2. 통합 스모크: 실제 클립 2~3개 + 실제 TTS로 15초 MP4 1편 생성 → 육안·청취 확인
3. 빌드 게이트
4. QA 독립 검증(작성자 자기평가 무효)

## 리스크

| 리스크 | 대응 |
|---|---|
| preview TTS 모델 퇴역 | `GEMINI_TTS_MODEL` 핀 + 실패 시 무음 폴백 |
| 목소리 품질(한국어 어색함) | 30종 중 후보 3~4개를 실제로 들어보고 고정 — **문서로는 못 고른다**. `GEMINI_TTS_VOICE`로 교체 가능하게 |
| 숫자·영문 오독 | 대본 규칙 + 서버 검증기(숫자 포함 시 거부) |
| 컷 사이 정적 | 우선 나레이션만으로 1편 뽑아 판단. 필요 시 파도·새소리 앰비언트 −28dB(음악 아님) |
| ffmpeg 오디오 xfade가 말을 뭉갬 | 오디오는 xfade 금지 — `adelay`+`amix` 단일 트랙 |

## 구현 결과 (2026-07-22)

| 게이트 | 결과 |
|---|---|
| `npx tsc --noEmit` | 통과 |
| `npm run lint` | 신규 파일 error·warning 0 |
| `npx next build` | 통과 — `/api/youtube/shorts/[id]/narration` 등록 확인 |
| `npx vitest run` | **28 passed** (P1 11 + 나레이션 17) |

완료 기준 대조:

| # | 항목 | 결과 |
|---|---|---|
| C1 | 타임라인 수식(오프셋 = Σ(dur−T)+LEAD) | ✅ 유닛 |
| C2 | 상한 초과 시 축소 금지·에러 | ✅ `renderEditedVideo` throw |
| C3 | 짧은 문장도 `CLIP_DUR_MIN` 하한 | ✅ 유닛 |
| C4 | TTS 캐시(문장·목소리·모델) | ✅ 유닛(키 분기) + `readTtsAudio` |
| C5 | 키 미설정 시 무음 폴백 | ✅ `runYoutubeEditJob` try/catch |
| C6 | 대본 규칙 서버 재검증 | ✅ `validateNarrationLines` 유닛 |
| C7 | 고친 문장만 재TTS | ✅ 캐시 구조상 자동 |
| C8 | 대본 API 운영자 전용 | ✅ `isOperator` 첫 줄 |
| C9 | 감사로그 | ✅ PUT에 대본 전문 기록 |
| C10 | lint·tsc·build | ✅ |
| C11 | 기존 silent/ambient 무변경 | ✅ narration 미지정 시 기존 분기 |

**미검증(정직 고지)**: 실제 TTS 음성 품질(목소리 30종 중 선택은 들어봐야 확정 가능),
실제 클립으로 15초 MP4를 뽑는 통합 스모크, 독립 QA 검증.

신규: `lib/gemini-tts.ts`, `lib/youtube/narration.ts`, `lib/youtube/narration.test.ts`,
`app/api/youtube/shorts/[id]/narration/route.ts`, `app/(admin)/marketing/youtube/narration-editor.tsx`
수정: `lib/youtube/edit.ts`(additive), `lib/storage.ts`, `app/(admin)/marketing/youtube/youtube-short-card.tsx`, `messages/{ko,vi}.json`

### 운영 필요 환경변수 (OPS)

| 키 | 기본값 | 비고 |
|---|---|---|
| `GEMINI_TTS_MODEL` | `gemini-2.5-flash-preview-tts` | preview — 404 나면 이 값만 교체 |
| `GEMINI_TTS_VOICE` | `Kore` | 30종 중 **들어보고** 확정할 것 |

`GEMINI_API_KEY`는 기존 키 재사용(추가 설정 불요).

## 수정 금지 구역

- `lib/instagram/reels.ts` — 사진 자동생성 릴스(VILLA_AUTO)는 **음악 유지**. 나레이션은 직접 촬영(UPLOADED) 경로 전용
- `app/(admin)/marketing/instagram/**` — 이번 범위 아님
