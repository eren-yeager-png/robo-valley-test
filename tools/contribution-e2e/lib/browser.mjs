// Our own headless Chrome or Edge (its own temporary profile; the DevTools port is chosen by the browser, port 0, and read from the
// profile), driven through the DevTools protocol. SAFETY GATE, before anything else: the hosts in RV_E2E_BLOCK_HOSTS (add your live
// site's names there, comma separated) plus *.vercel.app and *.neon.tech are made unresolvable in this browser and each is checked to
// really fail; then the app must answer as the local build on 127.0.0.1. If either check fails, the run stops. When it ends, every
// browser process started with this profile is stopped (stopping only the first process can leave the browser running).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertLocal } from "./config.mjs";

const CANDIDATES = {
  win32: ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"],
};
export const blockedHosts = () => ["*.vercel.app", "*.neon.tech", ...String(process.env.RV_E2E_BLOCK_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stops every process of the browser that was started with this profile folder. */
function killProfile(profile) {
  try {
    if (process.platform === "win32") {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:RV_E2E_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
      { stdio: "ignore", env: { ...process.env, RV_E2E_PROFILE: profile } });
    } else {
      execFileSync("pkill", ["-f", "--", profile], { stdio: "ignore" });
    }
  } catch { /* nothing left to stop */ }
}

export async function startBrowser({ appGate } = {}) {
  if (appGate) assertLocal(appGate);
  const exe = process.env.RV_E2E_BROWSER || (CANDIDATES[process.platform] || []).find((p) => existsSync(p));
  if (!exe) throw new Error("ABORT: no Chrome, Edge or Chromium found; set RV_E2E_BROWSER to its program file");
  const profile = mkdtempSync(join(tmpdir(), "rvcw-e2e-browser-"));
  const rules = blockedHosts().map((h) => `MAP ${h} ~NOTFOUND`).join(",");
  spawn(exe, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb",
    "--disable-extensions", "--disable-background-networking", "--disable-sync", "--disable-component-update",
    `--host-resolver-rules=${rules}`, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", detached: process.platform !== "win32" }).unref();
  const kill = () => {
    killProfile(profile);
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* still in use: the OS cleans temp later */ } }, 800);
  };
  let port;
  for (let i = 0; i < 100 && !port; i++) { await sleep(150); try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); } catch { /* not yet */ } }
  if (!port) { kill(); throw new Error("ABORT: the browser did not start"); }
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(150); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* not yet */ } }
  if (!target) { kill(); throw new Error("ABORT: the browser has no page"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener("message", (m) => {
    const x = JSON.parse(String(m.data));
    if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); return; }
    if (x.method === "Runtime.exceptionThrown") errors.push("exception: " + (x.params.exceptionDetails?.exception?.description?.split("\n")[0] || "?"));
    if (x.method === "Log.entryAdded" && x.params.entry.level === "error") errors.push("log: " + x.params.entry.text.slice(0, 160) + " " + (x.params.entry.url || "").slice(0, 80));
    if (x.method === "Runtime.consoleAPICalled" && x.params.type === "error") errors.push("console: " + x.params.args.map((a) => a.value || a.description).join(" ").slice(0, 160));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return r.result.exceptionDetails ? "EXCEPTION " + (r.result.exceptionDetails.exception?.description || "").split("\n")[0] : r.result.result.value;
  };
  const waitFor = async (expression, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await ev(expression)) === true) return true; await sleep(120); } return false; };
  const go = async (url, ready) => { await send("Page.navigate", { url }); await sleep(300); await waitFor('document.readyState === "complete"', 30000); if (ready) await waitFor(ready, 15000); await sleep(250); };
  let size = [1366, 900];
  const viewport = (w, h) => { size = [w, h]; return send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 }); };
  const shot = async (path, { full } = {}) => {
    mkdirSync(dirname(path), { recursive: true });
    if (full) { await ev("window.scrollTo(0, 0)"); const h = Math.min(6000, Math.max(size[1], await ev("Math.ceil(document.documentElement.scrollHeight)"))); await send("Emulation.setDeviceMetricsOverride", { width: size[0], height: h, deviceScaleFactor: 1, mobile: size[0] < 500 }); }
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(r.result.data, "base64"));
    if (full) await viewport(size[0], size[1]);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Log.enable"); await send("DOM.enable");
  const close = () => { try { ws.close(); } catch { /* closed */ } kill(); };
  // the safety gate
  for (const h of blockedHosts()) {
    const host = h.startsWith("*.") ? `gate-check${h.slice(1)}` : h;
    await go(`https://${host}/`);
    if (!String(await ev("location.href")).startsWith("chrome-error://")) { close(); throw new Error(`ABORT: ${host} was not blocked in the test browser`); }
  }
  if (appGate) {
    await go(appGate + "/login");
    if ((await ev("location.origin")) !== appGate || (await ev("/RoboValley/.test(document.title)")) !== true) { close(); throw new Error("ABORT: the local app did not answer at " + appGate); }
  }
  errors.length = 0;
  console.log(`safety gate: ${blockedHosts().join(", ")} are blocked in this browser${appGate ? `; the app is the local build at ${appGate}` : ""}`);
  return { send, ev, waitFor, go, viewport, shot, sleep, errors, close };
}
