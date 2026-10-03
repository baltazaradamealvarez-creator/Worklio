/**
 * Development seed: a platform admin and two independent demo companies.
 *
 *   npm run db:reset      # drop, migrate, seed
 *
 * Everything is created through the same domain services the app uses (numbering, activity,
 * audit, isolation), then history is back-dated so dashboards and reports have realistic data.
 */
import "dotenv/config";
import { addDays, subDays } from "date-fns";
import { loadTenantContext, type Ctx } from "@/server/auth/context";
import { hashPassword } from "@/server/auth/password";
import { platformDb } from "@/server/db";
import { ensureDefaultPlans, provisionTenant } from "@/server/domain/tenants";
import { createCustomer, addLocation, saveContact } from "@/server/domain/customers";
import { createEquipment } from "@/server/domain/equipment";
import { savePricebookItem, listCategories } from "@/server/domain/pricebook";
import { createJob, addJobLineItem } from "@/server/domain/jobs";
import { scheduleAppointment, dispatchAppointment } from "@/server/domain/scheduling";
import { fieldAction, completeJob } from "@/server/domain/field";
import { createQuote, sendQuote, recordQuoteDecision, convertQuote, respondToPublicQuote } from "@/server/domain/quotes";
import { createInvoice, createInvoiceFromJob, markInvoiceOpen, sendInvoice } from "@/server/domain/invoices";
import { recordPayment } from "@/server/domain/payments";
import { addNote } from "@/server/domain/notes";
import { createLead, setLeadStatus } from "@/server/domain/leads";
import { createTask } from "@/server/domain/tasks";
import { saveExpense } from "@/server/domain/expenses";
import { adjustStock, saveInventoryItem, saveInventoryLocation, saveVendor } from "@/server/domain/inventory";
import { createAgreement } from "@/server/domain/maintenance";
import { updateCompany, updateBranding, updateFinancial, updateOperations, completeOnboarding } from "@/server/domain/settings";
import { setAvailability, addCertification, updateEmployee } from "@/server/domain/employees";
import { uploadAttachment } from "@/server/domain/attachments";
import { renderPdf } from "@/server/pdf/render";
import { setEmailProvider } from "@/server/email/provider";
import { hashToken } from "@/server/security/tokens";

const ADMIN_EMAIL = "admin@worklio.example";
const ADMIN_PASSWORD = "WorklioAdmin!2026";
const DEMO_PASSWORD = "ComfortDemo!2026";

// Emails go nowhere in the seed.
setEmailProvider({ name: "seed", async send() { return { id: "seed" }; } });

const db = platformDb();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const ago = (days: number, hour = 15) => { const d = subDays(today, days); d.setUTCHours(hour, 0, 0, 0); return d; };
const at = (days: number, hour: number, minute = 0) => { const d = addDays(today, days); d.setUTCHours(hour + 5, minute, 0, 0); return d; }; // hour in America/Chicago (CDT ≈ UTC-5)

async function makeUser(tenantId: string, roleKey: string, name: string, email: string, extra: { title?: string; technician?: boolean; color?: string; phone?: string; skills?: string[]; hireYears?: number; login?: boolean } = {}) {
  const role = await db.role.findFirstOrThrow({ where: { tenantId, key: roleKey } });
  const [first, ...rest] = name.split(" ");
  let membershipId: string | null = null;
  if (extra.login !== false) {
    const user = await db.user.create({ data: { email, name, passwordHash: await hashPassword(DEMO_PASSWORD), emailVerifiedAt: new Date() } });
    membershipId = (await db.membership.create({ data: { tenantId, userId: user.id, roleId: role.id } })).id;
  }
  const existing = membershipId ? await db.employee.findFirst({ where: { tenantId, membershipId } }) : null;
  const data = { firstName: first!, lastName: rest.join(" "), email, phone: extra.phone ?? null, jobTitle: extra.title ?? role.name, isTechnician: extra.technician ?? false, calendarColor: extra.color ?? "#2563eb", skills: extra.skills ?? [], hireDate: subDays(today, 365 * (extra.hireYears ?? 2)), status: "ACTIVE" as const, membershipId };
  const emp = existing ? await db.employee.update({ where: { id: existing.id }, data }) : await db.employee.create({ data: { tenantId, ...data } });
  return { empId: emp.id, membershipId };
}

async function ctxFor(tenantId: string, email: string): Promise<Ctx> {
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  return (await loadTenantContext(u.id, tenantId))!;
}

async function backdateActivities(tenantId: string, entityId: string, when: Date) {
  await db.activity.updateMany({ where: { tenantId, entityId }, data: { createdAt: when } });
}

