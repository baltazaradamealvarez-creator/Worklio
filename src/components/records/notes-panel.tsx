"use client";

import { useRef, useState } from "react";
import type { EntityType, NoteType } from "@prisma/client";
import { addNoteAction, deleteNoteAction, editNoteAction, pinNoteAction } from "@/app/actions/customers";
import { ActionForm, ConfirmAction, Dialog, QuickAction, SubmitButton } from "@/components/ui/client";
import { Badge, Button, Checkbox, EmptyState, Select, Textarea, type Tone } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { relativeTime, humanize } from "@/lib/format";
import { NoteBody } from "./note-body";

export const NOTE_TYPES: { value: NoteType; label: string; tone: Tone }[] = [
  { value: "GENERAL", label: "General", tone: "gray" },
  { value: "TECHNICIAN", label: "Technician", tone: "blue" },
  { value: "BILLING", label: "Billing", tone: "purple" },
  { value: "CUSTOMER_SERVICE", label: "Customer service", tone: "teal" },
  { value: "SALES", label: "Sales", tone: "green" },
  { value: "INTERNAL", label: "Internal", tone: "gray" },
  { value: "WARNING", label: "Important warning", tone: "red" },
  { value: "ACCESS", label: "Access instructions", tone: "amber" },
];
const typeInfo = (t: string) => NOTE_TYPES.find((x) => x.value === t) ?? NOTE_TYPES[0]!;

export interface NoteView {
  id: string;
  type: NoteType;
  body: string;
  isPinned: boolean;
  isPrivate: boolean;
  authorId: string;
  authorName: string;
  createdAt: string;
  editedAt: string | null;
  revisions: number;
}

export function NotesPanel({ entityType, entityId, notes, mentionable, currentUserId, canCreate, canManage, filter }: { entityType: EntityType; entityId: string; notes: NoteView[]; mentionable: { userId: string; name: string }[]; currentUserId: string; canCreate: boolean; canManage: boolean; filter?: NoteType | "" }) {
  const [active, setActive] = useState<NoteType | "">(filter ?? "");
  const shown = active ? notes.filter((n) => n.type === active) : notes;
  const counts = new Map<string, number>();
  for (const n of notes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);

  return (
    <div className="space-y-4">
      {canCreate && <NoteComposer entityType={entityType} entityId={entityId} mentionable={mentionable} canManage={canManage} />}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter notes by type">
        <button onClick={() => setActive("")} className={`rounded-full px-2.5 py-1 text-xs font-medium ${active === "" ? "bg-fg text-white" : "bg-surface-2 text-fg-2 hover:bg-line"}`}>All {notes.length}</button>
        {NOTE_TYPES.filter((t) => counts.has(t.value)).map((t) => (
          <button key={t.value} onClick={() => setActive(t.value)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${active === t.value ? "bg-fg text-white" : "bg-surface-2 text-fg-2 hover:bg-line"}`}>{t.label} {counts.get(t.value)}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<Icon name="pin" size={18} />} title="No notes yet" description="Notes capture access instructions, warnings, billing agreements and anything the next person should know." />
      ) : (
        <ul className="space-y-3">
          {shown.map((n) => {
            const info = typeInfo(n.type);
            return (
              <li key={n.id} className={`rounded-lg border bg-surface p-3.5 ${n.type === "WARNING" ? "border-red-200 bg-danger-soft/40" : n.isPinned ? "border-amber-200 bg-warn-soft/40" : "border-line"}`}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Badge tone={info.tone}>{info.label}</Badge>
                  {n.isPinned && <Badge tone="amber"><Icon name="pin" size={11} /> Pinned</Badge>}
                  {n.isPrivate && <Badge tone="gray"><Icon name="lock" size={11} /> Private</Badge>}
                  <span className="ml-auto text-xs text-fg-3">{n.authorName} · {relativeTime(n.createdAt)}{n.editedAt && <> · edited{n.revisions ? ` (${n.revisions})` : ""}</>}</span>
                </div>
                <NoteBody body={n.body} />
                {(canManage || n.authorId === currentUserId) && (
                  <div className="mt-2 flex gap-1 border-t border-line/70 pt-2">
                    <EditNote note={n} mentionable={mentionable} />
                    {canManage && <QuickAction variant="ghost" size="sm" label={n.isPinned ? "Unpin" : "Pin"} action={() => pinNoteAction(n.id, !n.isPinned)} />}
                    <ConfirmAction size="sm" variant="ghost" label="Delete" title="Delete this note?" description="The note is removed from the record. This is logged in the audit trail." confirmLabel="Delete" action={() => deleteNoteAction(n.id)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MentionPicker({ mentionable, target }: { mentionable: { userId: string; name: string }[]; target: React.RefObject<HTMLTextAreaElement | null> }) {
  if (mentionable.length === 0) return null;
  return (
    <Select aria-label="Mention a teammate" className="h-7 w-auto text-xs" value="" onChange={(e) => {
      const u = mentionable.find((m) => m.userId === e.target.value);
      const ta = target.current;
      if (!u || !ta) return;
      const token = `@[${u.name}](user:${u.userId}) `;
      const s = ta.selectionStart ?? ta.value.length;
      ta.setRangeText(token, s, ta.selectionEnd ?? s, "end");
      ta.focus();
    }}>
      <option value="">@ Mention…</option>
      {mentionable.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
    </Select>
  );
}

function NoteComposer({ entityType, entityId, mentionable, canManage }: { entityType: EntityType; entityId: string; mentionable: { userId: string; name: string }[]; canManage: boolean }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  return (
    <ActionForm action={addNoteAction.bind(null, entityType, entityId)} resetOnSuccess className="rounded-lg border border-line bg-surface p-3">
      <Textarea ref={ta} name="body" rows={3} required placeholder="Add a note… use - for bullets, **bold**, or @ to mention a teammate" aria-label="Note" />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Select name="type" defaultValue="GENERAL" className="h-7 w-auto text-xs" aria-label="Note type">
          {NOTE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <MentionPicker mentionable={mentionable} target={ta} />
        {canManage && <Checkbox name="isPinned" label={<span className="text-xs">Pin</span>} />}
        <Checkbox name="isPrivate" label={<span className="text-xs">Private</span>} />
        <SubmitButton size="sm" className="ml-auto">Add note</SubmitButton>
      </div>
    </ActionForm>
  );
}

function EditNote({ note, mentionable }: { note: NoteView; mentionable: { userId: string; name: string }[] }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  return (
    <Dialog title="Edit note" trigger={<Button variant="ghost" size="sm">Edit</Button>}>
      {(
        <ActionForm action={editNoteAction.bind(null, note.id)} className="space-y-3">
          <Textarea ref={ta} name="body" rows={6} required defaultValue={note.body} aria-label="Note" />
          <div className="flex flex-wrap items-center gap-3">
            <Select name="type" defaultValue={note.type} className="h-7 w-auto text-xs" aria-label="Note type">{NOTE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
            <MentionPicker mentionable={mentionable} target={ta} />
            <Checkbox name="isPrivate" defaultChecked={note.isPrivate} label={<span className="text-xs">Private</span>} />
          </div>
          <p className="text-xs text-fg-3">Previous versions are kept in the note's edit history.</p>
          <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
        </ActionForm>
      )}
    </Dialog>
  );
}

void humanize;
