import { logoutAction } from "@/app/actions/shell";
import { Button, Notice } from "@/components/ui/primitives";

export default function NoAccess() {
  return (
    <>
      <h1 className="text-lg font-semibold">No active company</h1>
      <div className="my-4"><Notice tone="warn">Your account isn't attached to an active company. It may be suspended, or your access may have been removed. Contact your administrator.</Notice></div>
      <form action={logoutAction}><Button type="submit" className="w-full" size="lg">Sign out</Button></form>
    </>
  );
}
