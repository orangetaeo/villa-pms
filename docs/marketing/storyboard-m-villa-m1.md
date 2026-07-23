# 스토리보드 — M villa M1 투어 쇼츠 (테오 구술, 2026-07-23)

원본: `M villa M1.mp4` (540초, 1080×1920 세로 워크스루). 프로젝트 루트에 있으나 **git 미추적**이라
없어지면 공급자에게 재요청해야 한다. 아래 초 단위는 **이 원본 기준**이다.

빌라: `cmru4fggf02bko80fp3nxkn00` · Sonasea · 침실 4 · 수영장 있음 · 해변 100m

---

## ★ 컷을 자를 때 반드시 알아야 할 것

**클립 파일이 8초여도 화면에 나가는 건 앞 3~4초뿐이다.**

화면 길이는 나레이션이 정하고(보통 3~4초), 페이싱이 원본을 0.88~1.85배로 읽는다.
그래서 "8초 창 어딘가에 식탁이 있다"는 **아무 의미가 없다** — 피사체가 **시작 지점 직후**에 와야 한다.

2026-07-23 첫 완성본의 "식탁이 절반만 나온다"가 정확히 이 실수였다(식탁은 src 79~85인데
컷을 88부터 시작해서, 실제로 화면에 나간 3초는 사이드보드였다).
`lib/youtube/clip-audit.ts`가 이제 이걸 컷별로 잡아낸다.

---

## 컷 목록 (30컷)

`pace`: `fast` = 이동(빠르게 지나감, 화면 상한 1.9초) · `slow` = 보여줄 공간(천천히)

| # | label | src | len | pace | space | note |
|---|---|---|---|---|---|---|
| 1 | beach | 6 | 6 | slow | EXTERIOR | 야자수 너머 해변, 빌라 바로 앞이 바다 |
| 2 | to-gate | 17 | 8 | fast | EXTERIOR | 해변에서 빌라 입구로 이동 |
| 3 | gate | 25 | 6 | slow | EXTERIOR | 빌라 정문으로 들어서는 순간 |
| 4 | to-pool | 33 | 8 | fast | ETC | 진입로를 지나 안뜰로 이동 |
| 5 | pool | 43 | 8 | slow | POOL | 단독 사용 프라이빗 수영장과 이 층 건물 전체가 한눈에 |
| 6 | to-indoor | 70 | 8 | fast | ETC | 수영장에서 실내로 이동 |
| 7 | **dining** | **80** ← 수정 | 8 | slow | KITCHEN | **원목 식탁과 다이닝 공간** |
| 8 | **to-living** | **96** ← 수정 | 7 | fast | ETC | **주방 조리대를 지나 거실로 이동** |
| 9 | living | 131 | 7 | slow | LIVING | 큰 소파와 티브이, 천장 선풍기가 있는 거실 |
| 10 | to-bath1 | 141 | 6 | fast | ETC | 거실에서 일 층 방 욕실로 이동 |
| 11 | bath1 | 148 | 6 | slow | BATHROOM | 일 층 방에 딸린 욕실, 대리석 세면대 |
| 12 | to-room1 | 167 | 6 | fast | ETC | 욕실에서 일 층 침실로 이동 |
| 13 | room1 | 174 | 7 | slow | BEDROOM | 일 층 침실, 통창 밖이 바로 수영장 |
| 14 | to-laundry | 195 | 6 | fast | ETC | 일 층 방에서 세탁실로 이동 |
| 15 | laundry | 203 | 5 | slow | ETC | 세탁기와 빨래 바구니가 있는 세탁실 |
| 16 | stairs | 211 | 8 | fast | ETC | 계단을 올라 이 층으로 이동 |
| 17 | vanity2 | 223 | 7 | slow | BEDROOM | 이 층 안방 화장대와 붙박이 옷장 |
| 18 | bath2 | 251 | 8 | slow | BATHROOM | 이 층 안방 욕실, 샤워부스와 욕조 |
| 19 | out-bath2 | 264 | 6 | fast | ETC | 욕실에서 나와 침실로 이동 |
| 20 | bed2 | 291 | 7 | slow | BEDROOM | 이 층 안방 킹베드와 티브이 |
| 21 | balcony2 | 328 | 8 | slow | BALCONY | 베란다를 열면 내려다보이는 수영장과 바다 |
| 22 | to-room3 | 357 | 7 | fast | ETC | 복도를 지나 다른 방으로 이동 |
| 23 | bath3 | 373 | 7 | slow | BATHROOM | 둘째 방 욕실, 샤워시설과 세면대 |
| 24 | to-bed3 | 388 | 6 | fast | ETC | 욕실에서 침실로 이동 |
| 25 | bed3 | 395 | 7 | slow | BEDROOM | 둘째 방 티브이 선반과 침대 |
| 26 | terrace3 | 424 | 8 | slow | BALCONY | 둘째 방 테라스에서도 바로 앞이 수영장과 바다 |
| 27 | to-twin | 448 | 7 | fast | ETC | 다른 방으로 이동 |
| 28 | bath4 | 462 | 6 | slow | BATHROOM | 셋째 방 욕실 |
| 29 | twin | 482 | 7 | slow | BEDROOM | 싱글 침대 두 개인 트윈룸, 아이들이 쓰기 좋은 방 |
| 30 | final-view | 519 | 8 | slow | BALCONY | 마지막으로 베란다에서 내려다본 수영장과 해변 |

헤드라인: `해변 바로 앞\n네 침실 프라이빗 풀빌라`
파라미터: `audio: silent · horizontalMode: crop · pacing: true · bgm: soft · audit: true`

---

## 다음 세션에서 고칠 것 (테오 지적 2건)

### 컷 7 — 식탁이 절반만 나온다
`src 88` → **`src 80`**. 원본 79~85초에 원목 식탁이 정면으로 크게 잡힌다(88초는 사이드보드).
`note`도 "원목 상부장과 인덕션…" → **"원목 식탁과 다이닝 공간"** 으로 바꾼다(검수가 메모와 화면을 대조한다).

### 컷 8 — 뜬금없이 변기가 보인다
`src 120` → **`src 96`**. 120초 구간에는 욕실 변기가 들어 있다(자동 검수가 `[오류] 변기`로 잡아냈다).
96~103초는 "주방 조리대 → 거실 쪽으로 이동"이라 이 컷의 의도와 맞는다.

### 나레이션-화면 어긋남
**코드로 해결됨**(PR #412 `absorbTransitParts`) — 이동 컷은 자기 자막을 갖지 못하고 앞 절에 흡수된다.
대본을 다시 생성하기만 하면 자동 적용된다.

---

## 재생성 절차

1. 위 표대로 30컷을 `ffmpeg -ss <src> -t <len>`으로 자른다(CRF 18, `-an`).
2. R2 `youtube-clips/{hex}.mp4`로 업로드(약 300MB).
3. `validateEditParams`에 `clips[].{key,space,note,pace}` + 위 파라미터로 params 구성.
4. `buildNarrationScript` → `normalizeScript(raw, 30, clipKinds)` ← **clipKinds 필수**(이동 컷 흡수).
5. `YoutubeShort` 생성(`editJobStatus: PENDING`) → cron이 렌더(약 3~7분).
6. 검수에서 `error`가 나오면 **렌더가 멈추고** 컷 번호가 `editError`에 담긴다 → 그 컷 시작 지점만 옮겨 재시도.

> 이전 세션의 생성 스크립트는 임시 파일이라 지웠다. 위 표만 있으면 재작성은 15분이면 된다.
