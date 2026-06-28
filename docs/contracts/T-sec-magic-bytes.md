# 계약: P3-S1 파일 매직바이트 검사 (업로드 방어심화)

> 보안 강화 에픽 P3-S1. 정본 docs/SECURITY-HARDENING-PLAN-2026-06-27.md §6.
> worktree: `wt/sec-magic-bytes`. 작성자=BE, 평가자=QA(분리).

## 배경·문제

현재 이미지 업로드는 **클라이언트가 선언한 Content-Type**(`file.type`)만 MIME 화이트리스트(`isAllowedImageMime`)로 검사한다. 클라가 Content-Type을 위조하면(예: `image/jpeg`로 선언하고 SVG/HTML/실행파일 업로드) 통과한다. 방어심화로 **실제 바이트(매직넘버)** 가 허용 이미지 포맷인지 검증한다.

## 범위 (in scope)

1. **순수 함수 `sniffImageMime(buffer): AllowedImageMime | null`** (lib/storage.ts) — 매직바이트로 실제 포맷 판별:
   - JPEG `FF D8 FF` / PNG `89 50 4E 47 0D 0A 1A 0A` / WebP `RIFF....WEBP` / HEIC·HEIF ISO-BMFF `....ftyp<brand>`(heic/heif 계열 brand).
2. **`saveFile`·`savePassportFile`에 검증 추가** — buffer가 허용 이미지로 sniff되지 않으면(null) `INVALID_IMAGE_BYTES` throw. 두 곳이 모든 이미지 업로드(빌라사진·일반업로드·여권·서명) 중앙 경로.
   - sniffed===declared까지 강제하진 않음(허용 포맷 간 불일치는 무해, HEIC brand 다양성으로 false-reject 회피). 핵심 방어 = "허용 이미지 바이트가 아니면 거부".
3. **순수 함수 단위 테스트** — 유효 jpeg/png/webp/heic 헤더 통과, svg/html/gif/빈/짧은 버퍼 거부.

## 테스트 가능한 완료 기준

- [ ] `sniffImageMime`: jpeg/png/webp/heic/heif 헤더 → 해당 MIME, svg·html·gif·빈·truncated → null.
- [ ] `saveFile`/`savePassportFile`: 비이미지 바이트(SVG/HTML) buffer 투입 시 throw(declared가 image/jpeg여도). 유효 이미지는 정상 저장.
- [ ] 기존 업로드 동작 무회귀(유효 jpeg/png 저장 성공).
- [ ] typecheck 0, 전체 vitest 통과, build 통과.

## 검증 방법

- 단위 테스트 + typecheck + build.
- QA 독립 평가: HEIC false-reject 위험·우회 가능성(매직바이트 위조)·기존 업로드 회귀.

## 수정 금지 구역

- 없음(lib/storage.ts + 테스트 전담). 다른 세션 작업 없음.

## 마이그레이션

- 없음.
