// windowRoom(): waits for the next rate-limit window only when fewer than `minSeconds` remain in the current one (tests/helpers/rateWindow.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { windowRoom } from "./helpers/rateWindow";

afterEach(() => { vi.useRealTimers(); });
const at = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };

describe("windowRoom", () => {
  it("returns at once when there is plenty of room left in the minute", async () => {
    at("2026-01-01T00:00:10.000Z"); // 50 s left
    let done = false; void windowRoom(15).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
  it("returns at once when exactly the margin is left", async () => {
    at("2026-01-01T00:00:45.000Z"); // 15 s left
    let done = false; void windowRoom(15).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
  it("waits for the next window when less than the margin is left, and not longer", async () => {
    at("2026-01-01T00:00:50.000Z"); // 10 s left
    let done = false; void windowRoom(15).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(false); // the boundary itself is not enough: it waits a quarter second past it
    await vi.advanceTimersByTimeAsync(250);
    expect(done).toBe(true);
    expect(new Date().getUTCSeconds()).toBe(0); // it resumes at the start of the next window
  });
  it("a start 0.4 s before the boundary waits just past it", async () => {
    at("2026-01-01T00:00:59.600Z");
    let done = false; void windowRoom(15).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(600);
    expect(done).toBe(false); // still before the boundary plus the quarter second
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
  });
});
