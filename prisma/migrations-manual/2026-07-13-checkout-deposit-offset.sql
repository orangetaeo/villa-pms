-- 2026-07-13 — 체크아웃 보증금 상계(가감산) 수납 수단 (additive, 계약서 T-checkout-deposit-offset, ADR-0041)
-- 청구(미니바+부가서비스)를 보증금에서 차감하고 잔액만 환불/부족분만 수납하는 흐름.
-- 수납 라인(CheckoutSettlementLine)의 method로 DEPOSIT(보증금 차감)을 추가 — currency=VND 전용(서버 검증).
ALTER TYPE "GuestSettlementMethod" ADD VALUE IF NOT EXISTS 'DEPOSIT';
