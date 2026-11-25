// @vitest-environment jsdom
// The real chart component (Recharts) in a browser-like environment.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import Chart from "../src/app/admin/_components/Charts";
import { DAY_AXIS, MAX_BAR, NAME_AXIS, shortDay } from "../src/app/admin/_components/chartAxis";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const data = [{ day: "2025-01-01", n: 2 }, { day: "2025-01-02", n: 0 }];

describe("Charts", () => {
  it("draws a labelled chart when there is data", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const kind of ["line", "bar"] as const) {
      render(<Chart kind={kind} data={data} xKey="day" series={[{ key: "n", label: "Things", color: "#0d7f81" }]} label={`${kind} chart of things`} />);
      expect(screen.getByRole("img", { name: `${kind} chart of things` })).toBeTruthy();
      cleanup();
    }
  });

  it("says so, instead of drawing an empty chart, when every value is zero", () => {
    render(<Chart kind="line" data={[{ day: "2025-01-01", n: 0 }]} xKey="day" series={[{ key: "n", label: "Things", color: "#000" }]} label="empty chart" />);
    expect(screen.getByRole("status").textContent).toContain("No activity in this period yet.");
    expect(screen.queryByRole("img")).toBeNull();
  });
});

// A1: the Uploads chart printed a label for every day, and they ran into each other. (That the labels do not touch at any width is
// measured in a real browser; jsdom has no text widths.)
describe("the x-axis", () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 7, 28 + i)).toISOString().slice(0, 10), accepted: 2, rejected: 1 }));
  const series = [{ key: "accepted", label: "Accepted", color: "#2a6fb0" }, { key: "rejected", label: "Rejected", color: "#e8a33a" }];
  const labels = (kind: "line" | "bar", n: number) => {
    const { container } = render(<Chart kind={kind} stacked={kind === "bar"} data={days(n)} xKey="day" series={series} label="c" />);
    const out = [...container.querySelectorAll(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value, .recharts-xAxis .recharts-cartesian-axis-tick-value")].map((e) => e.textContent);
    cleanup();
    return [...new Set(out)];
  };
  it("is one shared setting for every chart over days: MM-DD, first and last kept, at least 24px between labels", () => {
    expect(DAY_AXIS).toMatchObject({ interval: "preserveStartEnd", minTickGap: 24, tickFormatter: shortDay });
    expect(shortDay("2026-11-05")).toBe("11-05");
    const src = readFileSync("src/app/admin/_components/Charts.tsx", "utf8");
    expect(src.match(/<XAxis[^>]*>/g)).toEqual(["<XAxis dataKey={xKey} {...DAY_AXIS} />", "<XAxis dataKey={xKey} {...(angled ? NAME_AXIS : DAY_AXIS)} />"]);
    expect(NAME_AXIS.interval).toBe(0); // names (categories, roles) are all printed, at an angle
  });
  it("a bar chart over days no longer prints every day, and keeps the first and the last like the line charts", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const n of [30, 90]) {
      const bar = labels("bar", n), all = days(n).map((d) => d.day.slice(5));
      expect(bar.length, String(n)).toBeGreaterThan(2); expect(bar.length, String(n)).toBeLessThan(n);
      expect(bar[0]).toBe(all[0]); expect(bar.at(-1)).toBe(all.at(-1));
      expect(bar.every((b) => /^\d\d-\d\d$/.test(b!))).toBe(true);
    }
    expect(labels("bar", 7).length).toBe(7);
  });
  it("the tooltip shows the whole date, and the bars have a sensible largest width", () => {
    const src = readFileSync("src/app/admin/_components/Charts.tsx", "utf8");
    expect(src.match(/<Tooltip labelFormatter=\{fullLabel\} \/>/g)).toHaveLength(2);
    expect(src).toContain("maxBarSize={MAX_BAR}"); expect(MAX_BAR).toBe(28);
  });
  it("only charts whose series are parts of one whole are stacked (uploads: accepted + rejected; never sent / verified / failed codes)", () => {
    for (const f of ["src/app/admin/dashboard/page.tsx", "src/app/admin/reports/page.tsx"])
      expect(readFileSync(f, "utf8").match(/<Chart kind="bar" stacked[^>]*/g)!.every((c) => c.includes("Uploads per day")), f).toBe(true);
  });
});
