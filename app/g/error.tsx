"use client";

// app/g/error.tsx — 게스트 셀프 체크인 포털 에러 바운더리.
//   순간 502/청크 로드 실패 시 백지(WSOD) 대신 "다시 시도" 화면을 보여 복구.
import PublicErrorBoundary from "@/components/public-error-boundary";

export default function GuestError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PublicErrorBoundary {...props} />;
}
