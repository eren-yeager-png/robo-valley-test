"use client";

// The only file that imports Recharts. It is loaded on demand by ChartsLoader so the library is never part of the
// normal page bundle. Data comes from the server as plain numbers; this file only draws it.
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ChartSeries = { key: string; label: string; color: string };
export type ChartProps = {
  kind: "line" | "bar";
  data: Record<string, string | number>[];
  xKey: string;
  series: ChartSeries[];
  label: string;
  /** Rotate / shorten x labels for long names (category names). */
  angled?: boolean;
};

const AXIS = { fontSize: 12, fill: "currentColor" } as const;

export default function Chart({ kind, data, xKey, series, label, angled }: ChartProps) {
  const total = data.reduce((n, d) => n + series.reduce((m, s) => m + Number(d[s.key] ?? 0), 0), 0);
  if (total === 0) return <div className="adm-note empty" role="status">No activity in this period yet.</div>;
  const common = { data, margin: { top: 8, right: 12, bottom: angled ? 40 : 4, left: -12 } };
  return (
    <div className="adm-chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 280 }}>
        {kind === "line" ? (
          <LineChart {...common}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey={xKey} tick={AXIS} tickFormatter={(v) => String(v).slice(5)} minTickGap={24} />
            <YAxis allowDecimals={false} tick={AXIS} />
            <Tooltip />
            {series.length > 1 && <Legend />}
            {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />)}
          </LineChart>
        ) : (
          <BarChart {...common}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey={xKey} tick={AXIS} interval={0} angle={angled ? -30 : 0} textAnchor={angled ? "end" : "middle"} tickFormatter={angled ? undefined : (v) => String(v).slice(5)} minTickGap={angled ? 0 : 24} />
            <YAxis allowDecimals={false} tick={AXIS} />
            <Tooltip />
            {series.length > 1 && <Legend />}
            {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} />)}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
