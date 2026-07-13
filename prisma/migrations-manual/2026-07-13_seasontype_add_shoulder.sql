-- 목적: 시즌 구분자 "준성수기(SHOULDER)"를 SeasonType enum에 추가.
--   현행 LOW(비수기) / HIGH(성수기) / PEAK(극성수기) 사이에 LOW < SHOULDER < HIGH 단계로 삽입.
--   admin·공급자 기간별요금 화면에서 선택·표시 가능하도록 하는 T-season-shoulder 작업의 DB 선반영.
-- 규약(CLAUDE.md): 라이브 Railway DB에 additive raw SQL 직접 적용, prisma migrate/db push 금지.
--   ALTER TYPE ... ADD VALUE 는 트랜잭션 밖 단독 문장으로 실행해야 한다.
-- 적용일: 2026-07-13

ALTER TYPE "SeasonType" ADD VALUE IF NOT EXISTS 'SHOULDER' BEFORE 'HIGH';
