// @vitest-environment jsdom
// P5: the questions editor on /admin/sector-forms/<sector> (client component): what each button sends and what it shows.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
import QuestionsEditor from "../src/app/admin/sector-forms/[slug]/QuestionsEditor";

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const Q = [
  { id: 21, label: "How many animals?", kind: "text" as const, options: null, required: true, active: true, order: 10, updatedAt: "2026-11-18T10:00:00.000Z" },
  { id: 22, label: "Which shed?", kind: "choice" as const, options: ["North", "South"], required: false, active: true, order: 20, updatedAt: "2026-11-18T10:00:00.000Z" },
  { id: 23, label: "An old question?", kind: "text" as const, options: null, required: false, active: false, order: 30, updatedAt: "2026-11-18T10:00:00.000Z" },
];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { refresh.mockReset(); fetchMock = vi.fn().mockResolvedValue(reply({ success: true, questions: Q })); (window as any).fetch = fetchMock; });
afterEach(cleanup);
const show = (questions = Q) => render(<QuestionsEditor sector="agriculture-dairy" sectorName="Agriculture & Dairy" questions={questions} />);
const sent = (i = 0) => ({ url: fetchMock.mock.calls[i][0], method: fetchMock.mock.calls[i][1].method, body: JSON.parse(fetchMock.mock.calls[i][1].body) });
const BASE = "/api/admin/sector-forms/agriculture-dairy/questions";

describe("QuestionsEditor", () => {
  it("shows the counts, each question's answer kind and state, and no delete anywhere", () => {
    show();
    expect(screen.getByText("2 of 5 questions on · 1 of 2 required")).toBeTruthy();
    expect(screen.getAllByText("Short text (up to 500 characters)", { selector: "td" })).toHaveLength(2); // the two text questions (one switched off)
    expect(screen.getByText("Pick one: North · South")).toBeTruthy();
    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /make required: an old question/i })).toBeNull(); // an off question cannot be made required
    expect(screen.queryByRole("button", { name: /delete|remove/i })).toBeNull();
  });
  it("adds a short-text question (optional unless ticked) and a pick-one question with one choice per line", async () => {
    show();
    fireEvent.change(screen.getByLabelText("New question"), { target: { value: "Who milks the cows?" } });
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(sent(0)).toEqual({ url: BASE, method: "POST", body: { label: "Who milks the cows?", kind: "text", required: false } });
    fireEvent.change(screen.getByLabelText("New question"), { target: { value: "Which breed?" } });
    fireEvent.click(screen.getByLabelText("Pick one from a list"));
    fireEvent.change(screen.getByLabelText(/Choices, one per line/), { target: { value: "Murrah\nJersey\n" } });
    fireEvent.click(screen.getByLabelText(/Required/));
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sent(1).body).toEqual({ label: "Which breed?", kind: "choice", required: true, options: ["Murrah", "Jersey", ""] });
  });
  it("each change sends exactly one thing: required, on/off, move, wording, choices", async () => {
    show();
    const steps: [string, object][] = [];
    const click = async (name: RegExp | string) => { fireEvent.click(screen.getByRole("button", { name })); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(steps.length + 1)); };
    await click("Make optional: How many animals?"); steps.push(["21", { required: false }]);
    await click("Switch on: An old question?"); steps.push(["23", { active: true }]);
    await click('Move "Which shed?" up'); steps.push(["22", { move: "up" }]);
    fireEvent.click(screen.getByRole("button", { name: 'Edit the choices of "Which shed?"' }));
    fireEvent.change(screen.getByLabelText('Choices for "Which shed?", one per line'), { target: { value: "North\nSouth\nEast" } });
    await click("Save"); steps.push(["22", { options: ["North", "South", "East"] }]);
    fireEvent.click(screen.getByRole("button", { name: 'Edit the wording of "How many animals?"' }));
    fireEvent.change(screen.getByLabelText('New wording for "How many animals?"'), { target: { value: "How many cows?" } });
    await click("Save"); steps.push(["21", { label: "How many cows?" }]);
    steps.forEach(([id, body], i) => expect(sent(i), String(i)).toEqual({ url: `${BASE}/${id}`, method: "PATCH", body }));
  });
  it("with 5 questions on, Add is disabled and says why", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...Q[0], id: 100 + i, label: `Question ${i}?`, required: false }));
    show(five);
    expect((screen.getByRole("button", { name: "Add question" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("5 questions are on. Switch one off to add another.")).toBeTruthy();
  });
  it("shows the server's message when a change is refused", async () => {
    fetchMock.mockResolvedValue(reply({ success: false, error: "LIMIT", message: "At most 2 questions of a sector can be required. Make another one optional first." }, 409));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Make required: Which shed?" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("At most 2 questions of a sector can be required. Make another one optional first."));
    expect(refresh).not.toHaveBeenCalled();
  });
});
