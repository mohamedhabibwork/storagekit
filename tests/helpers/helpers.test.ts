import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  checksum,
  deletePrefix,
  listAll,
  scopedStorage,
  StorageInvalidPathError,
} from "../../src/index";
import { createFakeStorage } from "../../src/testing/fake";

async function seeded() {
  const storage = await createFakeStorage();
  await storage.upload("a/1.txt", "one");
  await storage.upload("a/2.txt", "two");
  await storage.upload("a/sub/3.txt", "three");
  await storage.upload("b/4.txt", "four");
  return storage;
}

describe("deletePrefix", () => {
  it("deletes every file under the prefix in batches", async () => {
    const storage = await seeded();
    const result = await deletePrefix(storage, "a/", { batchSize: 2 });
    expect(result.deleted.toSorted()).toEqual(["a/1.txt", "a/2.txt", "a/sub/3.txt"]);
    expect(result.failed).toEqual([]);
    expect(await storage.exists("a/1.txt")).toBe(false);
    expect(await storage.exists("b/4.txt")).toBe(true);
  });

  it("rejects an empty prefix and bad batch sizes", async () => {
    const storage = await seeded();
    await expect(deletePrefix(storage, "")).rejects.toThrow(TypeError);
    await expect(deletePrefix(storage, "/")).rejects.toThrow(TypeError);
    await expect(deletePrefix(storage, "a/", { batchSize: 0 })).rejects.toThrow(TypeError);
  });
});

describe("checksum", () => {
  it("hashes stored content by streaming", async () => {
    const storage = await seeded();
    const expected = createHash("sha256").update("three").digest("hex");
    await expect(checksum(storage, "a/sub/3.txt")).resolves.toBe(expected);
    const md5 = createHash("md5").update("one").digest("base64");
    await expect(
      checksum(storage, "a/1.txt", { algorithm: "md5", encoding: "base64" }),
    ).resolves.toBe(md5);
  });
});

describe("listAll", () => {
  it("collects, filters and caps results", async () => {
    const storage = await seeded();
    expect((await listAll(storage, "a/")).map((f) => f.path).toSorted()).toEqual([
      "a/1.txt",
      "a/2.txt",
      "a/sub/3.txt",
    ]);
    expect(await listAll(storage, "a/", { filter: (f) => f.path.includes("sub") })).toHaveLength(1);
    expect(await listAll(storage, undefined, { max: 2 })).toHaveLength(2);
    await expect(listAll(storage, "a/", { max: 0 })).rejects.toThrow(TypeError);
  });
});

describe("scopedStorage", () => {
  it("confines every operation to the scope and reports relative paths", async () => {
    const storage = await seeded();
    const tenant = scopedStorage(storage, "tenants/42");

    const uploaded = await tenant.upload("docs/x.txt", "x");
    expect(uploaded.path).toBe("docs/x.txt");
    expect(await storage.exists("tenants/42/docs/x.txt")).toBe(true);
    expect(await tenant.exists("docs/x.txt")).toBe(true);
    expect(await (await tenant.download("docs/x.txt")).text()).toBe("x");
    expect((await tenant.stat("docs/x.txt")).path).toBe("docs/x.txt");

    const copied = await tenant.copy("docs/x.txt", "docs/y.txt");
    expect(copied.destination).toBe("docs/y.txt");
    const moved = await tenant.move("docs/y.txt", "z.txt");
    expect(moved).toMatchObject({ source: "docs/y.txt", destination: "z.txt" });

    const page = await tenant.list();
    expect(page.files.map((f) => f.path)).toEqual(["z.txt"]);
    expect(page.directories).toEqual(["docs/"]);

    const all: string[] = [];
    for await (const file of tenant.iterate()) all.push(file.path);
    expect(all.toSorted()).toEqual(["docs/x.txt", "z.txt"]);

    const removed = await tenant.deleteMany(["z.txt"]);
    expect(removed.deleted).toEqual(["z.txt"]);
    await tenant.delete("docs/x.txt");
    expect(await listAll(storage, "tenants/")).toEqual([]);
    expect(await storage.exists("a/1.txt")).toBe(true);
  });

  it("rejects traversal out of the scope", async () => {
    const tenant = scopedStorage(await seeded(), "tenants/42");
    await expect(tenant.download("../../a/1.txt")).rejects.toBeInstanceOf(StorageInvalidPathError);
  });
});
