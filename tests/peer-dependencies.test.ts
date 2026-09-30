import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { createStorage } from "../src/factory";

/**
 * StorageKit must stay useful with zero provider SDKs installed: the local
 * driver and the fake work out of the box, and SDK-backed drivers load their
 * optional peer only when the storage is created — surfacing an install hint
 * if it is missing. The AWS SDK is stubbed out here to prove that path
 * deterministically.
 */
vi.mock("@aws-sdk/client-s3", () => {
  throw new Error("Cannot find package '@aws-sdk/client-s3'");
});
vi.mock("@aws-sdk/lib-storage", () => {
  throw new Error("Cannot find package '@aws-sdk/lib-storage'");
});
vi.mock("@aws-sdk/s3-request-presigner", () => {
  throw new Error("Cannot find package '@aws-sdk/s3-request-presigner'");
});

describe("optional peer dependencies", () => {
  const root = path.join(tmpdir(), "storagekit-peer-test-");

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores files with the local driver and no SDK installed", async () => {
    const dir = await mkdtemp(root);
    const storage = await createStorage({ type: "local", root: dir });
    await storage.upload("greetings/hello.txt", "hello world");
    expect(await storage.exists("greetings/hello.txt")).toBe(true);
    await storage.delete("greetings/hello.txt");
    expect(await storage.exists("greetings/hello.txt")).toBe(false);
  });

  it("hints at the install command when an SDK-backed driver cannot load its peer", async () => {
    await expect(
      createStorage({ type: "s3", bucket: "bucket", region: "us-east-1" }),
    ).rejects.toThrow(/npm install @aws-sdk\/client-s3/);
  });
});
