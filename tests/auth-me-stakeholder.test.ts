// /api/auth/me: the display-only stakeholder label for the Contribute form. No id, email or full name ever leaves.
import { afterEach, describe, expect, it, vi } from "vitest";

const who: { u: any } = { u: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => who.u,
  firstNameOf: (n: string) => (n ? n.split(" ")[0] : null),
}));
import { GET } from "../src/app/api/auth/me/route";

const ask = async () => (await GET(new Request("http://localhost/api/auth/me"))).json();
afterEach(() => { who.u = null; });

describe("/api/auth/me stakeholder", () => {
  it("a member gets their profile's stakeholder label", async () => {
    who.u = { id: "7", fullName: "Asha Rao", email: "asha@example.invalid", role: "TC" };
    const b = await ask();
    expect(b).toEqual({ role: "user", firstName: "Asha", stakeholder: "Teacher / lab in-charge" });
    expect(JSON.stringify(b)).not.toMatch(/asha@|Rao|"7"/);
  });
  it("an administrator and a signed-out visitor get null; an unknown role code gets null", async () => {
    who.u = { id: "1", fullName: "Ola Admin", email: "o@example.invalid", role: "admin" };
    expect((await ask()).stakeholder).toBeNull();
    who.u = null;
    expect(await ask()).toEqual({ role: null, firstName: null, stakeholder: null });
    who.u = { id: "2", fullName: "X Y", email: "x@example.invalid", role: "ZZ" };
    expect((await ask()).stakeholder).toBeNull();
  });
});
