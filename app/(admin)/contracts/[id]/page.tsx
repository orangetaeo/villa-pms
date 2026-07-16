// /contracts/[id] — 사업 계약서 상세·서명본 열람·프린트 (운영자, T-business-contract-esign)
//   RSC: 정본 md 서버 렌더(renderContractForCounterpart) — SIGNED면 서명 정보 포함.
//   프린트: globals.css .print-sheet/.no-print A4 패턴 재사용. 서명 이미지는 운영자 전체 접근.
//   ★ 누수: termsJson 원시값은 표시하지 않고 렌더된 정본 본문만 노출. 마진·판매가 없음.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import {
  isContractType,
  renderContractForCounterpart,
} from "@/lib/business-contract";
import ContractDocument from "@/components/business-contract/contract-document";
import ContractPrintButton from "@/components/business-contract/print-button";
import ContractActions from "./contract-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContracts");
  return { title: `${t("detail.heading")} — Villa Go` };
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-slate-700/40 text-slate-300",
  SENT: "bg-amber-500/15 text-amber-300",
  SIGNED: "bg-emerald-500/15 text-emerald-300",
  VOID: "bg-red-500/15 text-red-300",
};

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .replace(/-/g, ".");
}

export default async function AdminContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("adminContracts");

  const contract = await prisma.businessContract.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      counterpartId: true,
      status: true,
      standardVersion: true,
      locale: true,
      termsJson: true,
      counterpartIdNumber: true,
      counterpartAddress: true,
      counterpartSignName: true,
      signatureUrl: true,
      signedAt: true,
      sentAt: true,
      createdAt: true,
    },
  });
  if (!contract) notFound();

  const user = await prisma.user.findUnique({
    where: { id: contract.counterpartId },
    select: { name: true, phone: true, zaloContact: true },
  });

  const signed = contract.status === "SIGNED";

  // 정본 md 서버 렌더 — 부재/오류 시 본문 대신 안내(운영자는 메타로 상태 파악).
  let body: string | null = null;
  if (isContractType(contract.type)) {
    try {
      body = await renderContractForCounterpart(
        {
          type: contract.type,
          locale: contract.locale,
          termsJson: contract.termsJson,
          counterpartIdNumber: contract.counterpartIdNumber,
          counterpartAddress: contract.counterpartAddress,
          signedAt: contract.signedAt,
        },
        {
          name: user?.name ?? "",
          phone: user?.phone ?? null,
          zaloContact: user?.zaloContact ?? null,
        },
        { includeSignature: signed },
      );
    } catch {
      body = null;
    }
  }

  return (
    <div className="space-y-6">
      {/* 툴바 (no-print) */}
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/contracts" className="text-sm text-slate-400 hover:text-white">
            ← {t("backToList")}
          </Link>
          <span
            className={
              "inline-flex rounded-full px-2.5 py-1 text-xs font-bold " +
              (STATUS_TONE[contract.status] ?? "bg-slate-700/40 text-slate-300")
            }
          >
            {t(`status.${contract.status}`)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {body && <ContractPrintButton label={t("print")} />}
          <ContractActions contractId={contract.id} status={contract.status} />
        </div>
      </div>

      {/* 메타 패널 (no-print) */}
      <dl className="no-print grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-slate-800 bg-admin-card p-6 md:grid-cols-4">
        <Meta label={t("detail.counterpart")} value={user?.name ?? "—"} />
        <Meta label={t("detail.type")} value={t(`type.${contract.type}`)} />
        <Meta label={t("detail.locale")} value={contract.locale.toUpperCase()} />
        <Meta label={t("detail.standardVersion")} value={contract.standardVersion} />
        <Meta label={t("detail.createdAt")} value={fmt(contract.createdAt)} />
        <Meta label={t("detail.sentAt")} value={fmt(contract.sentAt)} />
        <Meta label={t("detail.signedAt")} value={fmt(contract.signedAt)} />
        {signed && <Meta label={t("detail.signName")} value={contract.counterpartSignName ?? "—"} />}
        {signed && contract.counterpartIdNumber && (
          <Meta label={t("detail.idNumber")} value={contract.counterpartIdNumber} />
        )}
        {signed && contract.counterpartAddress && (
          <Meta label={t("detail.address")} value={contract.counterpartAddress} />
        )}
      </dl>

      {/* 본문 — 프린트 대상 */}
      {body ? (
        <div className="print-sheet">
          <ContractDocument
            body={body}
            signed={signed}
            signatureUrl={contract.signatureUrl}
            signName={contract.counterpartSignName}
            signedAt={fmt(contract.signedAt)}
          />
        </div>
      ) : (
        <div className="no-print rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-6 text-center text-sm text-amber-300">
          {t("detail.unavailable")}
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-100">{value}</dd>
    </div>
  );
}
