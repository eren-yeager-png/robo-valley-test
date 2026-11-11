// /api/auth/me: the display-only stakeholder label and reviewer flag for the Contribute form. No id, email or full name ever leaves.
import { afterEach, describe, expect, it, vi } from "vitest";

const who: { u: any } = { u: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => who.u,
  firstNameOf: (n: string) => (n ? n.split(" ")[0] : null),
}));
const moderators = new Set<number>();
vi.mock("../src/lib/moderators", () => ({ reviewerOf: async (_db: unknown, id: number) => (moderators.has(id) ? { ok: true, userId: id, isAdmin: false, isModerator: true } : { ok: false }) }));
import { GET } from "../src/app/api/auth/me/route";

const ask = async () => (await GET(new Request("http://localhost/api/auth/me"))).json();
afterEach(() => { who.u = null; moderators.clear(); });

describe("/api/auth/me stakeholder", () => {
  it("a member gets their profile's stakeholder label", async () => {
    who.u = { id: "7", fullName: "Asha Rao", email: "asha@example.invalid", role: "TC" };
    const b = await ask();
    expect(b).toEqual({ role: "user", firstName: "Asha", stakeholder: "Teacher / lab in-charge", reviewer: false });
    expect(JSON.stringify(b)).not.toMatch(/asha@|Rao|"7"/);
  });
  it("an administrator and a signed-out visitor get null; an unknown role code gets null", async () => {
    who.u = { id: "1", fullName: "Ola Admin", email: "o@example.invalid", role: "admin" };
    expect((await ask()).stakeholder).toBeNull();
    who.u = null;
    expect(await ask()).toEqual({ role: null, firstName: null, stakeholder: null, reviewer: false });
    who.u = { id: "2", fullName: "X Y", email: "x@example.invalid", role: "ZZ" };
    expect((await ask()).stakeholder).toBeNull();
  });
  it("reviewer is true for an administrator and for a flagged moderator, false for a member (portal PR1: the form then shows a note)", async () => {
    who.u = { id: "1", fullName: "Ola Admin", email: "o@example.invalid", role: "admin" };
    expect((await ask()).reviewer).toBe(true);
    who.u = { id: "9", fullName: "Mo Derator", email: "m@example.invalid", role: "TC" };
    moderators.add(9);
    const b = await ask();
    expect(b.reviewer).toBe(true);
    expect(b.stakeholder).toBe("Teacher / lab in-charge");
    moderators.clear();
    expect((await ask()).reviewer).toBe(false);
  });
});
