// @vitest-environment jsdom
// P2: the robot types editor on /admin/sector-forms/<sector> (client component): what each button sends, what it shows, what it refuses.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
import RobotTypesEditor from "../src/app/admin/sector-forms/[slug]/RobotTypesEditor";

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const ROBOTS = [
  { id: 11, slug: "drone-sprayers", name: "Drone sprayers", active: true, order: 10, updatedAt: "2026-11-18T10:00:00.000Z" },
  { id: 12, slug: "milking-robots", name: "Milking robots", active: false, order: 20, updatedAt: "2026-11-18T10:00:00.000Z" },
];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { refresh.mockReset(); fetchMock = vi.fn().mockResolvedValue(reply({ success: true, robots: ROBOTS })); (window as any).fetch = fetchMock; });
afterEach(cleanup);
const show = (robots = ROBOTS) => render(<RobotTypesEditor sector="agriculture-dairy" sectorName="Agriculture & Dairy" robots={robots} />);
const sent = (i = 0) => ({ url: fetchMock.mock.calls[i][0], method: fetchMock.mock.calls[i][1].method, body: JSON.parse(fetchMock.mock.calls[i][1].body) });

describe("RobotTypesEditor", () => {
  it("lists each robot type with its link code and On/Off; the first cannot move up and the last cannot move down", () => {
    show();
    expect(screen.getByRole("region", { name: "Robot types of Agriculture & Dairy" })).toBeTruthy();
    expect(screen.getByText("drone-sprayers")).toBeTruthy();
    expect(screen.getByText("On")).toBeTruthy();
    expect(screen.getByText("Off")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Move Drone sprayers up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Milking robots down" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Switch on Milking robots" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delete|remove/i })).toBeNull(); // never deleted
  });

  it("adds a robot type: POSTs the name to the admin route, says so, clears the box and refreshes", async () => {
    show();
    const add = screen.getByRole("button", { name: "Add robot type" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true); // nothing typed yet
    fireEvent.change(screen.getByLabelText(/New robot type/), { target: { value: "  Weeding   robots " } });
    fireEvent.click(add);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ url: "/api/admin/sector-forms/agriculture-dairy/robots", method: "POST", body: { name: "  Weeding   robots " } });
    expect(screen.getByText('Added "Weeding robots".')).toBeTruthy();
    expect((screen.getByLabelText(/New robot type/) as HTMLInputElement).value).toBe("");
  });

  it("renames: Rename opens a box with the current name, Save PATCHes { name } for that robot", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Rename Drone sprayers" }));
    const box = screen.getByLabelText("New name for Drone sprayers") as HTMLInputElement;
    expect(box.value).toBe("Drone sprayers");
    fireEvent.change(box, { target: { value: "Spot drone sprayers" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent()).toEqual({ url: "/api/admin/sector-forms/agriculture-dairy/robots/11", method: "PATCH", body: { name: "Spot drone sprayers" } });
    await waitFor(() => expect(screen.queryByLabelText("New name for Drone sprayers")).toBeNull());
  });

  it("Cancel closes the rename box and sends nothing", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Rename Drone sprayers" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New name for Drone sprayers")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("switch off / on and move send exactly one change each", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Switch off Drone sprayers" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent(0)).toMatchObject({ url: "/api/admin/sector-forms/agriculture-dairy/robots/11", body: { active: false } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Move Drone sprayers down" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Move Drone sprayers down" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sent(1)).toMatchObject({ url: "/api/admin/sector-forms/agriculture-dairy/robots/11", body: { move: "down" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Switch on Milking robots" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Switch on Milking robots" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(sent(2)).toMatchObject({ url: "/api/admin/sector-forms/agriculture-dairy/robots/12", body: { active: true } });
  });

  it("shows the server's message when a change is refused, and does not refresh", async () => {
    fetchMock.mockResolvedValue(reply({ success: false, error: "DUPLICATE", message: 'This sector already has a robot type called "Drone sprayers".' }, 409));
    show();
    fireEvent.change(screen.getByLabelText(/New robot type/), { target: { value: "drone sprayers" } });
    fireEvent.click(screen.getByRole("button", { name: "Add robot type" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe('This sector already has a robot type called "Drone sprayers".'));
    expect(refresh).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/New robot type/) as HTMLInputElement).value).toBe("drone sprayers"); // kept, to fix
  });

  it("when the server cannot be reached it says so", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Switch off Drone sprayers" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("We could not reach the server. Please try again."));
  });

  it("no double submits: a second click while saving sends nothing", async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (finish = r)));
    show();
    const b = screen.getByRole("button", { name: "Switch off Drone sprayers" });
    fireEvent.click(b); fireEvent.click(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(reply({ success: true, robots: ROBOTS }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("an empty sector says how to start", () => {
    show([]);
    expect(screen.getByText("No robot types yet. Add the first one below.")).toBeTruthy();
  });
});
