# 빌라 투어 쇼츠 제작 런북 (다음 영상은 한 번에 나오게)

> 2026-07-23 M villa M1 한 편을 만들며 **재생성 다섯 번·테오 지적 세 라운드**를 겪었다.
> 그때 걸린 문제와 그 뒤에 넣은 자동 방지 장치를 여기 모은다. **다음 영상은 이 문서 순서대로만 하면 된다.**
>
> 실제 컷 표 예시: [storyboard-m-villa-m1.md](storyboard-m-villa-m1.md) · 생성 스크립트: `smoke/m1-30cut.mts`

---

## 0. 시작 전에 알아야 할 세 가지 (여기서 대부분의 사고가 났다)

**① 컷 파일이 8초여도 화면에 나가는 건 앞 3~4초다.**
화면 길이는 나레이션이 정하고(보통 3~4초), 페이싱이 원본을 0.88~1.85배로 읽는다.
"8초 창 어딘가에 식탁이 있다"는 아무 의미가 없다 — **피사체가 시작 직후에 와야 한다.**

**② 이동(fast) 컷은 원본을 `1.9초 × 1.85 ≈ 3.5초`까지 읽는다.**
그래서 `이동 컷 src + 3.5초`가 다음 컷 `src`를 넘으면 **같은 장면이 두 번 나간다**(테오 "26~27초 중복" 지적).
보여주는(slow) 컷도 마찬가지로 `src + len`이 다음 컷 시작을 넘지 않게 자른다.

**③ 욕실은 "변기가 언제 프레임에 들어오는가"가 시작점을 정한다.**
검수는 **시작점부터 4초**를 본다(0.2·2.0·3.7초 프레임 3장). 컷을 짧게 잘라도 이 창은 안 줄어든다 —
통과시키려면 **시작점을 앞으로** 옮기는 수밖에 없다. M1은 욕실 네 곳 모두 문 정면 오른쪽에 변기가 있어
"문을 들어서는 3~4초"가 유일한 창이었다.

---

## 1. 컷 표 만들기

원본을 2초 간격 콘택트시트로 훑어 컷을 고른다. **10초 간격은 반드시 어긋난다.**

```bash
# 15초 구간을 1초 간격으로 (욕실·문제 구간 정밀 확인)
node_modules/ffmpeg-static/ffmpeg.exe -y -ss <시작> -i "<원본>.mp4" -t 15 \
  -vf "fps=1,scale=270:-1,tile=5x3" -frames:v 1 sheet.jpg
```

컷 표 열: `label / src / len / pace(fast|slow) / space / note`

- `note`는 **검수가 화면과 대조하는 기준**이다. "원목 식탁과 다이닝 공간"처럼 **화면에 실제로 크게 보이는 것**을 쓴다.
- `space`는 PhotoSpace 코드(EXTERIOR·LIVING·KITCHEN·BEDROOM·BATHROOM·BALCONY·POOL·ETC).
  이동 컷은 ETC + `pace: fast`.
- 컷 수는 30이 상한(`CLIP_COUNT_MAX`). 영상은 80~90초가 된다(쇼츠 상한 3분).

## 2. 재단 → **로컬 검수** → 업로드 → 생성

```bash
npx tsx smoke/m1-30cut.mts cut          # 30컷 재단(CRF 18, -an)
npx tsx smoke/m1-30cut.mts audit        # ★렌더 게이트와 같은 검수를 로컬에서 먼저
npx tsx smoke/m1-30cut.mts upload       # R2 업로드(약 250MB)
npx tsx smoke/m1-30cut.mts create       # 대본·메타 생성 → YoutubeShort(PENDING)
npx tsx smoke/m1-30cut.mts cut 11,28    # 컷 번호 지정(cut·audit·upload 공통)
```

★ **업로드 전에 audit을 반드시 돌린다.** 렌더에서 걸리면 cron 한 사이클(업로드 + 렌더 대기 10분)을 통째로 버린다.
검수 `error`가 0이어야 렌더가 통과한다(경고는 통과).

