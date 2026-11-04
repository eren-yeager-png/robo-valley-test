// @vitest-environment jsdom
// The real chart component (Recharts) in a browser-like environment.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Chart from "../src/app/admin/_components/Charts";

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
