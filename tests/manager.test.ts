import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createStorageManager } from "../src/manager";

describe("createStorageManager", () => {
  const root = path.join(tmpdir(), "storagekit-manager-test-");

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lazily creates named disks and rejects unknown names", async () => {
    const dir = await mkdtemp(root);
    const manager = createStorageManager({
      default: "uploads",
      disks: {
        uploads: { type: "local", root: path.join(dir, "uploads") },
        temp: { type: "local", root: path.join(dir, "temp") },
      },
    });

    const uploads = await manager.disk("uploads");
    expect(await manager.disk("uploads")).toBe(uploads); // same instance
    expect(manager.diskNames()).toEqual(["uploads", "temp"]);
    expect(manager.defaultDiskName()).toBe("uploads");
    expect(await manager.defaultDisk()).toBe(uploads);
    await expect(manager.disk("nope" as "uploads")).rejects.toThrow(/Unknown storage disk/);
  });

  it("warmup creates every configured disk up front", async () => {
    const dir = await mkdtemp(root);
    const manager = createStorageManager({
      default: "a",
      disks: {
        a: { type: "local", root: path.join(dir, "a") },
        b: { type: "local", root: path.join(dir, "b") },
      },
    });

    await manager.warmup();
    // After warmup, every disk is usable immediately (directories created on write).
    await (await manager.disk("b")).upload("warm.txt", "warm");
    await expect((await (await manager.disk("b")).download("warm.txt")).text()).resolves.toBe(
      "warm",
    );
  });
});
