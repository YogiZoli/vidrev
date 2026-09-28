import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll } from "vitest";

// Every test file gets its own fresh database. Integration tests run in
// parallel and several run global sweeps (retention, send recovery, connect
// timeouts) that would otherwise change rows other files are asserting on,
// which made CI fail now and then for no real reason.
const base = process.env.DATABASE_URL;
// Test sessions connect to their own databases, never to template1, so
// parallel CREATE DATABASE calls do not collide.
async function admin(statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: base });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

if (base) {
  const name = `t_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await admin(`create database ${name}`);
  const url = new URL(base);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();

  // Runs after the file's own afterAll (which closes its pool). A failed
  // cleanup only leaves a test database behind; it never fails the file.
  afterAll(async () => {
    await admin(`drop database if exists ${name} with (force)`).catch((error: unknown) => {
      console.warn(`test database ${name} was not dropped: ${String(error)}`);
    });
  }, 60_000);
}
