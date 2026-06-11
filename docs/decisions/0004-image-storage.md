# ADR-0004: 이미지 저장소 — Cloudflare R2 (인터림: Railway Volume)

날짜: 2026-06-11
상태: 승인 (TDA)
관련: T0.4, T1.1(업로드 파이프라인), CLAUDE.md "이미지 저장: TBD" 해소

## 맥락

- 빌라 사진·청소 사진·여권 등 이미지 업로드가 F1~F4 전반의 의존성
- T1.1이 인터림 로컬 디스크 구현(`lib/storage.ts` saveFile)을 먼저 만들었으나, **Railway 컨테이너 파일시스템은 재배포 시 소멸** — 프로덕션에서 영속성 없음
- 후보: Cloudflare R2 vs Railway Volume

## 결정

1. **장기: Cloudflare R2** — S3 호환 API(@aws-sdk/client-s3), 무료 10GB·이그레스 무료, 공개 URL 직접 서빙(서버 부하 없음)
2. **인터림: Railway Volume** — 테오의 Cloudflare 계정·API 토큰 발급 전까지. `/data` 마운트 + `UPLOAD_DIR=/data/uploads`
3. **백엔드 자동 선택** (`lib/storage.ts`): `STORAGE_*` 5종 환경변수가 모두 설정되면 R2, 아니면 디스크. **saveFile() 시그니처 불변** — 호출부(API 라우트) 수정 없이 환경변수만으로 전환
4. 디스크 모드 서빙: `app/uploads/[name]/route.ts` (경로 탈출 차단, 1년 immutable 캐시). URL 형태는 두 모드 모두 동일 패턴 유지
5. 클라이언트 리사이즈: `lib/image-resize.ts` — 업로드 전 긴 변 1600px·JPEG 0.82 재인코딩 (createImageBitmap EXIF 회전 반영, HEIC 디코딩 실패 시 원본 폴백). 서버 측 sharp 압축은 nixpacks 네이티브 바이너리 리스크(Tailwind v4 전례)로 채택 안 함

## R2 전환 시 필요한 것 (테오)

Cloudflare 대시보드 → R2 → 버킷 `villa-pms-uploads` 생성 + API 토큰(객체 읽기/쓰기) 발급 후 Railway 변수 5종 설정:
`STORAGE_ACCOUNT_ID`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET_NAME`, `STORAGE_PUBLIC_URL`(버킷 공개 도메인)

## 결과

- 코드 변경 없이 환경변수로 R2 전환 가능. 전환 후 volume의 기존 파일은 수동 이관(오픈 전 데이터 적으므로 부담 없음)
- DB에는 URL 문자열만 저장되므로 두 모드 혼재 가능 (기존 /uploads/… URL은 volume 유지 기간 동안 유효)
