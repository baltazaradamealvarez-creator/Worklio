"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";

type Fmt = "text" | "money" | "number" | "percent" | "date";
export interface ChartSpec { kind: "bar" | "line" | "area" | "pie" | "stacked"; xKey: string; horizontal?: boolean; series: { key: string; label: string; format: Fmt }[] }

const COLORS = ["#2563eb", "#0d9488", "#f59e0b", "#7c3aed", "#e11d48", "#0891b2", "#65a30d", "#db2777"];
const fmt = (v: unknown, f: Fmt, currency: string, compact = false) => (f === "money" ? formatMoney(Number(v), currency, { compact }) : f === "percent" ? `${(Number(v) * 100).toFixed(1)}%` : Number(v).toLocaleString());

export function ReportChart({ spec, data, currency }: { spec: ChartSpec; data: Record<string, string | number | null>[]; currency: string }) {
  const rows = data.slice(0, spec.kind === "pie" ? 12 : 40);
  const first = spec.series[0]!;
  if (rows.length === 0) return null;
  if (spec.kind === "pie") {
    return (
      <div className="h-72" role="img" aria-label={`${first.label} by ${spec.xKey}`}>
        <ResponsiveContainer><PieChart>
          <Pie data={rows} dataKey={first.key} nameKey={spec.xKey} innerRadius={55} outerRadius={95} paddingAngle={1}>{rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie>
          <Tooltip formatter={(v) => fmt(v, first.format, currency)} /><Legend />
        </PieChart></ResponsiveContainer>
      </div>
    );
  }
  const horizontal = spec.horizontal;
  return (
    <div className="h-72" role="img" aria-label={spec.series.map((s) => s.label).join(", ")}>
      <ResponsiveContainer>
        <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: horizontal ? 40 : 0, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={!horizontal} horizontal={!!horizontal ? false : true} />
          {horizontal ? <><XAxis type="number" tickFormatter={(v) => fmt(v, first.format, currency, true)} fontSize={11} /><YAxis type="category" dataKey={spec.xKey} width={120} fontSize={11} /></> : <><XAxis dataKey={spec.xKey} fontSize={11} interval="preserveStartEnd" /><YAxis tickFormatter={(v) => fmt(v, first.format, currency, true)} fontSize={11} width={56} /></>}
          <Tooltip formatter={(v, name) => fmt(v, spec.series.find((s) => s.label === name)?.format ?? first.format, currency)} cursor={{ fill: "var(--surface-2)" }} />
          {spec.series.length > 1 && <Legend />}
          {spec.series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} stackId={spec.kind === "stacked" ? "a" : undefined} radius={spec.kind === "stacked" ? 0 : [3, 3, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
