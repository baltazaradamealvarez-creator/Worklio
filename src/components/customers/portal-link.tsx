"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { portalLinkAction } from "@/app/actions/admin";
import { Dialog } from "@/components/ui/client";
import { MenuItem } from "@/components/ui/client";
import { Button } from "@/components/ui/primitives";

export function PortalLinkDialog({ customerId, hasEmail }: { customerId: string; hasEmail: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const make = (send: boolean) => start(async () => {
    const r = await portalLinkAction(customerId, send);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.message ?? "Done");
    setUrl(r.data?.url ?? null);
  });
  return (
    <Dialog title="Customer portal" description="A secure link where the customer can view upcoming visits, quotes and invoices, pay, and message you. Creating a new link doesn't revoke earlier ones." trigger={<MenuItem>Customer portal link…</MenuItem>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={pending} onClick={() => make(false)}>Generate link</Button>
          {hasEmail && <Button disabled={pending} onClick={() => make(true)}>Email link to customer</Button>}
        </div>
        {url && (
          <div className="space-y-2"><input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-9 w-full rounded-md border border-line-strong bg-surface-2 px-3 font-mono text-xs" /><Button size="sm" onClick={() => { void navigator.clipboard.writeText(url); toast.success("Link copied"); }}>Copy link</Button></div>
        )}
      </div>
    </Dialog>
  );
}
