import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { completeOnboardingAction, onboardingSaveAction, onboardingSkipAction } from "@/app/actions/people";
import { BrandingFields, CompanyFields, FinancialFields, OperationsFields } from "@/components/settings/fields";
import { ActionForm, ConfirmAction, QuickAction, SubmitButton } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { Button, Card, LinkButton } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { ONBOARDING_STEPS, getSettings, onboardingState, type OnboardingStep } from "@/server/domain/settings";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Set up your company" };

const META: Record<OnboardingStep, { title: string; blurb: string }> = {
  company: { title: "Company details", blurb: "Your legal and contact information, timezone and default sales tax." },
  branding: { title: "Branding", blurb: "Your logo and colors appear on every quote, invoice and customer email." },
  operations: { title: "Operations", blurb: "Business hours, scheduling defaults and how documents are numbered." },
  financial: { title: "Payments & terms", blurb: "Payment terms, deposits and the terms customers agree to." },
  team: { title: "Your team", blurb: "Invite office staff and technicians so they can sign in." },
};

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await pageCtx();
  if (!can(ctx, "settings.manage")) redirect("/dashboard");
  const [s, state] = await Promise.all([getSettings(ctx), onboardingState(ctx)]);
  const step = sp.step === "finish" ? "finish" : (ONBOARDING_STEPS as readonly string[]).includes(sp.step ?? "") ? (sp.step as OnboardingStep) : (ONBOARDING_STEPS.find((k) => !state.progress[k]) ?? "finish");
  const idx = step === "finish" ? ONBOARDING_STEPS.length : ONBOARDING_STEPS.indexOf(step);
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[260px_1fr]">
      <aside>
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold"><span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-white"><Icon name="wrench" size={15} /></span> Worklio</div>
        <h1 className="text-lg font-semibold">Welcome, {ctx.tenantName}</h1>
        <p className="mt-1 text-[13px] text-fg-3">A few quick steps to get your account ready. You can skip anything and finish it later in Settings.</p>
        <ol className="mt-6 space-y-1">{ONBOARDING_STEPS.map((k, i) => {
          const st = state.progress[k];
          return (
            <li key={k}><Link href={`/onboarding?step=${k}`} className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] ${k === step ? "bg-primary-soft font-medium text-primary" : "text-fg-2 hover:bg-surface-2"}`}>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${st === true ? "bg-success text-white" : k === step ? "bg-primary text-white" : "bg-surface-2 text-fg-3"}`}>{st === true ? <Icon name="check" size={12} /> : i + 1}</span>
              <span className="flex-1">{META[k].title}</span>{st === "skipped" && <span className="text-[11px] text-fg-3">Skipped</span>}
            </Link></li>);
        })}</ol>
      </aside>
      <main className="min-w-0">
        {step === "finish" ? (
          <Card title="You're ready to go">
            <p className="text-[13px] text-fg-2">Your company is set up. Here's what most teams do next:</p>
            <ul className="mt-4 space-y-2 text-[13px]">{[["/pricebook", "Build your pricebook", "Services, labor and materials you quote and invoice."], ["/employees/new", "Add your technicians", "So you can schedule and dispatch jobs."], ["/customers/new", "Add your first customer", "Or import them as you go."], ["/settings/team", "Invite your office team", "Dispatchers, estimators and managers."]].map(([href, t, d]) => <li key={href}><Link href={href!} className="flex items-start gap-3 rounded-md border border-line p-3 hover:bg-surface-2/60"><Icon name="check-circle-2" size={16} className="mt-0.5 text-primary" /><span><span className="block font-medium">{t}</span><span className="text-fg-3">{d}</span></span></Link></li>)}</ul>
            <div className="mt-6 flex justify-end"><QuickAction label="Go to dashboard" variant="primary" action={completeOnboardingAction} /></div>
          </Card>
        ) : (
          <>
            <div className="mb-4"><div className="text-xs font-medium text-fg-3">Step {idx + 1} of {ONBOARDING_STEPS.length}</div><h2 className="text-xl font-semibold">{META[step].title}</h2><p className="text-[13px] text-fg-3">{META[step].blurb}</p></div>
            {step === "team" ? (
              <Card>
                <p className="text-[13px] text-fg-2">Invite people from <strong>Settings → Team &amp; roles</strong> after setup — you can assign built-in roles (Dispatcher, Estimator, Technician, Office Manager…) or create custom ones with exactly the permissions you want.</p>
                <p className="mt-3 text-[13px] text-fg-3">Technician accounts only ever see the jobs and customers assigned to them.</p>
                <div className="mt-6 flex justify-end gap-2"><QuickAction label="Continue" variant="primary" action={onboardingSkipAction.bind(null, "team")} /></div>
              </Card>
            ) : (
              <ActionForm action={onboardingSaveAction.bind(null, step)} className="space-y-5">
                <Card>
                  {step === "company" && <CompanyFields s={s} name={ctx.tenantName} />}
                  {step === "branding" && <BrandingFields s={s} tenantId={ctx.tenantId} />}
                  {step === "operations" && <OperationsFields s={s} />}
                  {step === "financial" && <FinancialFields s={s} />}
                </Card>
                <div className="flex items-center justify-between">
                  <QuickAction label="Skip for now" variant="ghost" action={onboardingSkipAction.bind(null, step)} />
                  <SubmitButton>Save and continue</SubmitButton>
                </div>
              </ActionForm>
            )}
          </>
        )}
      </main>
    </div>
  );
  void Button; void LinkButton; void ConfirmAction;
}
