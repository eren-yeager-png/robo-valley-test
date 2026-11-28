// @vitest-environment jsdom
// Admin > Sector Forms' fields table (public/cw/js/sector-forms.js; it replaced the robot types editor of P2): the order buttons at the
// ends, Rename (a box with the current name; Cancel sends nothing), the switch and the moves sending exactly one change each, the
// server's refusal and "cannot be reached" shown without a refresh, and no double submits while a change is saving.
import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "../public/cw/js/sector-forms.js";
import { ApiError } from "../public/cw/js/api.js";

const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const FIELDS = [
  { id: 1, slug: "milking-robots", name: "Milking robots", active: true, order: 1, source: "admin", pluginName: "", contributions: 0 },
  { id: 2, slug: "drone-sprayers", name: "Drone sprayers", active: false, order: 2, source: "admin", pluginName: "", contributions: 2 },
  { id: 3, slug: "weeding-robots", name: "Weeding robots", active: true, order: 3, source: "admin", pluginName: "", contributions: 0 },
];
let el: HTMLElement, calls: any[], loads: number, refuse: Error | null, hold: Promise<void> | null;
function adapter() {
  return {
    sectorForms: async () => { loads++; return { sectors: [{ slug: "agriculture-dairy", name: "Agriculture & Dairy", active: true, fields: 3, suggestions: 0 }], sector: { slug: "agriculture-dairy", name: "Agriculture & Dairy", active: true }, fields: FIELDS, suggestions: [], questionsOn: null, robotsReady: true }; },
    changeField: async (sector: string, id: number, change: any) => { calls.push([sector, id, change]); if (hold) await hold; if (refuse) throw refuse; return { success: true }; },
    addField: async (sector: string, body: any) => { calls.push([sector, "add", body]); return { success: true, robot: { id: 9 } }; },
  };
}
const open = async () => { document.body.innerHTML = '<div id="m"></div>'; el = document.getElementById("m")!; await mount(el, { adapter: adapter(), form: "#form", sector: "agriculture-dairy" }); await settle(); };
const row = (id: number) => el.querySelector(`tr[data-field="${id}"]`) as HTMLElement;
beforeEach(() => { calls = []; loads = 0; refuse = null; hold = null; });

describe("Sector Forms' fields table", () => {
  it("lists each field with its link code, source and state; the first cannot move up and the last cannot move down", async () => {
    await open();
    expect(Array.from(el.querySelectorAll("tr[data-field] .rv-pp-slug")).map((s) => s.textContent)).toEqual(["milking-robots", "drone-sprayers", "weeding-robots"]);
    expect((row(1).querySelector('[data-move="up"]') as HTMLButtonElement).disabled).toBe(true);
    expect((row(3).querySelector('[data-move="down"]') as HTMLButtonElement).disabled).toBe(true);
    expect((row(2).querySelector('[data-move="up"]') as HTMLButtonElement).disabled).toBe(false);
    expect(row(2).querySelector("[data-toggle]")!.getAttribute("aria-checked")).toBe("false");
    expect(row(2).querySelector("[data-toggle]")!.textContent).toContain("Hidden");
  });
  it("Rename opens a box with the current name; saving sends { name } for that field; Cancel sends nothing", async () => {
    await open();
    (row(1).querySelector("[data-rename]") as HTMLButtonElement).click(); await settle();
    const box = document.querySelector('.rv-dlg input[type="text"]') as HTMLInputElement;
    expect(box.value).toBe("Milking robots");
    (document.querySelector('.rv-dlg [data-x="cancel"]') as HTMLButtonElement).click(); await settle();
    expect(calls).toEqual([]);
    (row(1).querySelector("[data-rename]") as HTMLButtonElement).click(); await settle();
    const again = document.querySelector('.rv-dlg input[type="text"]') as HTMLInputElement;
    again.value = "Robotic milkers"; again.dispatchEvent(new Event("input"));
    (document.querySelector('.rv-dlg [data-x="ok"]') as HTMLButtonElement).click(); await settle();
    expect(calls).toEqual([["agriculture-dairy", 1, { name: "Robotic milkers" }]]);
  });
  it("the switch and the moves send exactly one change each, then the list is read again", async () => {
    await open();
    (row(2).querySelector("[data-toggle]") as HTMLButtonElement).click(); await settle();
    (row(2).querySelector('[data-move="down"]') as HTMLButtonElement).click(); await settle();
    expect(calls).toEqual([["agriculture-dairy", 2, { active: true }], ["agriculture-dairy", "2", { move: "down" }]]);
    expect(loads).toBe(3);
  });
  it("a refused change shows the server's message and nothing is read again; an unreachable server says so", async () => {
    await open();
    refuse = new ApiError(409, "DUPLICATE", "This sector already has a robot type called that.");
    (row(1).querySelector('[data-move="down"]') as HTMLButtonElement).click(); await settle();
    expect(el.querySelector("[data-msg]")!.textContent).toBe("This sector already has a robot type called that.");
    expect(loads).toBe(1);
    refuse = new ApiError(0, "NETWORK", undefined as never);
    (row(1).querySelector("[data-toggle]") as HTMLButtonElement).click(); await settle();
    expect(el.querySelector("[data-msg]")!.textContent!.length).toBeGreaterThan(10);
  });
  it("no double submits: a second click while the change is saving sends nothing", async () => {
    await open();
    let release!: () => void;
    hold = new Promise<void>((r) => { release = r; });
    const t = row(1).querySelector("[data-toggle]") as HTMLButtonElement;
    t.click(); t.click(); await settle(3);
    expect(calls).toHaveLength(1);
    release(); await settle();
  });
});
