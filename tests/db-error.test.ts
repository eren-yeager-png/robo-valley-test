// The database error helper (item 2): the friendly category, and a server-log line that names the real cause without ever carrying data.
import { describe, expect, it } from "vitest";
import { dbLogLine, dbProblem } from "../src/lib/dbError";

const err = (code: string | undefined, message: string) => Object.assign(new Error(message), code ? { code } : {});

describe("dbProblem", () => {
  it("a missing table, column, function or schema means the migrations are not applied", () => {
    for (const c of ["42P01", "42703", "42883", "3F000"]) expect(dbProblem(err(c, "x does not exist"))).toBe("not_set_up");
  });
  it("connection, resource and network failures mean the database could not be reached", () => {
    for (const c of ["08006", "08001", "53300", "57P01", "57P03", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"]) expect(dbProblem(err(c, "boom"))).toBe("unreachable");
    expect(dbProblem(err(undefined, "Connection terminated due to connection timeout"))).toBe("unreachable");
    expect(dbProblem(err(undefined, "timeout exceeded when trying to connect"))).toBe("unreachable");
  });
  it("anything else, or something that is not an error at all, is a plain error", () => {
    expect(dbProblem(err("23505", "duplicate key"))).toBe("error");
    expect(dbProblem(err(undefined, "secret detail"))).toBe("error");
    expect(dbProblem(null)).toBe("error");
    expect(dbProblem("a string")).toBe("error");
  });
});

describe("dbLogLine", () => {
  it("names the missing table or column, which is what an operator needs to fix it", () => {
    expect(dbLogLine("admin sector counts", err("42P01", 'relation "sectors" does not exist'))).toBe('admin sector counts: database error 42P01 (relation "sectors" does not exist)');
    expect(dbLogLine("contribute sectors", err("42703", "column s.is_demo does not exist"))).toBe("contribute sectors: database error 42703 (column s.is_demo does not exist)");
  });
  it("never copies the message of any other error (it can quote a value, a host or a connection string)", () => {
    const leaky = [
      err("23505", "Key (email)=(asha@example.com) already exists."),
      err("08006", "connection to ep-secret-host.neon.tech failed: password authentication failed for user rv"),
      err("ECONNREFUSED", "connect ECONNREFUSED 10.1.2.3:5432"),
      err(undefined, "secret detail"),
    ];
    const lines = leaky.map((e) => dbLogLine("x", e));
    for (const l of lines) expect(l).not.toMatch(/asha@|ep-secret|10\.1\.2\.3|secret detail|password/);
    expect(lines[0]).toBe("x: database error 23505 (details left out of the log)");
    expect(lines[1]).toBe("x: database error 08006 (the database could not be reached)");
    expect(lines[3]).toBe("x: database error without a code (details left out of the log)");
  });
  it("ignores a code that is not a plain code, and keeps a long schema message short", () => {
    expect(dbLogLine("x", Object.assign(new Error("m"), { code: "<script>" }))).toBe("x: database error without a code (details left out of the log)");
    expect(dbLogLine("x", err("42P01", "relation " + "a".repeat(400) + " does not exist")).length).toBeLessThan(220);
  });
});
