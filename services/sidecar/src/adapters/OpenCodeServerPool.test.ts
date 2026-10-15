import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenCodeServerPool, type ServerHandle } from "./OpenCodeServerPool.js";

interface FakeServer extends ServerHandle {
  disposeCount: number;
  urlCalls: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const makeFake = (created: FakeServer[]): ServerHandle => {
  const server: FakeServer = {
    disposeCount: 0,
    urlCalls: 0,
    url: async (cwd) => {
      server.urlCalls++;
      return `http://127.0.0.1:0/${cwd}`;
    },
    createSession: async () => "ses_test",
    sendMessage: async () => undefined,
    abort: async () => undefined,
    subscribe: () => () => undefined,
    dispose: async () => {
      server.disposeCount++;
    },
  };
  created.push(server);
  return server;
};

const makePool = (idleMs = 20): { pool: OpenCodeServerPool; created: FakeServer[] } => {
  const created: FakeServer[] = [];
  const pool = new OpenCodeServerPool(() => makeFake(created), {}, { idleMs });
  return { pool, created };
};

test("acquire reuses one server per cwd", async () => {
  const { pool, created } = makePool();
  const a = await pool.acquire("/a");
  const b = await pool.acquire("/a");
  assert.equal(a, b);
  assert.equal(created.length, 1);
  assert.equal(pool.size(), 1);
  pool.release("/a");
  pool.release("/a");
});

test("uses a separate server per cwd", async () => {
  const { pool, created } = makePool();
  await pool.acquire("/a");
  await pool.acquire("/b");
  assert.equal(created.length, 2);
  assert.equal(pool.size(), 2);
  assert.notEqual(pool.peek("/a"), pool.peek("/b"));
  await pool.disposeAll();
});

test("evicts a server once it goes idle", async () => {
  const { pool, created } = makePool(20);
  await pool.acquire("/a");
  pool.release("/a");
  assert.equal(created[0]!.disposeCount, 0);
  await sleep(80);
  assert.equal(created[0]!.disposeCount, 1);
  assert.equal(pool.size(), 0);
});

test("keeps a server while a turn is active", async () => {
  const { pool, created } = makePool(20);
  await pool.acquire("/a");
  await pool.acquire("/a");
  pool.release("/a");
  await sleep(80);
  assert.equal(pool.size(), 1);
  assert.equal(created[0]!.disposeCount, 0);
  pool.release("/a");
  await sleep(80);
  assert.equal(pool.size(), 0);
  assert.equal(created[0]!.disposeCount, 1);
});

test("probe starts a server without reference counting", async () => {
  const { pool, created } = makePool(20);
  await pool.probe("/a");
  assert.equal(created[0]!.urlCalls, 1);
  assert.equal(pool.size(), 1);
  await sleep(80);
  assert.equal(pool.size(), 1);
  await pool.disposeAll();
});

test("drop disposes and forgets a server", async () => {
  const { pool, created } = makePool();
  await pool.probe("/a");
  await pool.drop("/a");
  assert.equal(created[0]!.disposeCount, 1);
  assert.equal(pool.size(), 0);
});

test("disposeAll stops every server", async () => {
  const { pool, created } = makePool();
  await pool.acquire("/a");
  await pool.acquire("/b");
  await pool.disposeAll();
  assert.equal(pool.size(), 0);
  assert.deepEqual(
    created.map((c) => c.disposeCount),
    [1, 1],
  );
});