검수가 잡는 것: 선언 공간 ≠ 실제 화면 / note 피사체 안 보임 / **변기·쓰레기통·거울 속 촬영자·사람 얼굴**.

## 3. 렌더 (cron이 자동)

5분 내 픽업 → 3~7분 렌더 → `PENDING_APPROVAL`. 실패하면 `editError`에 컷 번호와 사유가 담긴다.

## 4. 완성본 확인 (사람이 볼 것 = 아래 표뿐)

```bash
curl -sL -o out.mp4 "<videoUrl>"
# 전체 흐름 한 장
node_modules/ffmpeg-static/ffmpeg.exe -y -i out.mp4 -vf "fps=1/2,scale=190:-1,tile=8x6" -frames:v 1 all.jpg
# 상단 띠(오버레이 정렬) 확인
node_modules/ffmpeg-static/ffmpeg.exe -y -ss 1 -i out.mp4 -frames:v 1 -vf "crop=1080:120:0:0" top.jpg
```

나레이션 쉼은 **최종 믹스로는 확인 못 한다**(배경음 때문). 합성 캐시를 꺼내 무음을 재본다:

```bash
# synthesizeNarration(lines) → cached: true 면 렌더에 들어간 바로 그 음성
node_modules/ffmpeg-static/ffmpeg.exe -i line.wav -af "silencedetect=noise=-30dB:d=0.25" -f null -
```

## 5. 승인 → 업로드

`PENDING_APPROVAL` → 승인 시 `QUEUED` → publish cron이 `scheduledAt`에 업로드.
설정 확인: `YT_AUTOPOST_PAUSED=0` · `YT_PRIVACY_STATUS=public` · `YT_SHORTS_PER_DAY`.
**구버전이 남아 있으면 반려(CANCELLED)**해서 승인 큐에 한 편만 남긴다.

---

## 이미 코드로 막아 둔 것 (다시 신경 쓸 필요 없음)

| 한때 문제 | 지금 |
|---|---|
| 완성본을 사람이 보고 변기·엉뚱한 화면을 짚어냄 | 렌더 전 Vision 검수 게이트(`clip-audit.ts`), error면 렌더 중단 |
| 검수 창보다 짧은 클립이 검수를 통째로 건너뜀 | 프레임 단위로 건너뛰고 한 장이라도 있으면 판정 |
| 이동 컷에 내용 문장이 붙어 화면·말 불일치 | `absorbTransitParts` — 이동 컷은 자막을 갖지 않고 앞 절에 흡수 |
| `~답니다`가 네 문장 연속 | `diversifyEndings` — 같은 어미 계열 2회차부터 서버가 교정 |
| 쉼표에서 안 쉬어 문장이 뭉개짐 | TTS `[pause]` 마크업을 쉼표·마침표마다 삽입(0.5~0.8초), 촘촘하면 생략 |
| 인트로 상단에 밝은 띠 | `writeOverlay`가 투명 여백만 트림(좌상단 색을 배경으로 오인하지 않음) |
| 컷 길이가 나레이션과 어긋남 | 오디오 길이로 컷 길이 역산 + 실측 재동기화(`retimeNarrationTimeline`) |

## 사람이 아직 지켜야 하는 것 (체크리스트)

- [ ] 이동 컷 `src + 3.5초` ≤ 다음 컷 `src` (중복 방지)
- [ ] 보여주는 컷 `src + len` ≤ 다음 컷 `src`
- [ ] 욕실 컷: 변기 등장 시각을 1초 간격 시트로 특정하고 **그 4초 전까지**만 사용
- [ ] `note`는 화면에 크게 보이는 피사체로(검수가 대조한다)
- [ ] 나레이션에 넘기는 빌라 이름은 **한글 표기**(`엠빌라 엠원`) — 영문을 넘기면 대본에 영문이 섞여 TTS가 어색하게 읽는다. 화면 제목·인트로는 실제 이름 그대로
- [ ] 검수 경고(사람·쓰레기통·흔들림)는 렌더를 막지 않는다 — 오프닝 컷의 경고는 특히 눈에 띄니 가능하면 피한다
- [ ] 업로드 전 승인 큐에 구버전이 없는지 확인
