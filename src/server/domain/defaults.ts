/** HVAC defaults installed into every new tenant. Everything here is editable by the company. */

export const DEFAULT_JOB_TYPES = [
  { name: "Service Call", defaultDurationMin: 90, color: "#2563eb" },
  { name: "Diagnostic", defaultDurationMin: 60, color: "#7c3aed" },
  { name: "Maintenance / Tune-up", defaultDurationMin: 75, color: "#059669" },
  { name: "Repair", defaultDurationMin: 120, color: "#d97706" },
  { name: "Installation", defaultDurationMin: 480, color: "#0891b2" },
  { name: "Replacement Estimate", defaultDurationMin: 60, color: "#db2777" },
  { name: "Inspection", defaultDurationMin: 45, color: "#4b5563" },
  { name: "Emergency Service", defaultDurationMin: 120, color: "#dc2626" },
] as const;

export const DEFAULT_PRICEBOOK_CATEGORIES = [
  { name: "Diagnostic", kind: "SERVICE" },
  { name: "Maintenance", kind: "SERVICE" },
  { name: "Repairs", kind: "SERVICE" },
  { name: "Installations", kind: "SERVICE" },
  { name: "Equipment", kind: "EQUIPMENT" },
  { name: "Parts", kind: "MATERIAL" },
  { name: "Labor", kind: "LABOR" },
  { name: "Service Agreements", kind: "SERVICE" },
  { name: "Discounts", kind: "DISCOUNT" },
  { name: "Miscellaneous", kind: "OTHER" },
] as const;

export const DEFAULT_CHECKLISTS: { jobType: string; name: string; items: string[] }[] = [
  {
    jobType: "Maintenance / Tune-up",
    name: "Seasonal tune-up",
    items: [
      "Inspect and replace air filter",
      "Check thermostat operation and calibration",
      "Inspect electrical connections and measure amp draw",
      "Check refrigerant pressures / charge",
      "Clean condenser coil and check condensate drain",
      "Inspect burners, heat exchanger and flue",
      "Check safety controls and carbon monoxide",
      "Record supply/return temperature split",
    ],
  },
  {
    jobType: "Installation",
    name: "System installation",
    items: [
      "Verify equipment matches approved quote",
      "Protect floors and work area",
      "Set equipment and complete line set / ductwork",
      "Pressure test and evacuate system",
      "Startup and commissioning checks",
      "Register warranty and record serial numbers",
      "Review operation with customer",
    ],
  },
  {
    jobType: "Diagnostic",
    name: "Diagnostic visit",
    items: ["Verify customer complaint", "Check thermostat and power", "Perform system test", "Document findings and photos", "Present repair options"],
  },
];

export const DEFAULT_PLANS = [
  { key: "starter", name: "Starter", description: "Small crews getting organised.", priceMonthlyCents: 9900, maxUsers: 5, maxTechnicians: 3, maxCustomers: 1000, maxStorageMb: 5120 },
  { key: "professional", name: "Professional", description: "Growing service companies.", priceMonthlyCents: 29900, maxUsers: 25, maxTechnicians: 15, maxCustomers: 25000, maxStorageMb: 51200 },
  { key: "enterprise", name: "Enterprise", description: "Multi-branch operators.", priceMonthlyCents: 79900, maxUsers: 250, maxTechnicians: 150, maxCustomers: 500000, maxStorageMb: 512000 },
] as const;
