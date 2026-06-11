export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-slate-50 text-slate-900 min-h-screen flex flex-col">
      {children}
    </div>
  );
}
