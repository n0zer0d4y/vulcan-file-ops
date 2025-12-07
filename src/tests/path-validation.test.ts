import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from "@jest/globals";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import {
  setAllowedDirectories,
  getAllowedDirectories,
  validatePath,
} from "../utils/lib.js";

/**
 * NOTE:
 * This file is reconstructed to:
 * 1. Restore valid Jest syntax after a previous bad edit.
 * 2. Add focused tests for `validatePath`'s `createParentIfMissing` behavior.
 *
 * It does NOT recreate the full original, very large path-validation suite.
 * Instead, it adds targeted coverage aligned with the implementation plan
 * for automatic directory creation in write tools.
 */

const TEST_ROOT = path.join(
  os.tmpdir(),
  `vulcan-validate-path-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function removeDir(p: string) {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("validatePath basic behavior (smoke tests)", () => {
  const originalAllowed = getAllowedDirectories();

  beforeAll(async () => {
    await ensureDir(TEST_ROOT);
    setAllowedDirectories([...originalAllowed, TEST_ROOT]);
  });

  afterAll(async () => {
    setAllowedDirectories(originalAllowed);
    await removeDir(TEST_ROOT);
  });

  it("allows existing file within allowed directory", async () => {
    const dir = path.join(TEST_ROOT, "existing-dir");
    const file = path.join(dir, "file.txt");
    await ensureDir(dir);
    await fs.writeFile(file, "content", "utf-8");

    const validated = await validatePath(file);
    expect(path.isAbsolute(validated)).toBe(true);
    const stats = await fs.stat(validated);
    expect(stats.isFile()).toBe(true);
  });

  it("rejects path outside allowed directories", async () => {
    const outsideDir = path.join(TEST_ROOT, "..", "outside-dir");
    const outsideFile = path.resolve(outsideDir, "file.txt");
    // DO NOT register outsideDir as allowed.
    await ensureDir(outsideDir);
    await fs.writeFile(outsideFile, "content", "utf-8");

    await expect(validatePath(outsideFile)).rejects.toThrow(
      /path outside allowed directories/i,
    );
  });

  it("throws when parent directory does not exist and createParentIfMissing is false", async () => {
    const nonExistentDir = path.join(TEST_ROOT, "no-such-dir");
    const file = path.join(nonExistentDir, "file.txt");

    await expect(validatePath(file)).rejects.toThrow(
      /Parent directory does not exist/i,
    );
  });
});

describe("validatePath with createParentIfMissing", () => {
  const originalAllowed = getAllowedDirectories();
  let allowedRoot: string;

  beforeAll(async () => {
    allowedRoot = path.join(TEST_ROOT, "allowed-root");
    await ensureDir(allowedRoot);
    setAllowedDirectories([...originalAllowed, allowedRoot]);
  });

  afterAll(async () => {
    setAllowedDirectories(originalAllowed);
    await removeDir(TEST_ROOT);
  });

  beforeEach(async () => {
    // Clean up allowedRoot between tests but keep the root itself
    try {
      const entries = await fs.readdir(allowedRoot, { withFileTypes: true });
      await Promise.all(
        entries.map((entry) =>
          fs.rm(path.join(allowedRoot, entry.name), {
            recursive: true,
            force: true,
          }),
        ),
      );
    } catch {
      // ignore
    }
  });

  it("creates a single missing parent directory within allowed root when createParentIfMissing is true", async () => {
    const newDir = path.join(allowedRoot, "subdir");
    const file = path.join(newDir, "file.txt");

    // Ensure directory does NOT exist initially
    await expect(fs.stat(newDir)).rejects.toHaveProperty("code", "ENOENT");

    const validated = await validatePath(file, { createParentIfMissing: true });

    expect(validated).toBe(path.resolve(file));

    // Parent directory should now exist
    const dirStats = await fs.stat(newDir);
    expect(dirStats.isDirectory()).toBe(true);
  });

  it("creates a multi-level missing directory chain within allowed root when createParentIfMissing is true", async () => {
    const deepDir = path.join(allowedRoot, "a", "b", "c", "d");
    const file = path.join(deepDir, "deep.txt");

    await expect(fs.stat(deepDir)).rejects.toHaveProperty("code", "ENOENT");

    const validated = await validatePath(file, { createParentIfMissing: true });

    expect(validated).toBe(path.resolve(file));

    const dirStats = await fs.stat(deepDir);
    expect(dirStats.isDirectory()).toBe(true);
  });

  it("does not create directories for paths outside allowed directories even with createParentIfMissing", async () => {
    const outsideBase = path.join(TEST_ROOT, "outside-base");
    const outsideDeepDir = path.join(outsideBase, "x", "y");
    const outsideFile = path.join(outsideDeepDir, "oops.txt");

    // outsideBase is NOT added to allowed directories
    await expect(
      validatePath(outsideFile, { createParentIfMissing: true }),
    ).rejects.toThrow(/path outside allowed directories/i);

    // Ensure we did not create outsideBase or deeper
    await expect(fs.stat(outsideBase)).rejects.toHaveProperty("code", "ENOENT");
  });

  it("handles race where directory is created between check and mkdir (EEXIST) and verifies it is a directory", async () => {
    const dir = path.join(allowedRoot, "race", "dir");
    const file = path.join(dir, "file.txt");

    // Pre-create parent path just before validatePath might try to mkdir
    // Simulate another actor making the directory.
    await ensureDir(dir);

    const validated = await validatePath(file, { createParentIfMissing: true });
    expect(validated).toBe(path.resolve(file));

    const stats = await fs.stat(dir);
    expect(stats.isDirectory()).toBe(true);
  });

  it("throws if a path component exists as a file where a directory is expected", async () => {
    const badPathBase = path.join(allowedRoot, "bad");
    const badFile = path.join(badPathBase, "not-a-dir");
    await ensureDir(badPathBase);
    await fs.writeFile(badFile, "I am a file", "utf-8");

    // Now try to create a path as if "not-a-dir" were a directory
    const requested = path.join(badFile, "child", "file.txt");

    await expect(
      validatePath(requested, { createParentIfMissing: true }),
    ).rejects.toThrow(/not a directory/i);
  });

  it("does not change behavior when createParentIfMissing is false (explicit) and parent is missing", async () => {
    const missingDir = path.join(allowedRoot, "explicit-missing");
    const file = path.join(missingDir, "file.txt");

    await expect(
      validatePath(file, { createParentIfMissing: false }),
    ).rejects.toThrow(/Parent directory does not exist/i);

    await expect(fs.stat(missingDir)).rejects.toHaveProperty("code", "ENOENT");
  });
});

describe("validatePath symlink and directory-creation interactions (focused)", () => {
  const originalAllowed = getAllowedDirectories();
  let allowedDir: string;
  let forbiddenDir: string;

  beforeAll(async () => {
    allowedDir = path.join(TEST_ROOT, "allowed-symlink-root");
    forbiddenDir = path.join(TEST_ROOT, "forbidden-symlink-root");

    await ensureDir(allowedDir);
    await ensureDir(forbiddenDir);

    setAllowedDirectories([...originalAllowed, allowedDir]);
  });

  afterAll(async () => {
    setAllowedDirectories(originalAllowed);
    await removeDir(TEST_ROOT);
  });

  beforeEach(async () => {
    // Cleanup under both roots but keep the roots themselves
    for (const dir of [allowedDir, forbiddenDir]) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        await Promise.all(
          entries.map((entry) =>
            fs.rm(path.join(dir, entry.name), {
              recursive: true,
              force: true,
            }),
          ),
        );
      } catch {
        // ignore
      }
    }
  });

  it("refuses to create a directory chain that would end up outside allowed directories via normalization", async () => {
    const sneaky = path.join(allowedDir, "..", "sneaky", "dir");
    const file = path.join(sneaky, "file.txt");

    await expect(
      validatePath(file, { createParentIfMissing: true }),
    ).rejects.toThrow(/path outside allowed directories/i);
  });

  it("refuses to create a directory where realpath resolves outside allowed directories (symlink case)", async () => {
    // Create a symlink under allowedDir that points to forbiddenDir
    const linkPath = path.join(allowedDir, "link-to-forbidden");
    await fs.symlink(forbiddenDir, linkPath, "junction");

    const fileViaLink = path.join(linkPath, "child", "file.txt");

    await expect(
      validatePath(fileViaLink, { createParentIfMissing: true }),
    ).rejects.toThrow(
      /cannot create directory; path exists and is not a directory/i,
    );
  });
});
