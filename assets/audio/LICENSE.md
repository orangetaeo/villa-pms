# 릴스 BGM 라이선스 — 저작권 리스크 0 원칙

Villa PMS 인스타그램 릴스·유튜브 쇼츠(lib/instagram/reels.ts)의 오디오 트랙은
저작권 분쟁 리스크를 원천 제거하기 위해 **CC0 음원** 또는 **런타임 합성음**만 사용한다.

## 1. 번들 실음원 (`audio: "bundled"`) — 현재 기본값

- **파일: `reel-bgm.mp3` = "Happy Whistling Ukulele"**
- **라이선스: CC0 1.0 Universal (Public Domain, 출처표기 불필요)**
- 출처: FreePD(freepd.com) CC0 음원. 아카이브 [SoundSafari/CC0-1.0-Music](https://github.com/SoundSafari/CC0-1.0-Music) `freepd.com/Happy Whistling Ukulele.mp3`. 다운로드 2026-07-21.
- 처리: 영상 길이만큼 반복(-stream_loop) → 트림 → 볼륨 0.4 감쇠 → 인/아웃 페이드.
- CC0라 저작권·YouTube Content ID 클레임 위험 0. 상업적 사용·수정 자유, 크레딧 불필요.
- **교체**: 다른 CC0/로열티프리 곡을 `assets/audio/reel-bgm.mp3`로 덮어쓰면 자동 반영. 파일이 없으면 무음 폴백.

## 2. 무음 (`audio: "silent"`)

- ffmpeg `anullsrc` 무음 AAC. 컨테이너 규격은 충족하되 소리 없음. 운영자가 앱에서 트렌드 음원을 얹기 유리.

## 3. 합성 앰비언트/라운지 (`audio: "ambient"` / `"lounge"`)

- 번들 음원이 아니라 ffmpeg `aevalsrc`로 직접 합성한 순음 화음(제3자 권리 없음, CC0 취급).
- ⚠ `lounge`(C–Am–F–G 스웰)는 실청 결과 공포영화 앰비언스처럼 들려 **미사용**(코드만 존치).

## 원칙

★번들 음원은 **반드시 CC0/로열티프리**만. 유튜브 Content ID 클레임 방지.
새 곡 번들 시 이 문서에 출처·라이선스 전문을 갱신할 것.
