// @vitest-environment jsdom
// The Make moderator / Remove moderator button on the admin Users page (client component): what it sends, what it shows, and what it refuses.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
import ModeratorToggle from "../src/app/admin/_components/ModeratorToggle";

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { refresh.mockReset(); fetchMock = vi.fn(); (window as any).fetch = fetchMock; });
afterEach(cleanup);

describe("ModeratorToggle", () => {
  it("makes someone a moderator: POSTs the id and true to the admin route, then refreshes the page", async () => {
    fetchMock.mockResolvedValue(reply({ success: true, userId: 7, moderator: true, changed: true }));
    render(<ModeratorToggle userId="7" name="Ann Sample" moderator={false} self={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Make a moderator: Ann Sample" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/moderators");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ userId: "7", moderator: true });
  });

  it("removes the flag: sends false", async () => {
    fetchMock.mockResolvedValue(reply({ success: true, userId: 7, moderator: false, changed: true }));
    render(<ModeratorToggle userId="7" name="Ann Sample" moderator={true} self={false} />);
    expect(screen.getByRole("button").textContent).toBe("Remove moderator");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ userId: "7", moderator: false });
  });

  it("your own row: the button is disabled, says why, and sends nothing", () => {
    render(<ModeratorToggle userId="1" name="The Boss" moderator={false} self={true} />);
    const b = screen.getByRole("button") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe("You cannot change your own moderator flag");
    fireEvent.click(b);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Your own flag cannot be changed.")).toBeTruthy();
  });

  it("shows the server's message when it refuses, and does not refresh", async () => {
    fetchMock.mockResolvedValue(reply({ success: false, error: "FORBIDDEN", message: "You do not have access to this." }, 403));
    render(<ModeratorToggle userId="7" name="Ann Sample" moderator={false} self={false} />);
    fireEvent.click(screen.getByRole("button"));
    expect((await screen.findByRole("alert")).textContent).toBe("You do not have access to this.");
    expect(refresh).not.toHaveBeenCalled();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false); // can try again
  });

  it("shows a plain message when the server cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<ModeratorToggle userId="7" name="Ann Sample" moderator={false} self={false} />);
    fireEvent.click(screen.getByRole("button"));
    expect((await screen.findByRole("alert")).textContent).toBe("We could not reach the server. Please try again.");
  });

  it("a double click sends one request", async () => {
    let done!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { done = r; }));
    render(<ModeratorToggle userId="7" name="Ann Sample" moderator={false} self={false} />);
    const b = screen.getByRole("button");
    fireEvent.click(b); fireEvent.click(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button").textContent).toBe("Saving...");
    done(reply({ success: true }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
