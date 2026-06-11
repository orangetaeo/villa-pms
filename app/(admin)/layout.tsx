import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session || session.user?.role !== "ADMIN") {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* TODO: 사이드바 추가 (Sprint 2 T2.6) */}
      <main className="p-6">{children}</main>
    </div>
  );
}
