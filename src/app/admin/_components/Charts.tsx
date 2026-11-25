"use client";

// The only file that imports Recharts. It is loaded on demand by ChartsLoader so the library is never part of the
// normal page bundle. Data comes from the server as plain numbers; this file only draws it.
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, DAY_AXIS, MAX_BAR, NAME_AXIS } from "./chartAxis";

export type ChartSeries = { key: string; label: string; color: string };
export type ChartProps = {
  kind: "line" | "bar";
  data: Record<string, string | number>[];
  xKey: string;
  series: ChartSeries[];
  label: string;
  /** The x values are names (categories, roles), not days: print every one, at an angle. */
  angled?: boolean;
  /** One bar per day, the series on top of each other. Only for parts of one whole (accepted + rejected uploads). */
  stacked?: boolean;
};

// The axis shows MM-DD; the tooltip shows the whole date (YYYY-MM-DD), or the whole name.
const fullLabel = (v: React.ReactNode) => String(v);

export default function Chart({ kind, data, xKey, series, label, angled, stacked }: ChartProps) {
  const total = data.reduce((n, d) => n + series.reduce((m, s) => m + Number(d[s.key] ?? 0), 0), 0);
  if (total === 0) return <div className="adm-note empty" role="status">No activity in this period yet.</div>;
  const common = { data, margin: { top: 8, right: 20, bottom: angled ? 40 : 4, left: -12 } };
  return (
    <div className="adm-chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 280 }}>
        {kind === "line" ? (
          <LineChart {...common}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey={xKey} {...DAY_AXIS} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} />
            <Tooltip labelFormatter={fullLabel} />
            {series.length > 1 && <Legend />}
            {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />)}
          </LineChart>
        ) : (
          <BarChart {...common} barCategoryGap="12%" barGap={0}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey={xKey} {...(angled ? NAME_AXIS : DAY_AXIS)} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} />
            <Tooltip labelFormatter={fullLabel} />
            {series.length > 1 && <Legend />}
            {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={MAX_BAR} stackId={stacked ? "all" : undefined} radius={stacked ? 2 : [4, 4, 0, 0]} />)}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
