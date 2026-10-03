import { saveTaskAction } from "@/app/actions/admin";
import { ActionForm, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";

export function NewTaskDialog({ assignees, currentUserId, customer, defaultOpen }: { assignees: { userId: string; name: string }[]; currentUserId: string; customer?: { id: string; name: string } | null; defaultOpen?: boolean }) {
  return (
    <Dialog defaultOpen={defaultOpen} title="New task" description={customer ? `Linked to ${customer.name}` : "Follow-ups, calls and to-dos for the team."} trigger={<Button variant="primary"><Icon name="plus" size={14} /> New task</Button>}>
      <ActionForm action={saveTaskAction.bind(null, null)} resetOnSuccess className="space-y-4">
        {customer && <input type="hidden" name="customerId" value={customer.id} />}
        <FField label="Title" name="title" required><Input name="title" required autoFocus /></FField>
        <FField label="Details" name="description"><Textarea name="description" rows={3} /></FField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FField label="Due" name="dueAt"><Input name="dueAt" type="datetime-local" /></FField>
          <FField label="Priority" name="priority"><Select name="priority" defaultValue="NORMAL"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="EMERGENCY">Urgent</option></Select></FField>
          <FField label="Assignee" name="assigneeUserId"><Select name="assigneeUserId" defaultValue={currentUserId}>{assignees.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}</Select></FField>
        </div>
        <div className="flex justify-end"><SubmitButton>Create task</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
