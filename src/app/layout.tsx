import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Worklio", template: "%s · Worklio" }, description: "Operations software for HVAC companies" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2a5bd7" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {children}
        <Toaster position="bottom-right" toastOptions={{ classNames: { toast: "!text-[13px]" } }} />
      </body>
    </html>
  );
}
