# 계약: 공개 마케팅에서 빌라 실명 제거 (재고 비공개 원칙 1 위배 교정)

## 배경 / 문제
마케팅 산출물(YT 쇼츠 음성·화면, IG 캡션·헤드라인, SEO 블로그, slug URL)에 빌라 **고유 실명**
(`villa.name`·`villa.nameVi`)이 그대로 박혀 있다. 한국 여행객이 실명으로 검색하면 빌라의 직접 예약
페이지(Airbnb/Agoda)나 공급자를 찾아 **테오를 우회한 직거래**가 가능 → 원칙 1(재고 비공개)·원칙 2(마진
비공개) 동시 붕괴.

## 결정 (테오, 2026-07-24)
1. 공개 명칭 = **지역·특징 자동 문구**. 별칭 필드(publicName) 추가 없음, 스키마 변경 없음.
2. **단지명(complex)은 노출 OK** — "푸꾸옥 [단지] N베드 프라이빗 풀빌라" 형태로 조합.
3. 고유 빌라 실명(`name`/`nameVi`)은 **모든 공개 경로에서 완전 제거**.
4. **내부(운영자) 화면은 실명 유지** — 운영자가 빌라를 식별해야 하므로 admin 큐·업로드·관리 화면은 그대로.

## 공개 표시명 헬퍼 (신규 단일 소스)
`lib/marketing/public-name.ts`
```ts
export interface PublicNameFacts {
  complex?: string | null;
  areaNameKo?: string | null; // 한글 단지 병기(쏘나씨). 있으면 우선
  bedrooms?: number | null;
  hasPool?: boolean;
}
/** 공개 마케팅 표시명 — 고유 빌라 실명 절대 미사용. 지역/단지 + 특징 조합. */
export function publicVillaLabel(v: PublicNameFacts): string
```
- 기본형: `푸꾸옥 {단지} {N}베드 프라이빗 풀빌라` (단지 = areaNameKo ?? complex)
- 단지 없음: `푸꾸옥 {N}베드 프라이빗 풀빌라`
- 풀 없음: "풀빌라" → "빌라"
- 예: `푸꾸옥 쏘나씨 3베드 프라이빗 풀빌라`
- **결정형**(무작위 금지) — 같은 빌라는 항상 같은 라벨(SEO title/JSON-LD 일관성).

## 수정 경로 (공개 = 실명 제거, 8곳)

| # | 파일 | 지점 | 조치 |
|---|---|---|---|
| 1 | `lib/youtube/narration.ts` | 435 `빌라: ${toKoreanReading(ctx.villaName)}`, 445 지시문 | villaName 프롬프트 주입 제거. 인트로 훅 지시를 "단지·핵심 특징으로"로 교체. NarrationVillaContext에서 villaName 제거(또는 미사용). 단지가 영문이면 TTS 오독 방지 위해 areaNameKo/toKoreanReading 적용 |
| 2 | `lib/youtube/edit.ts` | 인트로 부제 `villaName`(527·570·1071·1223·1425·1570) | 인트로 화면 부제에서 실명 제거. `publicVillaLabel` 사용 or 부제 생략 |
| 3 | `lib/youtube/clip-draft.ts` | 88 `buildTourHeadline` 해변>400m 폴백 `v.name` | 화면 헤드라인 폴백을 `publicVillaLabel`(또는 "푸꾸옥 프라이빗 풀빌라")로 교체 |
| 4 | `lib/youtube/meta.ts` | 103 `villaName: v.name`, 178 `v.complex ?? v.name` | 프롬프트 data에서 villaName 제거. 폴백 `?? v.name` 제거(단지 없으면 지역/특징). 대신 `publicLabel` 전달 |
| 5 | `lib/instagram/caption.ts` | 81 `{villaName}`, 82 `?? v.name`, 175 `villaName: v.name` | `{villaName}` 치환을 publicVillaLabel로. `{complex}` 폴백에서 `?? v.name` 제거. 프롬프트 data villaName 제거 |
| 6 | `lib/instagram/content-guide.ts` + `docs/marketing/copy-guide.md` | 32 `{villaName}에서 보내는...` 헤드라인 | 해당 템플릿에서 `{villaName}` 제거(범용 문구로 대체) |
| 7 | `components/seo/villa-list.tsx` (34·44), `app/blog/villa/[slug]/page.tsx` (50·82·115·163·164·171) | `{v.name}`·`{v.nameVi}`·alt·`<title>`·`<h1>`·JSON-LD name | 전부 `publicVillaLabel` 사용. nameVi 병기 제거 |
| 8 | `lib/seo/public-villa.ts` `buildPublicSlug` (214) | `nameVi ?? name` | slug 생성을 실명 미사용으로: `{complex-latin}-{N}br-villa-{id8}`. 단지 없으면 `villa-{id8}`. **기존 발급 slug는 불변 — 건드리지 않음**(URL 안정성). 신규만 적용 |

## DTO 이중 방어 (실명이 화면에 도달 불가하게)
- `lib/seo/public-villa.ts`: `PUBLIC_VILLA_SELECT`/`PublicVilla`/`toPublicVilla`에서 `name`·`nameVi` **제거**하고
  computed `publicLabel: string` 추가. (complex·areaNameKo·bedrooms·hasPool은 이미 select에 있음)
- `lib/instagram/draft.ts`의 `VillaPublicInfo`(IG/YT 소비 타입): `name` 제거가 이상적이나 slug·내부 로깅에서
  쓰일 수 있으니, **최소 조치 = 공개 생성기(meta/caption/narration)에 villaName을 넘기지 않는 것**.
  가능하면 VillaPublicInfo에도 `publicLabel` 추가하고 name은 내부 전용으로 격리.

## 완료 기준 (테스트 가능)
1. **누수 회귀 테스트**(`tests/seo-leak.test.ts` 확장 또는 신규 `tests/public-name-leak.test.ts`):
   - `publicVillaLabel({complex:"Sonasea", areaNameKo:"쏘나씨", bedrooms:3, hasPool:true})` === `"푸꾸옥 쏘나씨 3베드 프라이빗 풀빌라"` (결정형)
   - 생성기(meta/caption/narration 프롬프트 빌더)의 출력 문자열에 대표 실명("M villa M1"·"Sonasea V12")이 **포함되지 않음**을 assert
   - `buildPublicSlug({name:"쏘나씨 V12", nameVi:"Sonasea V12", complex:"Sonasea", ...})`에 `v12`·`sonasea-v12` 미포함, 실명 토큰 부재
   - `toPublicVilla` 결과에 `name`/`nameVi` 키 부재, `publicLabel` 존재
2. `npm run typecheck` 통과
3. `npm run build` 통과(배포 게이트)
4. 기존 `tests/seo-leak.test.ts`의 slug 기대값 갱신(실명 미포함 형태로)

## 수정 금지 구역 (내부 = 실명 유지)
- `lib/youtube/serialize.ts` (admin 큐), `app/api/uploads/route.ts`(내부 파일명), 운영자 villas 관리 화면,
  `lib/youtube/draft.ts`의 `baseName`(출력 파일명·내부). 실명은 운영자 식별용으로 그대로 둔다.

## 검증자
작성자 ≠ 평가자. 구현 후 QA가 독립적으로 누수 회귀 + build 게이트 확인.
