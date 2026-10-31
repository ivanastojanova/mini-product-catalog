import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS_FOLDER } from "./client.js";
import { migrate } from "./migrate.js";

let folder: string;
let sqlite: Database.Database;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "gateway-migrate-"));
  sqlite = new Database(":memory:");
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const write = (name: string, sql: string) => writeFileSync(join(folder, name), sql);
const tables = () =>
  (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map(
    (row) => row.name,
  );

describe("migrate", () => {
  it("applies files in name order and records them", () => {
    write("0002_second.sql", "CREATE TABLE second (id INTEGER);");
    write("0001_first.sql", "CREATE TABLE first (id INTEGER);");

    expect(migrate(sqlite, folder)).toEqual(["0001_first.sql", "0002_second.sql"]);
    expect(tables()).toEqual(expect.arrayContaining(["first", "second", "schema_migrations"]));
  });

  it("does not run an applied file again", () => {
    write("0001_first.sql", "CREATE TABLE first (id INTEGER);");
    migrate(sqlite, folder);

    expect(migrate(sqlite, folder)).toEqual([]);
  });

  it("applies only the files added since the last run", () => {
    write("0001_first.sql", "CREATE TABLE first (id INTEGER);");
    migrate(sqlite, folder);
    write("0002_second.sql", "CREATE TABLE second (id INTEGER);");

    expect(migrate(sqlite, folder)).toEqual(["0002_second.sql"]);
  });

  it("rolls a failing file back completely and stops, leaving earlier ones applied", () => {
    write("0001_ok.sql", "CREATE TABLE ok (id INTEGER);");
    write("0002_bad.sql", "CREATE TABLE half (id INTEGER); THIS IS NOT SQL;");
    write("0003_never.sql", "CREATE TABLE never (id INTEGER);");

    expect(() => migrate(sqlite, folder)).toThrow();

    expect(tables()).toContain("ok");
    expect(tables()).not.toContain("half");
    expect(tables()).not.toContain("never");
    const recorded = sqlite.prepare("SELECT name FROM schema_migrations").all();
    expect(recorded).toEqual([{ name: "0001_ok.sql" }]);
  });

  it("retries a file that failed once it is fixed", () => {
    write("0001_bad.sql", "NOT SQL;");
    expect(() => migrate(sqlite, folder)).toThrow();

    write("0001_bad.sql", "CREATE TABLE fixed (id INTEGER);");
    expect(migrate(sqlite, folder)).toEqual(["0001_bad.sql"]);
    expect(tables()).toContain("fixed");
  });

  it("ignores files that don't match the NNNN_name.sql pattern", () => {
    write("notes.txt", "hello");
    write("1_short.sql", "CREATE TABLE nope (id INTEGER);");
    write("0001_real.sql", "CREATE TABLE real_one (id INTEGER);");

    expect(migrate(sqlite, folder)).toEqual(["0001_real.sql"]);
    expect(tables()).not.toContain("nope");
  });

  it("applies the real gateway migrations to an empty database", () => {
    migrate(sqlite, MIGRATIONS_FOLDER);
    expect(tables()).toEqual(
      expect.arrayContaining(["payment_intents", "events", "refunds", "idempotency_keys"]),
    );
  });
});
