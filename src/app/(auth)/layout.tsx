import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">W</span>
        <span className="text-lg font-semibold tracking-tight">Worklio</span>
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">{children}</div>
      <p className="mt-6 text-xs text-fg-3">Operations software for HVAC companies</p>
    </div>
  );
}
