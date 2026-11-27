// @vitest-environment jsdom
// The "Share Your Idea" form (public/cw/js/form.js) in a browser-like DOM with the mock adapter: what shows when, the automatic
// resource ID, the robot list following the sector, all errors in one red notice, the success message, and sign-in / reviewer notes.
import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "../public/cw/js/form.js";
import { MockAdapter } from "../public/cw/js/api.js";
import { MESSAGES } from "../public/cw/js/lists.js";

const SECTORS = [{ slug: "agriculture-dairy", name: "Agriculture & Dairy", robots: [{ slug: "weeding-robots", name: "Weeding robots" }, { slug: "milking-robots", name: "Milking robots" }] }, { slug: "healthcare", name: "Healthcare", robots: [] }];
const tick = () => new Promise((r) => setTimeout(r, 0));
let el: HTMLElement, mock: MockAdapter;
const $ = (s: string) => el.querySelector(s) as HTMLInputElement;
const choose = (name: string, value: string) => { const i = el.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement; i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true })); };
const type = (sel: string, v: string) => { const i = $(sel); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); };
const submit = async () => { (el.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); for (let i = 0; i < 5; i++) await tick(); };
async function open(opts: Record<string, unknown> = {}, query = "") {
  el = document.createElement("div"); document.body.innerHTML = ""; document.body.appendChild(el);
  mock = new MockAdapter({ sectors: SECTORS, me: { name: "Ananya R.", type: "Student", minor: false } });
  await mount(el, { adapter: mock, query: new URLSearchParams(query), ...opts });
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("the form", () => {
  it("shows the demo's wording; name and type are read-only from the profile", async () => {
    await open();
    expect(el.textContent).toContain("Share Your Idea");
    expect(el.textContent).toContain("Students, parents, guardians, teachers and anyone else can suggest a new idea or improve something already on RoboValley. Submissions are reviewed before anything is made public.");
    for (const t of ["What would you like to do?", "Your name", "I am a", "Category", "Sector", "Robot type", "Idea title", "Describe your idea", "Photo / attachment", "Reference links", "Suitable for", "Suggested path", "Earn path is for learners 18 and above. Not sure? Leave it: the moderator will set it."]) expect(el.textContent).toContain(t);
    expect($("#rv-f-name").value).toBe("Ananya R."); expect($("#rv-f-name").readOnly).toBe(true);
    expect($("#rv-f-type").value).toBe("Student"); expect($("#rv-f-type").readOnly).toBe(true);
    expect(($('input[name="rv-kind"]:checked') as HTMLInputElement).value).toBe("New idea");
  });
  it("resource box: hidden for a new idea until ticked; always shown for a change (acceptance 2)", async () => {
    await open();
    const box = () => (el.querySelector("[data-refbox]") as HTMLElement).hidden, row = () => (el.querySelector("[data-refers-row]") as HTMLElement).hidden;
    expect([box(), row()]).toEqual([true, false]);
    const tickBox = $('input[name="rv-refers"]'); tickBox.checked = true; tickBox.dispatchEvent(new Event("change", { bubbles: true }));
    expect(box()).toBe(false);
    for (const k of ["Modification", "Suggestion", "Enhancement of existing feature"]) { choose("rv-kind", k); expect([box(), row()]).toEqual([false, true]); }
  });
  it("the resource ID follows the path and the type, read-only", async () => {
    await open();
    choose("rv-kind", "Modification");
    type("#rv-f-rpath", "Robots by Sector › Agriculture & Dairy › Weeding robots");
    expect($("#rv-f-rid").value).toBe("rv_robot_type · weeding-robots");
    type("#rv-f-rtype", "Sector page");
    expect($("#rv-f-rid").value).toBe("rv_sector · weeding-robots");
    type("#rv-f-rpath", "");
    expect($("#rv-f-rid").value).toBe("");
    expect($("#rv-f-rid").readOnly).toBe(true);
  });
  it("sector is optional (Not sure first) and the robot list follows it; ?sector= preselects it", async () => {
    await open();
    expect($("#rv-f-sector").value).toBe("not-sure");
    expect(Array.from(($("#rv-f-robot") as unknown as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["Not sure"]);
    type("#rv-f-sector", "agriculture-dairy");
    expect(Array.from(($("#rv-f-robot") as unknown as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["Not sure", "Weeding robots", "Milking robots"]);
    await open({}, "sector=healthcare");
    expect($("#rv-f-sector").value).toBe("healthcare");
  });
  it("shows every problem together in one red notice and sends nothing (acceptance 3)", async () => {
    await open();
    choose("rv-kind", "Suggestion");
    type("#rv-f-rpath", ""); type("#rv-f-rurl", "nope");
    (el.querySelector(".rv-ref-remark") as HTMLInputElement).value = "a remark without a link";
    await submit();
    const n = el.querySelector(".rv-n-err") as HTMLElement;
    expect(n.getAttribute("role")).toBe("alert");
    expect(n.innerHTML.split("<br>")).toEqual([MESSAGES.required, MESSAGES.resourcePath, MESSAGES.resourceUrl, MESSAGES.change, MESSAGES.refRemark]);
    expect(mock.items.length).toBe(0);
  });
  it("reference rows: + Add another link adds a row; removing the last row leaves one empty row", async () => {
    await open();
    (el.querySelector("[data-add-ref]") as HTMLButtonElement).click();
    expect(el.querySelectorAll(".rv-refrow").length).toBe(2);
    el.querySelectorAll<HTMLButtonElement>(".rv-rm").forEach((b) => b.click());
    expect(el.querySelectorAll(".rv-refrow").length).toBe(1);
    expect((el.querySelector(".rv-ref-url") as HTMLInputElement).value).toBe("");
  });
  it("on success says the RV number and that it is not public, then clears the form", async () => {
    await open();
    type("#rv-f-title", "Robot that picks up plastic from beaches");
    type("#rv-f-desc", "A small robot that drives on the beach and picks up plastic.");
    choose("rv-cat", "Robotics");
    await submit();
    expect(el.querySelector(".rv-n-ok")!.innerHTML).toBe("Thank you! Your new idea <b>RV-1025</b> has been submitted for review. It is <b>not public</b> until an Admin publishes it.");
    expect(mock.items[0].status).toBe("submitted");
    expect($("#rv-f-title").value).toBe("");
    expect($("#rv-f-name").value).toBe("Ananya R.");
  });
  it("refuses a file that is not really a JPEG, PNG or PDF before sending it", async () => {
    await open({ sample: true });
    const fake = new File([new TextEncoder().encode("GIF89a....")], "photo.png", { type: "image/png" });
    Object.defineProperty($("#rv-f-file"), "files", { value: [fake] });
    await submit();
    expect(el.querySelector(".rv-n-err")!.textContent).toContain(MESSAGES.attachmentType);
    expect(mock.items.length).toBe(0);
  });
  it("signed out: asks to sign in (with the way back); a reviewer is told they review", async () => {
    el = document.createElement("div"); document.body.appendChild(el);
    const out = { me: async () => ({ signedIn: false }), formConfig: async () => ({ sectors: [] }), loginUrl: (b: string) => "https://app.example/login?returnTo=" + encodeURIComponent(b) };
    await mount(el, { adapter: out as never, query: new URLSearchParams("") });
    expect(el.textContent).toContain(MESSAGES.signIn);
    expect((el.querySelector("a.rv-btn") as HTMLAnchorElement).href).toMatch(/^https:\/\/app\.example\/login\?returnTo=/);
    const rev = { me: async () => ({ signedIn: true, reviewer: true, name: "M", type: "T" }), formConfig: async () => ({ sectors: [] }), loginUrl: () => "#" };
    await mount(el, { adapter: rev as never, query: new URLSearchParams("") });
    expect(el.textContent).toContain(MESSAGES.reviewerCannot);
    expect(el.querySelector("form")).toBeNull();
  });
});
