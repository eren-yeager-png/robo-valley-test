// Reads a request body into memory but gives up as soon as it exceeds the limit, so an oversized (or chunked,
// length-less) upload cannot exhaust server memory. Never trust Content-Length alone.
export async function readBodyLimited(req: Request, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) return null; // stop reading: nothing more is pulled or kept in memory
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
