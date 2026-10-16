
import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database"
    );

    return NextResponse.json({
      success: true,
      message: "Database connected successfully",
      database: result.rows[0].database,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Database connection failed",
      },
      { status: 500 }
    );
  }
}


