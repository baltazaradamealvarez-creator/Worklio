/**
 * Permission catalog and built-in roles.
 *
 * Permissions are plain strings stored on `Role.permissions`; the catalog below is the
 * source of truth for what exists. Every server action / service calls `can()` or
 * `requirePermission()` — hiding a nav link is never the only control.
 */

export const PERMISSION_GROUPS = [
  {
    key: "customers",
    label: "Customers & CRM",
    permissions: [
      ["customers.view", "View customers"],
      ["customers.create", "Create customers"],
      ["customers.edit", "Edit customers"],
      ["customers.delete", "Archive customers"],
      ["customers.export", "Export customer data"],
      ["leads.view", "View leads"],
      ["leads.manage", "Create, edit and convert leads"],
      ["equipment.view", "View equipment"],
      ["equipment.manage", "Create and edit equipment"],
      ["notes.view", "View notes"],
      ["notes.create", "Add notes"],
      ["notes.manage", "Edit/pin/delete any note"],
      ["notes.view_private", "View private notes"],
      ["files.view", "View and download files"],
      ["files.upload", "Upload files"],
      ["files.delete", "Delete files"],
      ["access_codes.view", "View property access codes"],
    ],
  },
  {
    key: "operations",
    label: "Jobs & scheduling",
    permissions: [
      ["jobs.view", "View all jobs"],
      ["jobs.view_assigned", "View jobs assigned to them"],
      ["jobs.create", "Create jobs"],
      ["jobs.edit", "Edit jobs"],
      ["jobs.assign", "Assign technicians"],
      ["jobs.complete", "Perform field work and complete jobs"],
      ["jobs.delete", "Cancel and archive jobs"],
      ["schedule.view", "View schedule and dispatch board"],
      ["schedule.manage", "Schedule and dispatch"],
      ["maintenance.view", "View maintenance agreements"],
      ["maintenance.manage", "Manage maintenance agreements"],
      ["tasks.view", "View tasks"],
      ["tasks.manage", "Create and manage tasks"],
    ],
  },
  {
    key: "sales",
    label: "Sales & pricebook",
    permissions: [
      ["quotes.view", "View quotes"],
      ["quotes.create", "Create quotes"],
      ["quotes.edit", "Edit quotes"],
      ["quotes.send", "Send quotes to customers"],
      ["quotes.approve", "Mark quotes approved/declined on behalf of customer"],
      ["pricebook.view", "View pricebook"],
      ["pricebook.manage", "Manage pricebook"],
      ["pricebook.view_costs", "See internal costs and margins"],
    ],
  },
  {
    key: "billing",
    label: "Billing & finance",
    permissions: [
      ["invoices.view", "View invoices"],
      ["invoices.create", "Create invoices"],
      ["invoices.edit", "Edit invoices"],
      ["invoices.send", "Send invoices"],
      ["invoices.void", "Void invoices"],
      ["payments.view", "View payments"],
      ["payments.record", "Record payments"],
      ["payments.void", "Void/refund payments"],
      ["expenses.view", "View expenses"],
      ["expenses.manage", "Record and edit expenses"],
      ["financials.view", "View financial overview"],
      ["reports.view", "View reports"],
      ["reports.export", "Export reports"],
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    permissions: [
      ["inventory.view", "View inventory"],
      ["inventory.manage", "Manage inventory and vendors"],
      ["inventory.consume", "Use materials on jobs"],
    ],
  },
  {
    key: "admin",
    label: "Company administration",
    permissions: [
      ["employees.view", "View employees"],
      ["employees.manage", "Create and edit employees"],
      ["employees.view_sensitive", "View emergency contacts & HR notes"],
      ["employees.view_compensation", "View hourly cost/compensation"],
      ["users.manage", "Invite users and assign roles"],
      ["roles.manage", "Create and edit roles"],
      ["settings.manage", "Manage company settings"],
      ["audit.view", "View audit log"],
    ],
  },
] as const;

type Entry = (typeof PERMISSION_GROUPS)[number]["permissions"][number];
export type Permission = Entry[0];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p[0]),
) as Permission[];

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);
export const isPermission = (p: string): p is Permission => PERMISSION_SET.has(p);

export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p[0], p[1]])),
);

