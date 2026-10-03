"use client";

import type { EntityType } from "@prisma/client";
import { deleteFileAction, uploadFilesAction } from "@/app/actions/customers";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/client";
import { Badge, EmptyState, Input, Select } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { formatBytes, formatDate, humanize } from "@/lib/format";

export interface FileView {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: string;
  caption: string | null;
  createdAt: string;
}

const KINDS = ["DOCUMENT", "PHOTO", "MANUAL", "WARRANTY", "CONTRACT", "BEFORE_PHOTO", "AFTER_PHOTO", "RECEIPT", "OTHER"];

export function FilesPanel({ entityType, entityId, files, canUpload, canDelete, tz, defaultKind = "DOCUMENT" }: { entityType: EntityType; entityId: string; files: FileView[]; canUpload: boolean; canDelete: boolean; tz: string; defaultKind?: string }) {
  const images = files.filter((f) => f.mimeType.startsWith("image/"));
  const docs = files.filter((f) => !f.mimeType.startsWith("image/"));
  return (
    <div className="space-y-4">
      {canUpload && (
        <ActionForm action={uploadFilesAction.bind(null, entityType, entityId)} resetOnSuccess className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-line-strong bg-surface p-3">
          <label className="min-w-56 flex-1 space-y-1">
            <span className="block text-[12.5px] font-medium text-fg-2">Files (images, PDFs, documents — up to 25 MB each)</span>
            <input type="file" name="files" multiple required accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="block w-full text-[13px] file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1 file:text-[13px] file:font-medium hover:file:bg-surface-2" />
          </label>
          <label className="space-y-1"><span className="block text-[12.5px] font-medium text-fg-2">Type</span>
            <Select name="kind" defaultValue={defaultKind}>{KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</Select></label>
          <label className="min-w-40 space-y-1"><span className="block text-[12.5px] font-medium text-fg-2">Caption (optional)</span><Input name="caption" maxLength={300} /></label>
          <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
        </ActionForm>
      )}
      {files.length === 0 ? (
        <EmptyState icon={<Icon name="paperclip" size={18} />} title="No files yet" description="Attach photos, manuals, warranty documents and contracts. Files are private to your company." />
      ) : (
        <>
          {images.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {images.map((f) => (
                <li key={f.id} className="group overflow-hidden rounded-lg border border-line bg-surface">
                  <a href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="block aspect-[4/3] bg-surface-2">
                    { }
                    <img src={`/api/files/${f.id}`} alt={f.caption ?? f.filename} loading="lazy" className="size-full object-cover" />
                  </a>
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <div className="min-w-0"><div className="truncate text-xs font-medium">{f.caption || f.filename}</div><div className="text-[11px] text-fg-3">{formatDate(f.createdAt, tz)}</div></div>
                    {canDelete && <ConfirmAction size="sm" variant="ghost" label={<Icon name="trash-2" size={13} />} title="Delete this file?" confirmLabel="Delete" action={() => deleteFileAction(f.id)} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {docs.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {docs.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Icon name="file-text" size={18} className="shrink-0 text-fg-3" />
                  <div className="min-w-0 flex-1">
                    <a href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium hover:text-primary hover:underline">{f.filename}</a>
                    <div className="text-xs text-fg-3">{formatBytes(f.sizeBytes)} · {formatDate(f.createdAt, tz)}{f.caption ? ` · ${f.caption}` : ""}</div>
                  </div>
                  <Badge>{humanize(f.kind)}</Badge>
                  <a href={`/api/files/${f.id}?download=1`} aria-label={`Download ${f.filename}`} className="rounded p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg"><Icon name="download" size={15} /></a>
                  {canDelete && <ConfirmAction size="sm" variant="ghost" label={<Icon name="trash-2" size={14} />} title="Delete this file?" confirmLabel="Delete" action={() => deleteFileAction(f.id)} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
