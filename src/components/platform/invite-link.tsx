"use client";

import { toast } from "sonner";
import { Button, Notice } from "@/components/ui/primitives";

export function InviteLink({ url }: { url: string }) {
  return (
    <Notice tone="success" title="Owner invitation link">
      <p className="mb-2">We tried to email this to the owner. Delivery only works once email is configured (Platform → Settings), so if nothing arrives, share this link securely instead — it expires in 7 days and works once.</p>
      <div className="flex flex-wrap items-center gap-2"><input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 font-mono text-xs" /><Button size="sm" onClick={() => { void navigator.clipboard.writeText(url); toast.success("Link copied"); }}>Copy</Button></div>
    </Notice>
  );
}