const READ_ONLY: Permission[] = [
  "customers.view", "leads.view", "equipment.view", "notes.view", "files.view", "jobs.view", "schedule.view",
  "maintenance.view", "tasks.view", "quotes.view", "pricebook.view", "invoices.view", "payments.view", "inventory.view",
  "reports.view",
];

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

const without = (list: readonly Permission[], ...drop: Permission[]) => list.filter((p) => !drop.includes(p));

export const SYSTEM_ROLES: RoleTemplate[] = [
  {
    key: "OWNER",
    name: "Company Owner",
    description: "Full access, including billing, roles and company settings.",
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: "ADMIN",
    name: "Administrator",
    description: "Full access to operations, finances and user management.",
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: "OFFICE_MANAGER",
    name: "Office Manager",
    description: "Runs the office: customers, scheduling, billing and reporting.",
    permissions: without(
      ALL_PERMISSIONS,
      "roles.manage", "settings.manage", "users.manage", "employees.view_compensation", "payments.void",
    ),
  },
  {
    key: "DISPATCHER",
    name: "Dispatcher",
    description: "Schedules and dispatches technicians.",
    permissions: [
      ...READ_ONLY, "customers.create", "customers.edit", "equipment.manage", "notes.create", "files.upload",
      "access_codes.view", "jobs.create", "jobs.edit", "jobs.assign", "schedule.manage", "tasks.manage", "employees.view",
      "leads.manage",
    ].filter((p) => !["reports.view", "invoices.view", "payments.view", "pricebook.view"].includes(p)) as Permission[],
  },
  {
    key: "SALES",
    name: "Sales Representative",
    description: "Manages leads and builds quotes.",
    permissions: [
      "customers.view", "customers.create", "customers.edit", "leads.view", "leads.manage", "equipment.view",
      "equipment.manage", "notes.view", "notes.create", "files.view", "files.upload", "jobs.view", "jobs.create",
      "schedule.view", "quotes.view", "quotes.create", "quotes.edit", "quotes.send", "pricebook.view",
      "maintenance.view", "maintenance.manage", "tasks.view", "tasks.manage", "reports.view",
    ],
  },
  {
    key: "SERVICE_MANAGER",
    name: "Service Manager",
    description: "Oversees technicians, jobs, quality and service revenue.",
    permissions: without(
      ALL_PERMISSIONS,
      "roles.manage", "settings.manage", "users.manage", "employees.view_compensation", "payments.void",
      "invoices.void", "expenses.manage",
    ),
  },
  {
    key: "TECHNICIAN",
    name: "Technician",
    description: "Field technician: assigned jobs, notes, photos, materials, signatures.",
    permissions: [
      "customers.view", "equipment.view", "equipment.manage", "notes.view", "notes.create", "files.view",
      "files.upload", "access_codes.view", "jobs.view_assigned", "jobs.complete", "schedule.view",
      "pricebook.view", "inventory.view", "inventory.consume", "tasks.view", "quotes.create", "quotes.view",
    ],
  },
  {
    key: "INSTALLER",
    name: "Installer",
    description: "Installation crew member with field access.",
    permissions: [
      "customers.view", "equipment.view", "equipment.manage", "notes.view", "notes.create", "files.view",
      "files.upload", "access_codes.view", "jobs.view_assigned", "jobs.complete", "schedule.view",
      "inventory.view", "inventory.consume", "tasks.view",
    ],
  },
  {
    key: "ACCOUNTING",
    name: "Accounting",
    description: "Invoices, payments, expenses and financial reporting.",
    permissions: [
      "customers.view", "customers.export", "jobs.view", "quotes.view", "invoices.view", "invoices.create",
      "invoices.edit", "invoices.send", "invoices.void", "payments.view", "payments.record", "payments.void",
      "expenses.view", "expenses.manage", "financials.view", "reports.view", "reports.export", "pricebook.view",
      "pricebook.view_costs", "notes.view", "notes.create", "files.view", "files.upload", "maintenance.view",
      "inventory.view", "tasks.view", "tasks.manage",
    ],
  },
  {
    key: "READ_ONLY",
    name: "Read Only",
    description: "Can view records but not change anything.",
    permissions: [...READ_ONLY],
  },
];

export const SYSTEM_ROLE_KEYS = SYSTEM_ROLES.map((r) => r.key);
