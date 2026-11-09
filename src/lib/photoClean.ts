// Removes the hidden information from an uploaded photo BEFORE it is stored: camera details, the date, and above all the GPS position.
// The picture itself is not touched (nothing is re-encoded): only the metadata segments or chunks are left out, so the image
// is exactly the same picture, only smaller by the size of the metadata.
//   JPEG: every APPn segment is dropped (EXIF, XMP, IPTC, thumbnails, the multi-picture index ...) EXCEPT APP0 (the JFIF header),
//         an ICC colour profile (APP2 "ICC_PROFILE") and the Adobe colour marker (APP14, needed to show some files in the right colours);
//         comments (COM) are dropped too. Everything from the start of the scan on is copied unchanged.
//   PNG:  the text chunks (tEXt, zTXt, iTXt), the EXIF chunk (eXIf), the time stamp (tIME) and any unknown ancillary chunk are dropped;
//         the critical chunks and the colour and transparency chunks are kept.
// A file that does not parse cleanly is REFUSED (null), never passed through with its metadata.
import type { PhotoMime } from "./contributionPhotos";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "bKGD", "hIST", "pHYs", "sPLT", "acTL", "fcTL", "fdAT"]);

function stripJpeg(b: Buffer): Buffer | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i + 1] === 0xff) i++; // fill bytes
    const marker = b[i + 1];
    if (marker === undefined) return null;
    if (marker === 0xd9) { out.push(b.subarray(i, i + 2)); return Buffer.concat(out); } // EOI
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(b.subarray(i, i + 2)); i += 2; continue; } // markers without a length
    if (i + 4 > b.length) return null;
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    const seg = b.subarray(i, i + 2 + len);
    if (marker === 0xda) { out.push(b.subarray(i)); return Buffer.concat(out); } // start of scan: the picture data follows, copy to the end
    const payload = b.subarray(i + 4, i + 2 + len);
    const keep =
      marker === 0xe0 || // JFIF
      (marker === 0xe2 && payload.subarray(0, 11).toString("latin1") === "ICC_PROFILE") ||
      (marker === 0xee && payload.subarray(0, 5).toString("latin1") === "Adobe") ||
      !((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe);
    if (keep) out.push(seg);
    i += 2 + len;
  }
  return null; // no scan found
}

function stripPng(b: Buffer): Buffer | null {
  if (b.length < 8 + 12 || !b.subarray(0, 8).equals(PNG_SIG)) return null;
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8, sawIhdr = false, sawIdat = false, sawIend = false;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    if (len > 0x7fffffff || i + 12 + len > b.length) return null;
    const type = b.subarray(i + 4, i + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    const chunk = b.subarray(i, i + 12 + len);
    if (!sawIhdr) { if (type !== "IHDR") return null; sawIhdr = true; }
    if (type === "IDAT") sawIdat = true;
    if (PNG_KEEP.has(type)) out.push(chunk);
    i += 12 + len;
    if (type === "IEND") { sawIend = true; break; }
  }
  if (!sawIhdr || !sawIdat || !sawIend) return null;
  return Buffer.concat(out);
}

/** The photo without its hidden metadata, or null when the file is not a clean JPEG or PNG of the stated type. */
export function stripPhotoMetadata(bytes: Buffer, mime: PhotoMime): Buffer | null {
  return mime === "image/jpeg" ? stripJpeg(bytes) : mime === "image/png" ? stripPng(bytes) : null;
}
