"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/server/actions";
import { Button, buttonClass, type ButtonVariant } from "./primitives";

const FormErrors = createContext<Record<string, string> | undefined>(undefined);
const DialogContext = createContext<{ close: () => void } | null>(null);
/** Lets any client component inside a <Dialog> close it. */
export const useDialog = () => useContext(DialogContext);
export const useFieldError = (name?: string) => (name ? useContext(FormErrors)?.[name] : undefined);

export function SubmitButton({ children, variant = "primary", size = "md", pendingLabel, className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || props.disabled} className={buttonClass(variant, size, className)} {...props}>
      {pending && <Spinner />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} aria-hidden />;
}

type ServerAction = (formData: FormData) => Promise<ActionResult<unknown>>;

/**
 * Form wired to a server action. Shows a banner for errors, field errors under inputs (by
 * name), a toast on success, and follows `redirectTo`. Inputs stay populated on error.
 */
export function ActionForm({ action, children, className, onSuccess, resetOnSuccess, successMessage }: { action: ServerAction; children: ReactNode | ((s: { error?: string; fieldErrors?: Record<string, string> }) => ReactNode); className?: string; onSuccess?: (r: ActionResult<unknown>) => void; resetOnSuccess?: boolean; successMessage?: string }) {
  const router = useRouter();
  const dialog = useContext(DialogContext);
  const ref = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<{ error?: string; fieldErrors?: Record<string, string> }>({});
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    start(async () => {
      const r = await action(fd);
      if (r.ok) {
        setState({});
        if (r.message || successMessage) toast.success(r.message ?? successMessage);
        if (resetOnSuccess) ref.current?.reset();
        onSuccess?.(r);
        dialog?.close();
        if (r.redirectTo) router.push(r.redirectTo);
        else router.refresh();
      } else {
        setState({ error: r.error, fieldErrors: r.fieldErrors });
        ref.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      }
    });
  }

  return (
    <form ref={ref} action={submit} className={className} aria-busy={pending}>
      {state.error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {state.error}
        </div>
      )}
      <FormErrors.Provider value={state.fieldErrors}>{typeof children === "function" ? children(state) : children}</FormErrors.Provider>
    </form>
  );
}

/** Label + control + server-reported error for `name`, wired through the surrounding ActionForm. */
export function FField({ label, name, hint, required, children, className }: { label: ReactNode; name: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  const error = useFieldError(name);
  return (
    <div className={cn("space-y-1", className)} data-invalid={error ? "true" : undefined}>
      <label className="block text-[12.5px] font-medium text-fg-2">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-danger" role="alert">{error}</p> : hint ? <p className="text-xs text-fg-3">{hint}</p> : null}
    </div>
  );
}

// ─── Dialog / drawer ──────────────────────────────────────────────────────────────

export function Dialog({ trigger, title, description, children, side = false, width = "max-w-lg", open: controlled, onOpenChange, triggerClassName }: { triggerClassName?: string; trigger?: ReactNode; title: string; description?: string; children: ReactNode; side?: boolean; width?: string; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [internal, setInternal] = useState(false);
  const open = controlled ?? internal;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setInternal(o));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      {trigger && (
        <span onClick={() => setOpen(true)} className={cn("inline-flex", triggerClassName)}>
          {trigger}
        </span>
      )}
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && setOpen(false)}
        className={cn("m-auto w-full rounded-lg bg-surface p-0 text-fg shadow-pop backdrop:backdrop-blur-[1px]", width, side && "ml-auto mr-0 h-dvh max-h-dvh max-w-md rounded-none")}
        aria-labelledby="dlg-title"
      >
        {open && (
          <div className={cn("flex max-h-[90dvh] flex-col", side && "h-dvh max-h-dvh")}>
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
              <div>
                <h2 id="dlg-title" className="text-sm font-semibold">{title}</h2>
                {description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-fg-3 hover:bg-surface-2 hover:text-fg">✕</button>
            </header>
            <div className="overflow-y-auto px-5 py-4"><DialogContext.Provider value={{ close: () => setOpen(false) }}>{children}</DialogContext.Provider></div>
          </div>
        )}
      </dialog>
    </>
  );
}

/** Button that asks for confirmation (optionally a reason), then runs a server action. */
export function ConfirmAction({ label, title, description, action, confirmLabel, variant = "danger-outline", size = "md", askReason, reasonLabel = "Reason", successMessage, className, children }: { label: ReactNode; title: string; description?: string; action: (reason: string) => Promise<ActionResult<unknown>>; confirmLabel?: string; variant?: ButtonVariant; size?: "sm" | "md"; askReason?: boolean; reasonLabel?: string; successMessage?: string; className?: string; children?: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => { setOpen(true); setError(undefined); }}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={title} description={description} width="max-w-md">
        <div className="space-y-3">
          {children}
          {askReason && (
            <label className="block space-y-1">
              <span className="text-[12.5px] font-medium text-fg-2">{reasonLabel}</span>
              <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded-md border border-line-strong px-2.5 py-1.5 text-[13px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </label>
          )}
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant={variant === "danger-outline" ? "danger" : "primary"}
              disabled={pending || (askReason && !reason.trim())}
              onClick={() =>
                start(async () => {
                  const r = await action(reason);
                  if (r.ok) {
                    setOpen(false);
                    setReason("");
                    toast.success(r.message ?? successMessage ?? "Done");
                    if (r.redirectTo) router.push(r.redirectTo);
                    else router.refresh();
                  } else setError(r.error);
                })
              }
            >
              {pending && <Spinner />} {confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** One-click server action with toast + refresh (no confirmation). */
export function QuickAction({ label, action, variant = "secondary", size = "md", successMessage, className }: { label: ReactNode; action: () => Promise<ActionResult<unknown>>; variant?: ButtonVariant; size?: "sm" | "md" | "lg"; successMessage?: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await action();
          if (r.ok) {
            if (r.message || successMessage) toast.success(r.message ?? successMessage);
            if (r.redirectTo) router.push(r.redirectTo);
            else router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {pending && <Spinner />}
      {label}
    </Button>
  );
}

/** Dropdown menu using the native popover; closes on outside click and Escape. */
export function Menu({ trigger, children, align = "right" }: { trigger: ReactNode; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex">{trigger}</button>
      {open && (
        <div role="menu" onClick={() => setOpen(false)} className={cn("absolute z-40 mt-1.5 min-w-48 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-pop", align === "right" ? "right-0" : "left-0")}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, className, ...props }: ComponentProps<"button">) {
  return <button role="menuitem" type="button" className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-fg hover:bg-surface-2", className)} {...props}>{children}</button>;
}
