import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Connectivity check (README). It is public, so it only says whether the database answers: never the database name, host or
// any error text, and never cached.
const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await pool.query("SELECT 1");

    return NextResponse.json(
      {
        success: true,
        message: "Database connected successfully",
      },
      { headers: HEADERS }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Database connection failed",
      },
      { status: 500, headers: HEADERS }
    );
  }
}
