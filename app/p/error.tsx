"use client";

// app/p/error.tsx — 공개 제안 링크 포털 에러 바운더리.
//   순간 502/청크 로드 실패 시 백지(WSOD) 대신 "다시 시도" 화면을 보여 복구.
import PublicErrorBoundary from "@/components/public-error-boundary";

export default function ProposalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PublicErrorBoundary {...props} />;
}
