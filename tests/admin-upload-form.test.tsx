// @vitest-environment jsdom
// The upload form in the browser: instant validation feedback, progress, server messages, preview and Make live.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn(), replace: vi.fn() }) }));

import UploadForm from "../src/app/admin/_components/UploadForm";

const CATS = [{ slug: "atl-labs", name: "ATL Labs" }, { slug: "stem-labs", name: "STEM Labs" }];

class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress?: (e: unknown) => void } = {};
  onload?: () => void; onerror?: () => void;
  status = 0; responseText = ""; method = ""; url = ""; sent: FormData | null = null;
  open(method: string, url: string) { this.method = method; this.url = url; FakeXhr.last = this; }
  send(body: FormData) { this.sent = body; }
  progress(loaded: number, total: number) { act(() => this.upload.onprogress?.({ lengthComputable: true, loaded, total })); }
  reply(status: number, body: unknown) { this.status = status; this.responseText = JSON.stringify(body); act(() => this.onload?.()); }
}

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);
const choose = (f: File) => fireEvent.change(screen.getByLabelText("File to upload"), { target: { files: [f] } });

beforeEach(() => { vi.stubGlobal("XMLHttpRequest", FakeXhr); h.refresh.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("upload form", () => {
  it("gives validation feedback before anything is sent", () => {
    render(<UploadForm categories={CATS} initialCategory="" filesReady />);
    choose(file("virus.exe"));
    expect(screen.getByRole("alert").textContent).toContain("not allowed");
    expect((screen.getByRole("button", { name: "Upload and preview" }) as HTMLButtonElement).disabled).toBe(true);
    choose(file("empty.csv", 0));
    expect(screen.getByRole("alert").textContent).toContain("empty");
    choose(file("huge.xlsx", 11 * 1024 * 1024));
    expect(screen.getByRole("alert").textContent).toContain("more than");
    expect(FakeXhr.last).toBeUndefined();
  });

  it("asks for a category before a dataset upload", () => {
    render(<UploadForm categories={CATS} initialCategory="" filesReady />);
    choose(file("schools.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Upload and preview" }));
    expect(screen.getByRole("alert").textContent).toContain("Choose which category");
    expect(FakeXhr.last).toBeUndefined();
  });

  it("uploads a dataset with the chosen category, shows progress and a preview, then makes it live through the confirm route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", () => true);
    render(<UploadForm categories={CATS} initialCategory="stem-labs" filesReady />);
    choose(file("schools.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Upload and preview" }));
    const x = FakeXhr.last;
    expect(x.method).toBe("POST");
    expect(x.url).toBe("/api/services/upload");
    expect(x.sent!.get("category")).toBe("stem-labs");
    expect((x.sent!.get("file") as File).name).toBe("schools.xlsx");
    x.progress(50, 100);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    x.reply(200, { success: true, datasetId: "7", filename: "schools.xlsx", category: { name: "STEM Labs" }, rowCount: 2, invalidRowCount: 1, invalidRows: [{ row: 4, reason: "bad pin" }],
      preview: [{ schoolName: "ZP School", state: "AP", district: "Guntur", pincode: "522001" }] });
    expect(await screen.findByText("Preview: schools.xlsx")).toBeTruthy();
    expect(screen.getByText("ZP School")).toBeTruthy();
    expect(screen.getByText(/Row 4: bad pin/)).toBeTruthy();
    expect(h.refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Make live" }));
    await waitFor(() => expect(screen.getByText("Now live")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/services/upload/confirm", expect.objectContaining({ method: "POST", body: JSON.stringify({ datasetId: "7" }) }));
  });

  it("shows the server's message when an upload is rejected", () => {
    render(<UploadForm categories={CATS} initialCategory="atl-labs" filesReady />);
    choose(file("schools.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Upload and preview" }));
    FakeXhr.last.reply(400, { success: false, message: "Required column PIN code was not found." });
    expect(screen.getByRole("alert").textContent).toContain("Required column PIN code");
    expect(screen.queryByText(/Preview:/)).toBeNull();
  });

  it("stores another file through the attachments API and offers a download and any duplicate warning", () => {
    render(<UploadForm categories={CATS} initialCategory="" filesReady />);
    fireEvent.click(screen.getByRole("tab", { name: "Other file (stored only)" }));
    choose(file("notes.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Store file" }));
    expect(FakeXhr.last.url).toBe("/api/admin/attachments");
    expect(FakeXhr.last.sent!.has("category")).toBe(false);
    FakeXhr.last.reply(201, { success: true, attachment: { key: "a".repeat(32), filename: "notes.pdf", type: "pdf", size: 10 }, warning: "A file with identical contents was already uploaded." });
    expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(`/api/admin/attachments/${"a".repeat(32)}`);
    expect(screen.getByText(/identical contents/)).toBeTruthy();
  });

  it("applies the 4 MB limit to other files and shows a setup notice instead of the form when storage is missing", () => {
    const { unmount } = render(<UploadForm categories={CATS} initialCategory="" filesReady />);
    fireEvent.click(screen.getByRole("tab", { name: "Other file (stored only)" }));
    choose(file("big.pdf", 5 * 1024 * 1024));
    expect(screen.getByRole("alert").textContent).toContain("more than");
    unmount();
    render(<UploadForm categories={CATS} initialCategory="" filesReady={false} />);
    fireEvent.click(screen.getByRole("tab", { name: "Other file (stored only)" }));
    expect(screen.getByText("File storage is not set up yet")).toBeTruthy();
    expect(screen.queryByLabelText("File to upload")).toBeNull();
  });

  it("reports a network failure without claiming success", () => {
    render(<UploadForm categories={CATS} initialCategory="atl-labs" filesReady />);
    choose(file("schools.csv"));
    fireEvent.click(screen.getByRole("button", { name: "Upload and preview" }));
    act(() => FakeXhr.last.onerror?.());
    expect(screen.getByRole("alert").textContent).toContain("Network problem");
  });

  it("shows the upload report: rows read, added, duplicates, rejected, possible duplicates, examples with row numbers and the CSV link", async () => {
    render(<UploadForm categories={CATS} initialCategory="atl-labs" filesReady />);
    choose(file("schools.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Upload and preview" }));
    FakeXhr.last.reply(200, {
      success: true, datasetId: "9", filename: "schools.xlsx", category: { name: "ATL Labs" }, rowCount: 9699, invalidRowCount: 284, invalidRows: [{ row: 12, rowNumber: 12, reason: "Pincode must be 6 digits", sheet: "North" }],
      preview: [{ schoolName: "ZP School", state: "AP", district: "Guntur", pincode: "522001" }],
      report: {
        rowsRead: 10000, added: 9699, duplicatesSkipped: 17, rowsFilled: 2, conflictRows: 3, rejected: 284, possibleDuplicates: 25, hiddenRowsRead: 4, repeatedHeaders: 1, sheets: ["North", "South"],
        examples: { merged: [{ sheet: "South", row: 4909, keptRow: 88, reason: "same UDISE code (names differ)", filled: [], conflicts: [{ column: "district", kept: "A", skipped: "B" }] }], possible: [{ row: 210, otherRow: 4, reason: "same name and PIN code but a different UDISE code; kept as a separate school" }] },
        url: "/api/admin/datasets/9/report",
      },
    });
    expect(await screen.findByText("Upload report")).toBeTruthy();
    expect(screen.getByText(/Rows read: 10,000/)).toBeTruthy();
    expect(screen.getByText(/New unique schools added: 9,699/)).toBeTruthy();
    expect(screen.getByText(/Duplicates skipped.*: 17/)).toBeTruthy();
    expect(screen.getByText(/Rows rejected.*: 284/)).toBeTruthy();
    expect(screen.getByText(/Possible duplicates to review.*: 25/)).toBeTruthy();
    expect(screen.getByText(/4 rows are hidden in the spreadsheet.*read like every other row/)).toBeTruthy();
    expect(screen.getByText(/1 repeated header rows were skipped/)).toBeTruthy();
    expect(screen.getByText(/Row 4909 skipped, kept row 88/)).toBeTruthy();
    expect(screen.getByText(/Row 210 and row 4:/)).toBeTruthy();
    expect(screen.getByText(/North, Row 12: Pincode must be 6 digits/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download the full report (CSV)" }).getAttribute("href")).toBe("/api/admin/datasets/9/report");
    expect(screen.getByText(/9,699 unique schools/)).toBeTruthy();
  });

  it("says 'No changes' (and offers no Make live) when the file is identical to the live data", () => {
    render(<UploadForm categories={CATS} initialCategory="atl-labs" filesReady />);
    choose(file("schools.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Upload and preview" }));
    FakeXhr.last.reply(200, { success: true, unchanged: true, datasetId: "7", message: "This file is identical to the data that is already live for this category. No changes were made." });
    expect(screen.getByText("No changes")).toBeTruthy();
    expect(screen.getByText(/identical to the data that is already live/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make live" })).toBeNull();
    expect(screen.queryByText(/Preview:/)).toBeNull();
  });
});
