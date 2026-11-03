// @vitest-environment jsdom
// Elementor widget 04 on /find-a-service/: the "Upload Files" button exists ONLY for an administrator
// (GET /api/auth/me role === 'admin'), uses credentials, shows upload progress and never injects untrusted text as HTML.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const HTML = readFileSync(join(__dirname, "../frontend/elementor/find-a-service-510/widgets/04-upload-button.a51f0e2.html"), "utf8");
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(HTML)![1];
const settle = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { await settle(); await settle(); };

class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress?: (e: unknown) => void; onload?: () => void } = {};
  withCredentials = false; method = ""; url = ""; body: unknown; status = 0; responseText = "";
  onload?: () => void; onerror?: () => void; onabort?: () => void; ontimeout?: () => void;
  constructor() { FakeXhr.last = this; }
  open(m: string, u: string) { this.method = m; this.url = u; }
  send(b: unknown) { this.body = b; }
}

async function mountPage(me: unknown, opts: { fail?: boolean } = {}) {
  document.body.innerHTML = '<div class="rv-fas rv-fas-up" id="rv-fas-up"></div>';
  (window as any).RoboValleyApi = { base: "https://app.techytree.in" };
  const fetchMock = vi.fn(async (url: string) => {
    if (opts.fail) throw new Error("offline");
    // the dialog's category list comes from the categories API (never typed by hand)
    if (String(url).includes("/api/services/categories")) return { ok: true, json: async () => ({ success: true, categories: [{ slug: "atl-labs", name: "ATL Labs", active: true, count: 9716 }, { slug: "stem-labs", name: "STEM Labs", active: false, count: 0 }] }) } as Response;
    return { ok: true, json: async () => me } as Response;
  });
  (window as any).fetch = fetchMock;
  (window as any).XMLHttpRequest = FakeXhr;
  (0, eval)(SCRIPT);
  await flush();
  return { fetchMock, btn: document.querySelector("#rv-fas-up button") as HTMLButtonElement | null };
}
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("Upload Files button visibility", () => {
  it("admin: the button is rendered", async () => {
    const { btn, fetchMock } = await mountPage({ role: "admin", firstName: "Ravi" });
    expect(btn?.textContent).toBe("Upload Files");
    expect(btn?.type).toBe("button");
    expect(btn?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(fetchMock).toHaveBeenCalledWith("https://app.techytree.in/api/auth/me", { credentials: "include", cache: "no-store" });
  });

  it.each([
    ["signed out", { role: null, firstName: null }],
    ["a normal user", { role: "user", firstName: "Asha" }],
    ["an unexpected role value", { role: "Admin", firstName: "X" }],
  ])("%s: no button and no markup at all", async (_n, me) => {
    const { btn } = await mountPage(me);
    expect(btn).toBeNull();
    expect(document.getElementById("rv-fas-up")!.children.length).toBe(0);
    expect(document.body.textContent).not.toContain("Upload Files");
  });

  it("API unreachable: no button", async () => {
    expect((await mountPage({}, { fail: true })).btn).toBeNull();
  });

  it("the widget ships no button markup in its HTML (only the empty mount point)", () => {
    expect(HTML.replace(SCRIPT, "")).not.toMatch(/<button/i);
    expect(HTML).toContain('id="rv-fas-up"');
  });
});

describe("category in the upload dialog", () => {
  const csvNamed = (n: string) => new File(["School Name,District\nA,B\n"], n, { type: "text/csv" });
  async function open() {
    const { btn } = await mountPage({ role: "admin", firstName: "Ravi" });
    btn!.click();
    await flush();
    return document.querySelector(".rv-fas-dlg") as HTMLElement;
  }
  it("is a required dropdown listing the categories from the API, with a label", async () => {
    const dlg = await open();
    const sel = dlg.querySelector("select") as HTMLSelectElement;
    expect(sel.required).toBe(true);
    expect([...sel.options].map((o) => o.textContent)).toEqual(["Choose a category…", "ATL Labs", "STEM Labs"]);
    expect(dlg.querySelector(`label[for="${sel.id}"]`)!.textContent).toBe("Category");
    expect(dlg.textContent).toContain("replaces only the data of the category you choose");
  });
  it("no category chosen: a clear message and nothing is sent", async () => {
    const dlg = await open();
    const input = dlg.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [csvNamed("data.csv")], configurable: true });
    (FakeXhr as any).last = undefined;
    ([...dlg.querySelectorAll("button")].find((b) => b.textContent === "Upload and preview") as HTMLButtonElement).click();
    expect(dlg.textContent).toContain("Choose which category this file belongs to.");
    expect(FakeXhr.last).toBeUndefined();
  });
  it("is pre-selected from the file name when it names a category, and can still be changed", async () => {
    const dlg = await open();
    const sel = dlg.querySelector("select") as HTMLSelectElement;
    const input = dlg.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [csvNamed("STEM_Labs 2026.csv")], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect(sel.value).toBe("stem-labs");
    sel.value = "atl-labs";
    expect(sel.value).toBe("atl-labs");
  });
  it("a file name that matches nothing leaves the choice to the admin", async () => {
    const dlg = await open();
    const input = dlg.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [csvNamed("schools.csv")], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect((dlg.querySelector("select") as HTMLSelectElement).value).toBe("");
  });
  it("the category names are shown as text, never as HTML", async () => {
    const dlg = await open();
    expect(dlg.querySelector("select")!.innerHTML).not.toMatch(/<(img|script)/);
    expect(HTML).not.toMatch(/innerHTML\s*=\s*[^'"<\s]/); // only the static button icon is assigned as HTML
  });
});

describe("upload flow", () => {
  const file = () => new File(["School Name,District\nA School,Guntur\n"], "schools.csv", { type: "text/csv" });
  async function openAndSend(opts: { category?: string | null } = {}) {
    const { btn } = await mountPage({ role: "admin", firstName: "Ravi" });
    btn!.click();
    await flush();
    const dlg = document.querySelector(".rv-fas-dlg") as HTMLElement;
    const input = dlg.querySelector("input[type=file]") as HTMLInputElement;
    if (opts.category !== null) (dlg.querySelector("select") as HTMLSelectElement).value = opts.category ?? "atl-labs";
    Object.defineProperty(input, "files", { value: [file()], configurable: true });
    const go = [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Upload and preview")!;
    go.click();
    return { dlg, go };
  }

  it("sends the file as multipart with credentials to /api/services/upload, with a visible progress bar", async () => {
    const { go } = await openAndSend();
    const x = FakeXhr.last;
    expect(x.method).toBe("POST");
    expect(x.url).toBe("https://app.techytree.in/api/services/upload");
    expect(x.withCredentials).toBe(true);
    expect(x.body).toBeInstanceOf(FormData);
    expect((x.body as FormData).get("category")).toBe("atl-labs"); // the chosen category travels with the file
    expect(go.disabled).toBe(true);
    const bar = document.querySelector("progress.rv-fas-dlg-bar") as HTMLProgressElement;
    expect(bar).not.toBeNull();
    expect(bar.getAttribute("aria-label")).toBe("Upload progress");
    x.upload.onprogress!({ lengthComputable: true, loaded: 40, total: 100 });
    expect(bar.value).toBe(40);
    expect(document.querySelector(".rv-fas-dlg")!.textContent).toContain("Uploading 40%");
    x.upload.onload!();
    expect(document.querySelector(".rv-fas-dlg")!.textContent).toContain("Checking the file");
  });

  it("success shows the preview and the confirm button; server text is escaped, not injected", async () => {
    await openAndSend();
    const x = FakeXhr.last;
    x.status = 200;
    x.responseText = JSON.stringify({
      success: true, datasetId: "d1", filename: "<b>evil</b>.csv", rowCount: 1, invalidRowCount: 0, columns: ["School Name"],
      preview: [{ schoolName: "<img src=x onerror=alert(1)>", state: "AP", district: "Guntur", pincode: "522005" }], invalidRows: [],
    });
    x.onload!();
    const dlg = document.querySelector(".rv-fas-dlg") as HTMLElement;
    expect(dlg.textContent).toContain("Check before publishing");
    expect(dlg.querySelector("img")).toBeNull();
    expect(dlg.querySelector("b")).toBeNull();
    expect(dlg.textContent).toContain("<img src=x onerror=alert(1)>");
    expect([...dlg.querySelectorAll("button")].some((b) => b.textContent === "Confirm and publish")).toBe(true);
  });

  it.each([
    [403, "{}", "Only an administrator can upload files."],
    [401, "{}", "Your session has ended. Please sign in again."],
    [500, "not json", "The upload failed. Nothing was changed."],
    [400, JSON.stringify({ success: false, message: "Missing the School Name column." }), "Missing the School Name column."],
  ])("error %s shows a clear message and lets the admin try again", async (status, body, text) => {
    await openAndSend();
    const x = FakeXhr.last;
    x.status = status; x.responseText = body; x.onload!();
    const alert = document.querySelector('.rv-fas-dlg [role="alert"]');
    expect(alert?.textContent).toBe(text);
    expect([...document.querySelectorAll(".rv-fas-dlg button")].some((b) => b.textContent === "Upload and preview")).toBe(true);
  });

  it("network failure shows the offline message", async () => {
    await openAndSend();
    FakeXhr.last.onerror!();
    expect(document.querySelector('.rv-fas-dlg [role="alert"]')?.textContent).toMatch(/Could not reach the server/);
  });
});