async function main() {
  console.log("Seeding…");
  await ensureDefaultPlans();
  const adminUser = await db.user.upsert({ where: { email: ADMIN_EMAIL }, update: {}, create: { email: ADMIN_EMAIL, name: "Platform Admin", passwordHash: await hashPassword(ADMIN_PASSWORD), isPlatformAdmin: true, emailVerifiedAt: new Date() } });
  const admin = { userId: adminUser.id, name: adminUser.name };

  await seedComfortAir(admin);
  await seedArctic(admin);

  console.log("\nSeed complete.\n");
  console.log("  Platform admin : %s / %s   (open /platform)", ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log("  Comfort Air    : maria@comfortair.example (owner) · priya@… (office manager) · tom@… (dispatcher)");
  console.log("                   jordan@… (sales) · helen@… (accounting) · carlos@… dana@… mike@… (technicians)");
  console.log("  Arctic Breeze  : owner@arcticbreeze.example   (second tenant, for isolation checks)");
  console.log("  Password       : %s  (all demo company users)\n", DEMO_PASSWORD);
}

// ─────────────────────────────────────────────────────────────────────────────────────

async function seedComfortAir(admin: { userId: string; name: string }) {
  const { tenantId } = await provisionTenant(admin, { companyName: "Comfort Air Heating & Cooling", ownerName: "Maria Delgado", ownerEmail: "maria@comfortair.example", planKey: "professional", trialDays: 0 }, { sendInvite: false });
  await db.invitation.updateMany({ where: { tenantId }, data: { acceptedAt: new Date() } });
  const maria = await makeUser(tenantId, "OWNER", "Maria Delgado", "maria@comfortair.example", { title: "Owner", phone: "2145550110", hireYears: 9 });
  await makeUser(tenantId, "OFFICE_MANAGER", "Priya Nair", "priya@comfortair.example", { title: "Office Manager", phone: "2145550111", hireYears: 5 });
  await makeUser(tenantId, "DISPATCHER", "Tom Becker", "tom@comfortair.example", { title: "Dispatcher", phone: "2145550112", hireYears: 3 });
  const jordan = await makeUser(tenantId, "SALES", "Jordan Lee", "jordan@comfortair.example", { title: "Comfort Advisor", phone: "2145550113", hireYears: 2 });
  await makeUser(tenantId, "ACCOUNTING", "Helen Ortiz", "helen@comfortair.example", { title: "Bookkeeper", phone: "2145550114", hireYears: 4 });
  const carlos = await makeUser(tenantId, "TECHNICIAN", "Carlos Ruiz", "carlos@comfortair.example", { title: "Senior Service Technician", technician: true, color: "#2563eb", phone: "2145550121", skills: ["Residential HVAC", "Heat pumps", "EPA 608 Universal"], hireYears: 6 });
  const dana = await makeUser(tenantId, "TECHNICIAN", "Dana Whitfield", "dana@comfortair.example", { title: "Installation Lead", technician: true, color: "#059669", phone: "2145550122", skills: ["System installs", "Ductwork", "Mini splits"], hireYears: 4 });
  const mike = await makeUser(tenantId, "TECHNICIAN", "Mike Okafor", "mike@comfortair.example", { title: "Service Technician", technician: true, color: "#d97706", phone: "2145550123", skills: ["Commercial RTU", "Boilers", "Controls"], hireYears: 3 });
  const sam = await makeUser(tenantId, "TECHNICIAN", "Sam Patel", "sam.patel@comfortair.example", { title: "Apprentice Technician", technician: true, color: "#7c3aed", phone: "2145550124", skills: ["Maintenance"], hireYears: 1, login: false });

  const owner = await ctxFor(tenantId, "maria@comfortair.example");
  const priya = await ctxFor(tenantId, "priya@comfortair.example");
  const tom = await ctxFor(tenantId, "tom@comfortair.example");
  const jordanCtx = await ctxFor(tenantId, "jordan@comfortair.example");
  const helen = await ctxFor(tenantId, "helen@comfortair.example");
  const tCarlos = await ctxFor(tenantId, "carlos@comfortair.example");
  const tDana = await ctxFor(tenantId, "dana@comfortair.example");
  const tMike = await ctxFor(tenantId, "mike@comfortair.example");
  void maria; void sam;

  // ── Company settings ──
  await updateCompany(owner, { name: "Comfort Air Heating & Cooling", legalName: "Comfort Air Heating & Cooling, LLC", addressLine1: "4410 Greenville Ave, Suite 210", city: "Dallas", state: "TX", postalCode: "75206", country: "US", phone: "(214) 555-0100", email: "service@comfortair.example", website: "https://comfortair.example", taxId: "75-1234567", registrationNumber: "TX-0800412", licenseNumber: "TACLA 48211E", timezone: "America/Chicago", currency: "USD", defaultTaxRate: "8.25" });
  await updateBranding(owner, { brandColor: "#0b63ce", quoteIntro: "Thank you for choosing Comfort Air. Below are the options we discussed for your home.", quoteFooter: "All equipment carries a manufacturer's warranty. Labor warranty: 2 years.", invoiceFooter: "Thank you for your business — we appreciate you.", emailSignature: "The Comfort Air Team\n(214) 555-0100" });
  await updateOperations(owner, { businessHours: { mon: { closed: false, open: "07:00", close: "17:00" }, tue: { closed: false, open: "07:00", close: "17:00" }, wed: { closed: false, open: "07:00", close: "17:00" }, thu: { closed: false, open: "07:00", close: "17:00" }, fri: { closed: false, open: "07:00", close: "17:00" }, sat: { closed: false, open: "08:00", close: "13:00" }, sun: { closed: true, open: "00:00", close: "00:00" } }, serviceAreaNotes: "Dallas, Plano, Richardson, Garland, Irving, Mesquite", defaultAppointmentMinutes: "90", jobPrefix: "JOB-", jobStartNumber: "1001", quotePrefix: "Q-", quoteStartNumber: "1001", invoicePrefix: "INV-", invoiceStartNumber: "1001", agreementPrefix: "MA-", agreementStartNumber: "1001" });
  await updateFinancial(owner, { paymentTermsDays: "15", acceptedPaymentMethods: ["CASH", "CHECK", "CREDIT_CARD", "ACH", "FINANCING"], defaultDeposit: "25", quoteExpirationDays: "30", quoteTerms: "Quote valid for 30 days. A 25% deposit is due at approval for equipment orders; balance due on completion. Permit fees, if required, are additional.", invoiceTerms: "Payment due within 15 days. A 1.5% monthly late fee applies to past-due balances.", requireQuoteSignature: false });
  await completeOnboarding(owner);
  for (const [e, h] of [[carlos, 0], [dana, 0], [mike, 0]] as const) {
    await setAvailability(owner, e.empId, { windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 420, endMinute: 1020 })) });
    void h;
  }
  await addCertification(owner, carlos.empId, { name: "EPA 608 Universal", number: "UV-99120", issuer: "ESCO Institute", issuedAt: "2019-04-01" });
  await addCertification(owner, carlos.empId, { name: "NATE Certified — Heat Pump", issuer: "NATE", issuedAt: "2022-06-15", expiresAt: iso(addDays(today, 40)) });
  await addCertification(owner, mike.empId, { name: "EPA 608 Type II", issuer: "ESCO Institute", issuedAt: "2020-02-01" });
  await updateEmployee(owner, dana.empId, { firstName: "Dana", lastName: "Whitfield", email: "dana@comfortair.example", phone: "2145550122", jobTitle: "Installation Lead", isTechnician: true, skills: "System installs, Ductwork, Mini splits", calendarColor: "#059669", status: "ACTIVE", hireDate: iso(subDays(today, 1460)), hourlyCost: "34.00", emergencyContactName: "Rosa Whitfield", emergencyContactPhone: "2145550199", emergencyContactRelationship: "Spouse" });

  // ── Pricebook ──
  const cats = new Map((await listCategories(owner)).map((c) => [c.name, c.id]));
  const items: [string, string, string, string, number, number, boolean, string?][] = [
    ["Diagnostic", "SERVICE", "DX-100", "Diagnostic visit", 20, 89, false, "Includes up to 45 minutes of troubleshooting. Credited toward repair."],
    ["Diagnostic", "SERVICE", "DX-200", "Emergency after-hours diagnostic", 35, 169, false],
    ["Maintenance", "SERVICE", "MT-AC", "Air conditioner tune-up", 28, 129, false],
    ["Maintenance", "SERVICE", "MT-HT", "Furnace tune-up & safety inspection", 28, 129, false],
    ["Maintenance", "SERVICE", "MT-CB", "Heating + cooling tune-up (combo)", 52, 219, false],
    ["Repairs", "LABOR", "LB-HR", "Service labor (per hour)", 48, 135, false],
    ["Repairs", "SERVICE", "RP-DRN", "Condensate drain line clear & treat", 12, 95, false],
    ["Parts", "MATERIAL", "PT-CAP45", "Dual run capacitor 45/5 µF", 18, 145, true],
    ["Parts", "MATERIAL", "PT-CON30", "Contactor 30A 2-pole", 14, 129, true],
    ["Parts", "MATERIAL", "PT-IGN", "Hot surface igniter", 22, 189, true],
    ["Parts", "MATERIAL", "PT-BLW", "ECM blower motor 1 HP", 310, 889, true],
    ["Parts", "MATERIAL", "PT-FLT", "MERV 11 filter 16x25x1", 6, 24, true],
    ["Parts", "MATERIAL", "RF-410A", "R-410A refrigerant (per lb)", 31, 85, true],
    ["Equipment", "EQUIPMENT", "EQ-AC14-3", "3-ton 14 SEER air conditioner (condenser + coil)", 2150, 3900, true],
    ["Equipment", "EQUIPMENT", "EQ-AC16-3", "3-ton 16 SEER air conditioner (condenser + coil)", 2900, 4800, true],
    ["Equipment", "EQUIPMENT", "EQ-AC18-3", "3-ton 18 SEER variable-speed system", 4100, 6900, true],
    ["Equipment", "EQUIPMENT", "EQ-FN80", "80% AFUE 80k BTU gas furnace", 1480, 2900, true],
    ["Equipment", "EQUIPMENT", "EQ-FN96", "96% AFUE 80k BTU 2-stage gas furnace", 2300, 4200, true],
    ["Equipment", "EQUIPMENT", "EQ-HP3", "3-ton heat pump system", 3300, 5600, true],
    ["Equipment", "EQUIPMENT", "EQ-MS12", "12k BTU ductless mini split", 980, 2400, true],
    ["Equipment", "EQUIPMENT", "EQ-TSTAT", "Smart thermostat (installed)", 120, 320, true],
    ["Installations", "LABOR", "IN-STD", "Standard replacement installation labor", 780, 1850, false],
    ["Installations", "SERVICE", "IN-PERMIT", "Permit & inspection coordination", 40, 175, false],
    ["Service Agreements", "SERVICE", "SA-GOLD", "Gold Comfort Plan (annual)", 90, 299, false],
    ["Discounts", "DISCOUNT", "DS-LOYAL", "Loyalty discount", 0, -50, false],
  ];
  const pb: Record<string, string> = {};
  for (const [cat, kind, sku, name, cost, price, taxable, desc] of items) {
    const it = await savePricebookItem(owner, null, { categoryId: cats.get(cat), kind, sku, name, description: desc, cost: String(cost), price: String(price), taxable: taxable ? "on" : "", unit: kind === "LABOR" ? "hr" : "each" });
    pb[sku] = it.id;
  }
  const line = (sku: string, name: string, price: number, qty = "1", taxable = true) => ({ pricebookItemId: pb[sku], name, quantity: qty, unitPrice: price * 100, taxable });

  // ── Vendors, inventory ──
  for (const v of [["Ferguson HVAC Supply", "Dallas branch · acct 88421"], ["Johnstone Supply", "Garland branch"], ["Carrier Enterprise", "Equipment orders"], ["Grainger", "Tools & safety"], ["Shell Fleet Fuel", "Fuel cards"]] as const) await saveVendor(owner, null, { name: v[0], notes: v[1], contactName: "Counter sales", phone: "2145550177" });
  const vendors = new Map((await db.vendor.findMany({ where: { tenantId } })).map((v) => [v.name, v.id]));
  await saveInventoryLocation(owner, null, { name: "Main warehouse", type: "WAREHOUSE" });
  for (const [t, e, n] of [[carlos, "Carlos", "Truck 12 — Carlos"], [dana, "Dana", "Truck 14 — Dana"], [mike, "Mike", "Truck 15 — Mike"]] as const) { void e; await saveInventoryLocation(owner, null, { name: n, type: "TRUCK", employeeId: t.empId }); }
  const locs = new Map((await db.inventoryLocation.findMany({ where: { tenantId } })).map((l) => [l.name, l.id]));
  const stock: [string, string, string, number, number, number, number, number][] = [
    ["CAP-45-5", "Dual run capacitor 45/5 µF", "Ferguson HVAC Supply", 18, 145, 6, 24, 6], ["CON-30-2", "Contactor 30A 2-pole", "Ferguson HVAC Supply", 14, 129, 4, 14, 4],
    ["IGN-HSI", "Hot surface igniter", "Johnstone Supply", 22, 189, 3, 9, 3], ["FLT-1625", "MERV 11 filter 16x25x1", "Johnstone Supply", 6, 24, 20, 120, 18],
    ["R410A-25", "R-410A refrigerant (25 lb cylinder)", "Ferguson HVAC Supply", 640, 0, 1, 4, 2], ["MTR-BLW1", "ECM blower motor 1 HP", "Carrier Enterprise", 310, 889, 1, 2, 1],
    ["TSTAT-S1", "Smart thermostat", "Carrier Enterprise", 120, 320, 3, 7, 3], ["TAPE-FOIL", "Foil tape 2.5in", "Grainger", 7, 0, 10, 36, 8],
  ];
  for (const [sku, name, vendor, cost, price, thr, wh, truck] of stock) {
    const item = await saveInventoryItem(owner, null, { sku, name, vendorId: vendors.get(vendor), cost: String(cost), price: String(price), reorderThreshold: String(thr), reorderQuantity: String(thr * 3) });
    await adjustStock(owner, { itemId: item.id, locationId: locs.get("Main warehouse")!, type: "RECEIVE", quantity: String(wh) });
    for (const t of ["Truck 12 — Carlos", "Truck 14 — Dana", "Truck 15 — Mike"]) await adjustStock(owner, { itemId: item.id, locationId: locs.get(t)!, type: "RECEIVE", quantity: String(Math.max(0, Math.round(truck / 3))) });
  }
  // One item deliberately below its reorder point so the low-stock alerts have something real to show.
  const lowItem = await db.inventoryItem.findFirstOrThrow({ where: { tenantId, sku: "MTR-BLW1" } });
  for (const s of await db.inventoryStock.findMany({ where: { tenantId, itemId: lowItem.id } })) await db.inventoryStock.update({ where: { id: s.id }, data: { quantity: s.locationId === locs.get("Main warehouse") ? "1" : "0" } });

  // ── Customers ──
  type Seed = { f?: string; l?: string; co?: string; type?: "RESIDENTIAL" | "COMMERCIAL"; phone: string; email: string; addr: [string, string, string, string]; tags?: string[]; src?: string; status?: string };
  const people: Seed[] = [
    { f: "Hannah", l: "Whitfield", phone: "2145550201", email: "hannah.whitfield@example.com", addr: ["3815 Swiss Ave", "Dallas", "TX", "75204"], tags: ["VIP"], src: "Referral" },
    { f: "Robert", l: "Okonkwo", phone: "2145550202", email: "r.okonkwo@example.com", addr: ["1220 Preston Hollow Dr", "Dallas", "TX", "75230"], src: "Google" },
    { f: "Linda", l: "Castillo", phone: "2145550203", email: "linda.castillo@example.com", addr: ["702 Maple Ridge Ln", "Richardson", "TX", "75080"], tags: ["Senior"], src: "Yard sign" },
    { f: "Priya", l: "Raman", phone: "2145550204", email: "priya.raman@example.com", addr: ["5560 Belmont Ave", "Dallas", "TX", "75206"], src: "Nextdoor" },
    { f: "James", l: "Thornton", phone: "2145550205", email: "jthornton@example.com", addr: ["9108 Garland Rd", "Dallas", "TX", "75218"], src: "Google" },
    { f: "Sofia", l: "Marquez", phone: "2145550206", email: "sofia.marquez@example.com", addr: ["421 Edgewood Trl", "Garland", "TX", "75042"], tags: ["Maintenance plan"], src: "Referral" },
    { f: "Derek", l: "Holloway", phone: "2145550207", email: "derek.h@example.com", addr: ["2704 Oak Lawn Ave", "Dallas", "TX", "75219"], src: "Facebook" },
    { f: "Aisha", l: "Bell", phone: "2145550208", email: "aisha.bell@example.com", addr: ["1611 Mockingbird Ln", "Dallas", "TX", "75235"], src: "Google" },
    { f: "Walter", l: "Kessler", phone: "2145550209", email: "wkessler@example.com", addr: ["6012 Lakewood Blvd", "Dallas", "TX", "75214"], tags: ["Senior", "Maintenance plan"], src: "Referral" },
    { f: "Naomi", l: "Fitzgerald", phone: "2145550210", email: "naomi.fitz@example.com", addr: ["338 Lawther Dr", "Dallas", "TX", "75218"], src: "Yelp" },
    { f: "Tyler", l: "Brandt", phone: "2145550211", email: "tyler.brandt@example.com", addr: ["1904 Vickery Blvd", "Dallas", "TX", "75206"], src: "Google" },
    { f: "Elena", l: "Petrova", phone: "2145550212", email: "elena.p@example.com", addr: ["4803 Junius St", "Dallas", "TX", "75214"], tags: ["VIP"], src: "Referral" },
    { f: "Marcus", l: "Greene", phone: "2145550213", email: "marcus.greene@example.com", addr: ["2250 Abrams Rd", "Dallas", "TX", "75214"], src: "Google" },
    { co: "Lone Star Dental Group", type: "COMMERCIAL", phone: "2145550301", email: "facilities@lonestardental.example", addr: ["8222 Douglas Ave, Suite 100", "Dallas", "TX", "75225"], tags: ["Commercial", "Maintenance plan"], src: "Referral" },
    { co: "Oak Cliff Bakery", type: "COMMERCIAL", phone: "2145550302", email: "owner@oakcliffbakery.example", addr: ["410 W Jefferson Blvd", "Dallas", "TX", "75208"], tags: ["Commercial"], src: "Walk-in" },
    { co: "Trinity Property Partners", type: "COMMERCIAL", phone: "2145550303", email: "ops@trinityproperty.example", addr: ["1700 Pacific Ave, Floor 12", "Dallas", "TX", "75201"], tags: ["Commercial", "Landlord"], src: "Referral" },
  ];
  const cust: Record<string, { id: string; loc: string; name: string }> = {};
  for (const p of people) {
    const name = p.co ?? `${p.f} ${p.l}`;
    const c = await createCustomer(priya, { customer: { type: p.type ?? "RESIDENTIAL", firstName: p.f, lastName: p.l, companyName: p.co, phone: p.phone, email: p.email, tags: (p.tags ?? []).join(","), referralSource: p.src, preferredContact: p.co ? "EMAIL" : "PHONE" }, location: { name: p.co ? "Main office" : "Home", addressLine1: p.addr[0], city: p.addr[1], state: p.addr[2], postalCode: p.addr[3] } });
    const loc = await db.customerLocation.findFirstOrThrow({ where: { tenantId, customerId: c.id } });
    cust[name] = { id: c.id, loc: loc.id, name };
    await db.customer.update({ where: { id: c.id }, data: { createdAt: ago(40 + Math.floor(Math.random() * 300)) } });
  }
  await addLocation(priya, cust["Lone Star Dental Group"]!.id, { name: "Plano clinic", addressLine1: "5800 Legacy Dr", city: "Plano", state: "TX", postalCode: "75024", accessCodes: "Suite door 4471#", gateInstructions: "Check in with front desk before roof access", parkingInstructions: "Rear lot, spaces 10–14" });
  await addLocation(priya, cust["Lone Star Dental Group"]!.id, { name: "Irving clinic", addressLine1: "1201 W Airport Fwy", city: "Irving", state: "TX", postalCode: "75062" });
  for (const [n, a] of [["Trinity Lofts", "2100 Main St"], ["Deep Ellum Flats", "2800 Elm St"], ["Bishop Arts Court", "415 N Bishop Ave"]] as const) await addLocation(priya, cust["Trinity Property Partners"]!.id, { name: n, addressLine1: a, city: "Dallas", state: "TX", postalCode: "75226", accessCodes: "Lockbox 8821", onSiteContactName: "Building super" });
  await saveContact(priya, cust["Lone Star Dental Group"]!.id, null, { name: "Dr. Alan Mercer", role: "Practice owner", phone: "2145550311", email: "amercer@lonestardental.example", isPrimary: "on" });
  await saveContact(priya, cust["Lone Star Dental Group"]!.id, null, { name: "Beth Alvarado", role: "Office manager", phone: "2145550312", email: "beth@lonestardental.example", isBilling: "on" });
  await saveContact(priya, cust["Trinity Property Partners"]!.id, null, { name: "Gordon Hale", role: "Property manager", phone: "2145550313", email: "ghale@trinityproperty.example", isPrimary: "on", isBilling: "on" });
  const cid = (n: string) => cust[n]!.id;
  const lid = (n: string) => cust[n]!.loc;

  // ── Equipment ──
  const equipSpec: [string, string, string, string, string, number, string, number, number][] = [
    ["Hannah Whitfield", "AIR_CONDITIONER", "Carrier", "24ACC636A003", "R-410A", 11, "3.0 ton", 14, 3], ["Hannah Whitfield", "FURNACE", "Carrier", "59SC5A080", "", 11, "80k BTU", 96, 3],
    ["Robert Okonkwo", "HEAT_PUMP", "Trane", "4TWR4036G", "R-410A", 4, "3.0 ton", 16, 1], ["Linda Castillo", "AIR_CONDITIONER", "Goodman", "GSX140361", "R-410A", 16, "3.0 ton", 14, 2], ["Linda Castillo", "FURNACE", "Goodman", "GMVC960803", "", 16, "80k BTU", 96, 2],
    ["Priya Raman", "MINI_SPLIT", "Mitsubishi", "MSZ-GL12NA", "R-410A", 2, "1.0 ton", 20, 1], ["James Thornton", "AIR_CONDITIONER", "Lennox", "13ACX-036", "R-410A", 13, "3.0 ton", 13, 1],
    ["Sofia Marquez", "HEAT_PUMP", "Rheem", "RP1436AJ1NA", "R-410A", 7, "3.0 ton", 15, 2], ["Walter Kessler", "FURNACE", "Lennox", "ML180UH070", "", 18, "70k BTU", 80, 1], ["Walter Kessler", "AIR_CONDITIONER", "Lennox", "XC13-036", "R-410A", 18, "3.0 ton", 13, 1],
    ["Naomi Fitzgerald", "AIR_CONDITIONER", "Trane", "TTR436C100A", "R-410A", 9, "3.0 ton", 14, 3], ["Elena Petrova", "HEAT_PUMP", "Carrier", "25HCE436A003", "R-410A", 3, "3.0 ton", 18, 1], ["Elena Petrova", "THERMOSTAT", "Ecobee", "SmartThermostat Premium", "", 3, "", 0, 1],
    ["Lone Star Dental Group", "ROOFTOP_UNIT", "Lennox", "LGH060H4B", "R-410A", 6, "5.0 ton", 14, 1], ["Oak Cliff Bakery", "ROOFTOP_UNIT", "Carrier", "48TCDA06", "R-410A", 10, "5.0 ton", 13, 1], ["Oak Cliff Bakery", "AIR_HANDLER", "Daikin", "DAP0610", "", 12, "", 0, 2],
  ];
  const eq: Record<string, string[]> = {};
  let sn = 4100;
  for (const [cn, type, make, model, ref, age, tons, seer, wy] of equipSpec) {
    const inst = subDays(today, Math.round(age * 365 + 40));
    const e = await createEquipment(priya, {
      customerId: cid(cn), locationId: lid(cn), type, manufacturer: make, model, serialNumber: `${make.slice(0, 2).toUpperCase()}${++sn}${Math.floor(Math.random() * 90000 + 10000)}`, refrigerantType: ref || undefined, capacityTons: /ton/.test(tons) ? tons.split(" ")[0] : undefined, seer: seer ? String(seer) : undefined,
      installDate: iso(inst), manufactureDate: iso(subDays(inst, 60)), equipmentWarrantyExpiresAt: iso(addDays(inst, 365 * 10)), laborWarrantyExpiresAt: iso(addDays(inst, 365 * wy)), warrantyExpiresAt: iso(addDays(inst, 365 * 10)),
      condition: age > 14 ? "FAIR" : age > 9 ? "GOOD" : "EXCELLENT", unitLocation: type === "ROOFTOP_UNIT" ? "Roof" : type === "FURNACE" ? "Attic" : type === "AIR_CONDITIONER" ? "Side yard" : "Garage", filterSize: type === "FURNACE" || type === "AIR_HANDLER" ? "16x25x1" : undefined, fuelType: type === "FURNACE" ? "Natural gas" : "Electric", systemType: type === "AIR_CONDITIONER" ? "Split system" : undefined,
    });
    (eq[cn] ??= []).push(e.id);
  }
  // A unit whose labor warranty ends in 3 weeks (shows in the warranty-expiring filter)
  await db.equipment.update({ where: { id: eq["Robert Okonkwo"]![0]! }, data: { laborWarrantyExpiresAt: addDays(today, 21) } });

  // ── Notes ──
  await addNote(priya, { entityType: "CUSTOMER", entityId: cid("Hannah Whitfield"), type: "WARNING", body: "Two large dogs in the backyard — call ahead and ask the customer to secure them before the technician enters the side gate.", isPinned: "on" });
  await addNote(priya, { entityType: "CUSTOMER", entityId: cid("Linda Castillo"), type: "ACCESS", body: "Lockbox on the garage door, code 2290. Customer is hard of hearing — please knock firmly.", isPinned: "on" });
  await addNote(tom, { entityType: "CUSTOMER", entityId: cid("Walter Kessler"), type: "CUSTOMER_SERVICE", body: "Prefers morning appointments. Always has coffee ready; his late wife's thermostat settings are sentimental — don't reprogram without asking." });
  await addNote(helen, { entityType: "CUSTOMER", entityId: cid("Trinity Property Partners"), type: "BILLING", body: "Net-45 terms agreed verbally with Gordon. Bill all four properties on one statement." });
  await addNote(jordan.empId ? jordanCtx : jordanCtx, { entityType: "CUSTOMER", entityId: cid("Elena Petrova"), type: "SALES", body: "Interested in a whole-home air purifier add-on next spring. Follow up in March.", isPrivate: "on" });
  await addNote(owner, { entityType: "LOCATION", entityId: lid("Oak Cliff Bakery"), type: "ACCESS", body: "Roof hatch is in the back storage room behind the walk-in cooler. Ladder is kept there. Bakery opens at 5 AM — expect flour dust.", isPinned: "on" });

  // ── Leads ──
  const leadSeeds: [string, string, string, string, string, string, number, string?][] = [
    ["Gloria", "Santos", "2145550401", "New system — AC died", "Google", "NEW", 9500, "812 Ridgecrest Rd, Dallas, TX 75224"],
    ["Brian", "Keller", "2145550402", "Replacement estimate, 2-story home", "Referral", "CONTACTED", 14000, "3304 Fairmount St, Dallas, TX 75201"],
    ["Nadia", "Rahman", "2145550403", "Add mini split to sunroom", "Nextdoor", "APPOINTMENT_SCHEDULED", 3600, "7101 Meadow Rd, Dallas, TX 75230"],
    ["Oscar", "Lindgren", "2145550404", "Heat pump quote", "Facebook", "ESTIMATE_NEEDED", 11200, "1500 Skillman St, Dallas, TX 75206"],
    ["Pamela", "Duarte", "2145550405", "Furnace replacement", "Google", "QUOTE_SENT", 6800, "2616 Haskell Ave, Dallas, TX 75204"],
    ["Victor", "Nguyen", "2145550406", "Duct cleaning + tune-up", "Yelp", "LOST", 900, "4140 Bryan St, Dallas, TX 75204"],
  ];
  for (const [f, l, ph, svc, src, st, val, addr] of leadSeeds) {
    const [a1, city, rest] = addr!.split(", ") as [string, string, string];
    const [state, zip] = rest.split(" ") as [string, string];
    const lead = await createLead(jordanCtx, { firstName: f, lastName: l, phone: ph, email: `${f.toLowerCase()}.${l.toLowerCase()}@example.com`, requestedService: svc, source: src, estimatedValue: String(val), addressLine1: a1, city, state, postalCode: zip, assignedToId: jordan.empId });
    if (st !== "NEW") await setLeadStatus(jordanCtx, lead.id, st === "LOST" ? { to: "LOST", lostReason: "Went with a competitor on price" } : { to: st });
    await db.lead.update({ where: { id: lead.id }, data: { createdAt: ago(Math.floor(Math.random() * 20) + 1) } });
  }

  // ── Historical completed work (revenue history) ──
  const techs = [tCarlos, tDana, tMike];
  const history: [string, string, string, number, [string, string, number, string?][]][] = [
    ["Hannah Whitfield", "Service Call", "No cooling — capacitor failure", 118, [["DX-100", "Diagnostic visit", 89], ["PT-CAP45", "Dual run capacitor 45/5 µF", 145], ["LB-HR", "Service labor (per hour)", 135, "1"]]],
    ["Robert Okonkwo", "Maintenance / Tune-up", "Spring tune-up", 104, [["MT-AC", "Air conditioner tune-up", 129]]],
    ["Linda Castillo", "Repair", "Furnace igniter replacement", 97, [["DX-100", "Diagnostic visit", 89], ["PT-IGN", "Hot surface igniter", 189], ["LB-HR", "Service labor (per hour)", 135, "1.5"]]],
    ["Priya Raman", "Maintenance / Tune-up", "Mini split cleaning", 91, [["MT-AC", "Air conditioner tune-up", 129]]],
    ["James Thornton", "Repair", "Condenser fan motor + refrigerant top-off", 85, [["DX-100", "Diagnostic visit", 89], ["RF-410A", "R-410A refrigerant (per lb)", 85, "4"], ["LB-HR", "Service labor (per hour)", 135, "2"]]],
    ["Sofia Marquez", "Maintenance / Tune-up", "Heating + cooling tune-up", 78, [["MT-CB", "Combo tune-up", 219]]],
    ["Lone Star Dental Group", "Repair", "RTU won't cool — contactor & capacitor", 72, [["DX-100", "Diagnostic visit", 89], ["PT-CON30", "Contactor 30A", 129], ["PT-CAP45", "Capacitor", 145], ["LB-HR", "Service labor (per hour)", 135, "2.5"]]],
    ["Naomi Fitzgerald", "Installation", "Replace 14 SEER condenser", 66, [["EQ-AC16-3", "3-ton 16 SEER air conditioner", 4800], ["IN-STD", "Installation labor", 1850], ["IN-PERMIT", "Permit coordination", 175], ["EQ-TSTAT", "Smart thermostat", 320]]],
    ["Walter Kessler", "Maintenance / Tune-up", "Fall furnace tune-up", 60, [["MT-HT", "Furnace tune-up", 129]]],
    ["Oak Cliff Bakery", "Repair", "RTU belt + bearing replacement", 55, [["DX-100", "Diagnostic visit", 89], ["LB-HR", "Service labor (per hour)", 135, "3"], ["PT-FLT", "Filters", 24, "4"]]],
    ["Elena Petrova", "Diagnostic", "Uneven cooling upstairs", 49, [["DX-100", "Diagnostic visit", 89]]],
    ["Marcus Greene", "Repair", "Frozen evaporator coil", 44, [["DX-100", "Diagnostic visit", 89], ["RP-DRN", "Condensate drain clear", 95], ["LB-HR", "Service labor (per hour)", 135, "1"]]],
    ["Tyler Brandt", "Installation", "Furnace replacement (96% AFUE)", 38, [["EQ-FN96", "96% AFUE furnace", 4200], ["IN-STD", "Installation labor", 1850], ["IN-PERMIT", "Permit coordination", 175]]],
    ["Aisha Bell", "Service Call", "No heat — thermostat", 33, [["DX-100", "Diagnostic visit", 89], ["EQ-TSTAT", "Smart thermostat", 320]]],
    ["Trinity Property Partners", "Maintenance / Tune-up", "Fall PM — Trinity Lofts (12 units)", 29, [["MT-AC", "AC tune-up", 129, "12"]]],
    ["Derek Holloway", "Repair", "Blower motor replacement", 24, [["DX-100", "Diagnostic visit", 89], ["PT-BLW", "ECM blower motor 1 HP", 889], ["LB-HR", "Service labor (per hour)", 135, "2"]]],
    ["Hannah Whitfield", "Maintenance / Tune-up", "Fall tune-up", 19, [["MT-CB", "Combo tune-up", 219]]],
    ["Linda Castillo", "Service Call", "Water near furnace", 14, [["DX-100", "Diagnostic visit", 89], ["RP-DRN", "Condensate drain clear", 95]]],
    ["Lone Star Dental Group", "Maintenance / Tune-up", "Quarterly RTU maintenance", 9, [["MT-AC", "RTU maintenance", 129, "2"]]],
    ["Robert Okonkwo", "Repair", "Heat pump defrost board", 6, [["DX-100", "Diagnostic visit", 89], ["LB-HR", "Service labor (per hour)", 135, "2"]]],
  ];
  const jobType = new Map((await db.jobType.findMany({ where: { tenantId } })).map((j) => [j.name, j.id]));
  let n = 0;
  const payMethods = ["CREDIT_CARD", "CHECK", "CREDIT_CARD", "ACH", "CASH", "CREDIT_CARD"] as const;
  for (const [cn, type, title, daysAgo, lines] of history) {
    const tech = techs[n % 3]!;
    const job = await createJob(tom, { customerId: cid(cn), locationId: lid(cn), jobTypeId: jobType.get(type), title, assigneeIds: [tech.employeeId!], equipmentIds: (eq[cn] ?? []).slice(0, 1) });
    for (const [sku, name, price, qty] of lines) await addJobLineItem(owner, job.id, { pricebookItemId: pb[sku], name, quantity: qty ?? "1", unitPrice: price * 100 });
    const start = ago(daysAgo, 14); const end = ago(daysAgo, 16);
    await db.job.update({ where: { id: job.id }, data: { status: "COMPLETED", scheduledStart: start, scheduledEnd: end, actualStart: start, actualEnd: end, createdAt: subDays(start, 2), technicianNotes: "Completed per scope. System tested and running normally. Customer walked through results." } });
    await db.appointment.create({ data: { tenantId, jobId: job.id, status: "COMPLETED", startsAt: start, endsAt: end, startedAt: start, completedAt: end, assignees: { create: [{ employeeId: tech.employeeId!, startsAt: start, endsAt: end }] } } });
    await backdateActivities(tenantId, job.id, end);
    const inv = await createInvoiceFromJob(helen, job.id);
    await db.invoice.update({ where: { id: inv.id }, data: { issueDate: new Date(`${iso(end)}T00:00:00Z`), dueDate: new Date(`${iso(addDays(end, 15))}T00:00:00Z`), createdAt: end } });
    await markInvoiceOpen(helen, inv.id);
    await sendInvoice(helen, inv.id, { to: "customer@example.com" });
    const total = (await db.invoice.findFirstOrThrow({ where: { id: inv.id } })).totalCents;
    // Most paid in full; a few partial / still open; the oldest unpaid ones are past due.
    const mode = n % 9 === 4 ? "open" : n % 9 === 7 ? "partial" : "paid";
    if (mode !== "open") {
      const amount = mode === "paid" ? total : Math.round(total * 0.4);
      const { payment } = await recordPayment(helen, { invoiceId: inv.id, amount: amount, method: payMethods[n % payMethods.length], reference: n % 2 ? `#${4400 + n}` : undefined });
      await db.payment.update({ where: { id: payment.id }, data: { receivedAt: addDays(end, 2 + (n % 6)) } });
    }
    await db.invoice.update({ where: { id: inv.id }, data: { sentAt: end, paidAt: mode === "paid" ? addDays(end, 3) : null } });
    await backdateActivities(tenantId, inv.id, addDays(end, 1));
    n++;
  }

  // ── Today's schedule (live board) ──
  const todayJobs: [string, string, string, typeof tCarlos, number, number, string][] = [
    ["Aisha Bell", "Service Call", "AC blowing warm air", tCarlos, 8, 90, "done"],
    ["Marcus Greene", "Maintenance / Tune-up", "Heating + cooling tune-up", tCarlos, 10, 75, "inprogress"],
    ["Derek Holloway", "Diagnostic", "Thermostat not responding", tCarlos, 13, 60, "scheduled"],
    ["Tyler Brandt", "Installation", "Install 3-ton AC + coil (day 1)", tDana, 8, 480, "enroute"],
    ["Oak Cliff Bakery", "Repair", "Walk-in cooler condenser fan", tMike, 9, 120, "dispatched"],
    ["Lone Star Dental Group", "Maintenance / Tune-up", "Plano clinic RTU preventive maintenance", tMike, 13, 120, "scheduled"],
  ];
  for (const [cn, type, title, tech, hour, mins, state] of todayJobs) {
    const job = await createJob(tom, { customerId: cid(cn), locationId: lid(cn), jobTypeId: jobType.get(type), title, estimatedMinutes: String(mins), description: "Customer reports the issue started this week. Please confirm model/serial and photograph the data plate.", assigneeIds: [tech.employeeId!], equipmentIds: (eq[cn] ?? []).slice(0, 1), priority: title.includes("warm air") ? "HIGH" : "NORMAL" });
    const appt = await scheduleAppointment(tom, job.id, { startsAt: at(0, hour), endsAt: new Date(at(0, hour).getTime() + mins * 60_000), assigneeIds: [tech.employeeId!], force: "on" });
    if (state !== "scheduled") await dispatchAppointment(tom, appt.id);
    if (state === "enroute") await fieldAction(tech, job.id, "travel");
    if (state === "inprogress" || state === "done") { await fieldAction(tech, job.id, "start"); await db.appointment.update({ where: { id: appt.id }, data: { startedAt: new Date(Date.now() - 50 * 60_000) } }); }
    if (state === "done") { await db.jobChecklistItem.updateMany({ where: { jobId: job.id }, data: { isDone: true, doneAt: new Date() } }); await addJobLineItem(tech, job.id, { pricebookItemId: pb["DX-100"] }); await addJobLineItem(tech, job.id, { pricebookItemId: pb["PT-CAP45"] }); await completeJob(tech, job.id, { technicianNotes: "Failed dual-run capacitor replaced. Cooling restored; delta-T 19°F." }); }
  }
  // Upcoming schedule
  const upcoming: [string, string, string, typeof tCarlos, number, number, number][] = [
    ["Hannah Whitfield", "Repair", "Upstairs zone not cooling", tCarlos, 1, 9, 120], ["Priya Raman", "Maintenance / Tune-up", "Mini split seasonal service", tDana, 1, 10, 75], ["Naomi Fitzgerald", "Inspection", "Post-install inspection follow-up", tMike, 1, 14, 45],
    ["Walter Kessler", "Maintenance / Tune-up", "Annual maintenance (plan visit 1 of 2)", tCarlos, 2, 8, 90], ["Trinity Property Partners", "Maintenance / Tune-up", "Spring PM — Deep Ellum Flats", tDana, 3, 8, 240], ["Sofia Marquez", "Diagnostic", "Heat pump short cycling", tMike, 3, 11, 60],
  ];
  for (const [cn, type, title, tech, d, hour, mins] of upcoming) {
    const job = await createJob(tom, { customerId: cid(cn), locationId: lid(cn), jobTypeId: jobType.get(type), title, estimatedMinutes: String(mins), assigneeIds: [tech.employeeId!], equipmentIds: (eq[cn] ?? []).slice(0, 1) });
    await scheduleAppointment(tom, job.id, { startsAt: at(d, hour), assigneeIds: [tech.employeeId!], force: "on" });
  }
  // Unscheduled / on hold / follow-up
  for (const [cn, type, title, prio] of [["Elena Petrova", "Service Call", "Whistling noise from air handler", "NORMAL"], ["James Thornton", "Replacement Estimate", "Estimate — replace 13 SEER system", "NORMAL"], ["Oak Cliff Bakery", "Emergency Service", "Walk-in cooler warm — urgent", "EMERGENCY"]] as const) {
    await createJob(tom, { customerId: cid(cn), locationId: lid(cn), jobTypeId: jobType.get(type), title, priority: prio, equipmentIds: (eq[cn] ?? []).slice(0, 1) });
  }
  const hold = await createJob(tom, { customerId: cid("Linda Castillo"), locationId: lid("Linda Castillo"), jobTypeId: jobType.get("Repair"), title: "Replace blower motor — waiting on part", assigneeIds: [tCarlos.employeeId!] });
  await db.job.update({ where: { id: hold.id }, data: { status: "ON_HOLD", holdReason: "Motor on backorder — ETA Thursday" } });
  const fu = await createJob(tom, { customerId: cid("Robert Okonkwo"), locationId: lid("Robert Okonkwo"), jobTypeId: jobType.get("Repair"), title: "Heat pump reversing valve — follow-up", assigneeIds: [tMike.employeeId!] });
  await db.job.update({ where: { id: fu.id }, data: { status: "NEEDS_FOLLOW_UP", followUpReason: "Reversing valve ordered; return visit to install" } });

  // ── Quotes (Good/Better/Best, every status) ──
  const gbb = (extra: Record<string, unknown> = {}) => ({
    taxRate: "8.25", depositType: "PERCENT", depositValue: 2500,
    options: [
      { name: "Good — 14 SEER", description: "Reliable, budget-friendly replacement.", lines: [line("EQ-AC14-3", "3-ton 14 SEER air conditioner (condenser + coil)", 3900), line("IN-STD", "Standard replacement installation labor", 1850, "1", false), line("IN-PERMIT", "Permit & inspection coordination", 175, "1", false)] },
      { name: "Better — 16 SEER", description: "Our most popular choice: quieter, more efficient.", isRecommended: "on", lines: [line("EQ-AC16-3", "3-ton 16 SEER air conditioner (condenser + coil)", 4800), line("IN-STD", "Standard replacement installation labor", 1850, "1", false), line("IN-PERMIT", "Permit & inspection coordination", 175, "1", false), line("EQ-TSTAT", "Smart thermostat (installed)", 320)] },
      { name: "Best — 18 SEER variable speed", description: "Whole-home comfort with the lowest energy bills.", lines: [line("EQ-AC18-3", "3-ton 18 SEER variable-speed system", 6900), line("IN-STD", "Standard replacement installation labor", 1850, "1", false), line("IN-PERMIT", "Permit & inspection coordination", 175, "1", false), line("EQ-TSTAT", "Smart thermostat (installed)", 320)] },
    ],
    ...extra,
  });
  const mkQuote = async (cn: string, title: string, extra: Record<string, unknown> = {}) => createQuote(jordanCtx, { customerId: cid(cn), locationId: lid(cn), title, issueDate: iso(today), expiresAt: iso(addDays(today, 30)), ...gbb(extra) });
  await mkQuote("Derek Holloway", "Full system replacement");                       // draft
  const qSent = await mkQuote("James Thornton", "Replace aging 13 SEER AC"); await sendQuote(jordanCtx, qSent.id, { to: "jthornton@example.com" });
  const qViewed = await mkQuote("Elena Petrova", "Zoned system upgrade"); const sv = await sendQuote(jordanCtx, qViewed.id, { to: "elena.p@example.com" });
  await (async () => { const { resolvePublicLink, touchPublicLink } = await import("@/server/domain/public-links"); const { recordQuoteView } = await import("@/server/domain/quotes"); const l = (await resolvePublicLink(sv.url.split("/").pop()!, "QUOTE", {}))!; await recordQuoteView(l, {}); void touchPublicLink; })();
  const qApproved = await mkQuote("Tyler Brandt", "AC replacement — approved", { options: [gbb().options[1]] });
  await sendQuote(jordanCtx, qApproved.id, { to: "tyler.brandt@example.com" }); await recordQuoteDecision(owner, qApproved.id, "APPROVED", { optionId: (await db.quoteOption.findFirstOrThrow({ where: { tenantId, quoteId: qApproved.id } })).id });
  const qDeclined = await mkQuote("Marcus Greene", "Heat pump conversion", { options: [{ name: "Heat pump system", lines: [line("EQ-HP3", "3-ton heat pump system", 5600), line("IN-STD", "Installation", 1850, "1", false)] }] });
  const sd = await sendQuote(jordanCtx, qDeclined.id, { to: "marcus.greene@example.com" });
  await respondToPublicQuote(sd.url.split("/").pop()!, { action: "decline", message: "Going with another contractor — thanks." }, {});
  const qConv = await mkQuote("Aisha Bell", "Thermostat & zoning upgrade", { options: [{ name: "Upgrade", lines: [line("EQ-TSTAT", "Smart thermostat (installed)", 320, "2"), line("LB-HR", "Service labor (per hour)", 135, "3", false)] }] });
  await sendQuote(jordanCtx, qConv.id, { to: "aisha.bell@example.com" }); await recordQuoteDecision(owner, qConv.id, "APPROVED", { optionId: (await db.quoteOption.findFirstOrThrow({ where: { tenantId, quoteId: qConv.id } })).id });
  await convertQuote(owner, qConv.id, { to: "job_and_invoice" });
  const qExp = await mkQuote("Naomi Fitzgerald", "Duct sealing & insulation"); await sendQuote(jordanCtx, qExp.id, { to: "naomi.fitz@example.com" });
  await db.quote.update({ where: { id: qExp.id }, data: { expiresAt: ago(6), issueDate: ago(40) } });
  await db.quote.updateMany({ where: { tenantId, id: qSent.id }, data: { sentAt: ago(3) } });

  // ── Open / past-due / draft / void invoices ──
  const mkInv = async (cn: string, title: string, amount: number, issueAgo: number, terms: number, status: "draft" | "open" | "void", paid = 0) => {
    const inv = await createInvoice(helen, { customerId: cid(cn), locationId: lid(cn), title, issueDate: iso(ago(issueAgo)), paymentTermsDays: String(terms), taxRate: "8.25", lines: [{ name: title, quantity: "1", unitPrice: amount * 100 }] });
    if (status !== "draft") await markInvoiceOpen(helen, inv.id);
    if (status === "open") await sendInvoice(helen, inv.id, { to: "billing@example.com" });
    if (paid) await recordPayment(helen, { invoiceId: inv.id, amount: paid * 100, method: "CHECK", reference: "#2201" });
    if (status === "void") { const { voidInvoice } = await import("@/server/domain/invoices"); await voidInvoice(helen, inv.id, "Duplicate of INV for same visit"); }
    await db.invoice.update({ where: { id: inv.id }, data: { createdAt: ago(issueAgo) } });
    return inv;
  };
  await mkInv("Trinity Property Partners", "Spring PM — Bishop Arts Court (8 units)", 1032, 62, 45, "open");           // past due
  await mkInv("Oak Cliff Bakery", "Emergency compressor contactor repair", 684, 38, 15, "open", 200);                 // partial + past due
  await mkInv("Derek Holloway", "Thermostat replacement", 412, 4, 15, "open");                                       // open, not due
  await mkInv("Priya Raman", "Duct sealing — materials deposit", 750, 1, 15, "draft");
  await mkInv("Walter Kessler", "Service call (duplicate)", 89, 20, 15, "void");

  // ── Maintenance agreements ──
  const agr: [string, string, number, number, number][] = [
    ["Walter Kessler", "Gold Comfort Plan", 299, 2, 300], ["Sofia Marquez", "Silver Plan — heat pump", 189, 2, 22], ["Lone Star Dental Group", "Commercial RTU Plan", 1480, 4, 200], ["Linda Castillo", "Silver Plan", 189, 2, -12],
  ];
  for (const [cn, name, price, visits, daysToRenewal] of agr) {
    await createAgreement(owner, { name, customerId: cid(cn), locationId: lid(cn), startDate: iso(addDays(today, daysToRenewal - 365)), renewalDate: iso(addDays(today, daysToRenewal)), price: String(price), includedVisits: String(visits), includedServices: "Seasonal tune-ups, priority scheduling, 15% off repairs, no after-hours fee", discountPercent: "15", billingFrequency: "ANNUAL", equipmentIds: (eq[cn] ?? []).slice(0, 2), autoRenew: cn === "Walter Kessler" ? "on" : "" });
  }

  // ── Tasks ──
  const mk = (t: Parameters<typeof createTask>[1]) => createTask(priya, t);
  await mk({ title: "Follow up on Thornton replacement quote", customerId: cid("James Thornton"), dueAt: at(1, 10).toISOString(), priority: "HIGH", assigneeUserId: jordanCtx.userId });
  await mk({ title: "Call Elena Petrova re: zoned system quote", customerId: cid("Elena Petrova"), dueAt: at(0, 15).toISOString(), assigneeUserId: jordanCtx.userId });
  await mk({ title: "Collect payment — Trinity Bishop Arts invoice", customerId: cid("Trinity Property Partners"), dueAt: ago(2).toISOString(), priority: "HIGH", assigneeUserId: helen.userId });
  await mk({ title: "Order blower motor for Castillo job", customerId: cid("Linda Castillo"), dueAt: at(1, 9).toISOString(), assigneeUserId: tom.userId });
  await mk({ title: "Schedule Tyler Brandt installation (day 2)", customerId: cid("Tyler Brandt"), dueAt: at(2, 9).toISOString(), assigneeUserId: tom.userId });
  await mk({ title: "Renew Linda Castillo's Silver Plan", customerId: cid("Linda Castillo"), dueAt: at(5, 9).toISOString(), assigneeUserId: priya.userId });
  await mk({ title: "Renew NATE certification — Carlos", dueAt: at(20, 9).toISOString(), assigneeUserId: owner.userId });

  // ── Expenses (monthly history) ──
  const exp: [string, string, number, number, string, string][] = [
    ["Ferguson HVAC Supply", "PARTS", 1840, 96, "Monthly parts order", "CREDIT_CARD"], ["Carrier Enterprise", "EQUIPMENT", 2200, 70, "Condenser + coil (Fitzgerald)", "ACH"], ["Shell Fleet Fuel", "FUEL", 912, 64, "Fleet fuel — month", "CREDIT_CARD"],
    ["Ferguson HVAC Supply", "PARTS", 2210, 66, "Parts order", "CREDIT_CARD"], ["Johnstone Supply", "PARTS", 640, 51, "Refrigerant & filters", "CREDIT_CARD"], ["Shell Fleet Fuel", "FUEL", 1004, 34, "Fleet fuel — month", "CREDIT_CARD"],
    ["Carrier Enterprise", "EQUIPMENT", 1800, 41, "96% furnace (Brandt)", "ACH"], ["Grainger", "TOOLS", 489, 28, "Manifold gauges & torque set", "CREDIT_CARD"], ["Ferguson HVAC Supply", "PARTS", 1575, 22, "Parts order", "CREDIT_CARD"],
    ["Shell Fleet Fuel", "FUEL", 987, 5, "Fleet fuel — month", "CREDIT_CARD"], ["Johnstone Supply", "PARTS", 410, 12, "Capacitors & contactors", "CREDIT_CARD"],
  ];
  for (const [v, cat, amt, d, desc, pm] of exp) await saveExpense(helen, null, { vendorId: vendors.get(v), category: cat, amount: String(amt), expenseDate: iso(ago(d)), description: desc, paymentMethod: pm });
  for (const [cat, amt, d, desc] of [["ADVERTISING", 1200, 58, "Google Ads — Local Services"], ["SOFTWARE", 450, 30, "Worklio + phone system"], ["VEHICLE", 380, 18, "Truck 12 oil change & tires"], ["OFFICE", 142, 9, "Printer toner & supplies"], ["SUBCONTRACTORS", 900, 26, "Sheet-metal fabrication — custom plenum"]] as const) await saveExpense(helen, null, { category: cat, amount: String(amt), expenseDate: iso(ago(d)), description: desc });

  // ── Files (real stored objects) ──
  const manual = await renderPdf({ kind: "QUOTE", number: "MANUAL", title: "Carrier 24ACC6 Installation & Owner's Manual (excerpt)", currency: "USD", brand: { name: "Carrier", address: null, phone: null, email: null, website: null, taxId: null, color: "#0b63ce", logo: null }, customer: { name: "Reference document", lines: [] }, meta: [], sections: [], terms: "Reference copy stored with the equipment record for quick access in the field." });
  await uploadAttachment(priya, { name: "Carrier-24ACC6-owners-manual.pdf", size: manual.length, content: manual }, { entityType: "EQUIPMENT", entityId: eq["Hannah Whitfield"]![0]!, kind: "MANUAL" });
  await uploadAttachment(priya, { name: "warranty-registration.pdf", size: manual.length, content: manual }, { entityType: "EQUIPMENT", entityId: eq["Hannah Whitfield"]![0]!, kind: "WARRANTY" });
  await uploadAttachment(priya, { name: "service-agreement-signed.pdf", size: manual.length, content: manual }, { entityType: "CUSTOMER", entityId: cid("Lone Star Dental Group"), kind: "CONTRACT" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADq0Vq0wAAAAASUVORK5CYII=", "base64");
  await uploadAttachment(tDana, { name: "data-plate.png", size: png.length, content: png }, { entityType: "EQUIPMENT", entityId: eq["Robert Okonkwo"]![0]!, kind: "PHOTO" });

  // Spread setup-type activity (agreements, files, equipment) back in time so the live feed reads naturally.
  await db.$executeRaw`UPDATE activities SET "createdAt" = now() - (random() * interval '60 days') WHERE "tenantId" = ${tenantId} AND (type LIKE 'agreement.%' OR type LIKE 'file.%' OR type LIKE 'equipment.%' OR type LIKE 'location.%' OR type LIKE 'contact.%' OR type = 'customer.created' OR type LIKE 'note.%')`;
  // A few notifications from earlier days so the bell has history
  await db.notification.updateMany({ where: { tenantId }, data: { createdAt: ago(0, 12) } });
  void hashToken;
}

async function seedArctic(admin: { userId: string; name: string }) {
  const { tenantId } = await provisionTenant(admin, { companyName: "Arctic Breeze HVAC", ownerName: "Frank Dolan", ownerEmail: "owner@arcticbreeze.example", planKey: "starter", trialDays: 14 }, { sendInvite: false });
  await db.invitation.updateMany({ where: { tenantId }, data: { acceptedAt: new Date() } });
  await makeUser(tenantId, "OWNER", "Frank Dolan", "owner@arcticbreeze.example", { title: "Owner" });
  const o = await ctxFor(tenantId, "owner@arcticbreeze.example");
  for (const [f, l, ph] of [["Kevin", "Marsh", "9725550101"], ["Julia", "Stone", "9725550102"]] as const) await createCustomer(o, { customer: { firstName: f, lastName: l, phone: ph, email: `${f.toLowerCase()}@example.com` }, location: { name: "Home", addressLine1: "100 Frost Rd", city: "Frisco", state: "TX", postalCode: "75034" } });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
