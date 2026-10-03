import type { Permission } from "@/server/auth/permissions";

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  /** shown when the user holds ANY of these */
  any: Permission[];
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { items: [{ label: "Dashboard", href: "/dashboard", icon: "layout-dashboard", any: [] }] },
  {
    label: "CRM",
    items: [
      { label: "Customers", href: "/customers", icon: "users", any: ["customers.view"] },
      { label: "Leads", href: "/leads", icon: "funnel", any: ["leads.view"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Schedule", href: "/schedule", icon: "calendar-days", any: ["schedule.view"] },
      { label: "Dispatch", href: "/dispatch", icon: "radio-tower", any: ["schedule.manage"] },
      { label: "Jobs", href: "/jobs", icon: "clipboard-list", any: ["jobs.view", "jobs.view_assigned"] },
      { label: "Tasks", href: "/tasks", icon: "list-checks", any: ["tasks.view"] },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Quotes", href: "/quotes", icon: "file-text", any: ["quotes.view"] },
      { label: "Pricebook", href: "/pricebook", icon: "book-open", any: ["pricebook.view"] },
    ],
  },
  {
    label: "Billing",
    items: [
      { label: "Invoices", href: "/invoices", icon: "receipt", any: ["invoices.view"] },
      { label: "Payments", href: "/payments", icon: "banknote", any: ["payments.view"] },
    ],
  },
  {
    label: "Service",
    items: [
      { label: "Equipment", href: "/equipment", icon: "fan", any: ["equipment.view"] },
      { label: "Maintenance plans", href: "/maintenance", icon: "shield-check", any: ["maintenance.view"] },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Inventory", href: "/inventory", icon: "package", any: ["inventory.view"] },
      { label: "Vendors", href: "/inventory/vendors", icon: "truck", any: ["inventory.view"] },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Expenses", href: "/expenses", icon: "wallet", any: ["expenses.view"] },
      { label: "Financial overview", href: "/finance", icon: "line-chart", any: ["financials.view"] },
      { label: "Reports", href: "/reports", icon: "bar-chart-3", any: ["reports.view", "financials.view"] },
    ],
  },
  {
    label: "Company",
    items: [
      { label: "Employees", href: "/employees", icon: "id-card", any: ["employees.view"] },
      { label: "Activity", href: "/activity", icon: "history", any: ["audit.view"] },
      { label: "Settings", href: "/settings", icon: "settings", any: ["settings.manage", "users.manage", "roles.manage", "pricebook.manage"] },
    ],
  },
];
