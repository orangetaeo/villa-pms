-- ADR-0023 S2 — 발주 알림 유형 추가 (additive enum, db push 금지)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_PO';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_PO_RESPONSE';
