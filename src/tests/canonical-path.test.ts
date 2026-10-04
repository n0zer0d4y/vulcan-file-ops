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
import { promises as fs, realpathSync } from "fs";
import {
  setAllowedDirectories,
  getAllowedDirectories,
  isPathCanonicallyAllowed,
  ensureDirectoryWithinAllowed,
  resolvePhysicalCanonicalPath,
  writeBinaryFileAtomic,
  writeFileContent,
} from "../utils/lib.js";

// Junctions need no elevated privileges on Windows; elsewhere use a dir symlink.
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

describe("canonical path containment helpers", () => {
  const originalAllowed = getAllowedDirectories();
  let root: string;
  let allowedDir: string;
  let outsideDir: string;
  let linkToOutside: string;

  beforeAll(async () => {
    root = realpathSync(
      await fs.mkdtemp(path.join(os.tmpdir(), "vulcan-canonical-")),
    );
    allowedDir = path.join(root, "allowed");
    outsideDir = path.join(root, "outside");
    await fs.mkdir(allowedDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "secret");
    linkToOutside = path.join(allowedDir, "link");
    await fs.symlink(outsideDir, linkToOutside, LINK_TYPE);
  });

  beforeEach(() => {
    setAllowedDirectories([allowedDir]);
  });

  afterAll(async () => {
    setAllowedDirectories(originalAllowed);
    await fs.rm(root, { recursive: true, force: true });
  });

  describe("isPathCanonicallyAllowed", () => {
    it("allows plain paths inside the allowed directory", async () => {
      await fs.writeFile(path.join(allowedDir, "a.txt"), "a");
      expect(await isPathCanonicallyAllowed("a.txt", allowedDir)).toBe(true);
      expect(
        await isPathCanonicallyAllowed(path.join(allowedDir, "a.txt"), root),
      ).toBe(true);
    });

    it("allows not-yet-existing paths inside the allowed directory", async () => {
      expect(
        await isPathCanonicallyAllowed("new/deep/file.txt", allowedDir),
      ).toBe(true);
    });

    it("denies lexical escapes", async () => {
      expect(
        await isPathCanonicallyAllowed("../outside/secret.txt", allowedDir),
      ).toBe(false);
    });

    it("denies paths that traverse a symlink/junction to outside (GH-3)", async () => {
      expect(
        await isPathCanonicallyAllowed("link/secret.txt", allowedDir),
      ).toBe(false);
      expect(
        await isPathCanonicallyAllowed("link/not-yet-created", allowedDir),
      ).toBe(false);
    });

    it("denies link/.. tricks that only escape under physical resolution", async () => {
      // POSIX kernels resolve `link` before applying `..`, landing in `root`.
      expect(
        await isPathCanonicallyAllowed("link/../outside/secret.txt", allowedDir),
      ).toBe(false);
    });

    it("denies everything when no directories are allowed", async () => {
      setAllowedDirectories([]);
      expect(await isPathCanonicallyAllowed("a.txt", allowedDir)).toBe(false);
    });

    it("denies null bytes", async () => {
      expect(await isPathCanonicallyAllowed("a\x00b", allowedDir)).toBe(false);
    });
  });

  describe("resolvePhysicalCanonicalPath", () => {
    it("follows the link before applying '..'", async () => {
      const resolved = await resolvePhysicalCanonicalPath(
        "link/..",
        allowedDir,
      );
      expect(resolved).toBe(realpathSync(root));
    });
  });

  describe("ensureDirectoryWithinAllowed", () => {
    it("creates nested directories inside the allowed directory", async () => {
      const target = path.join(allowedDir, "x", "y", "z");
      const real = await ensureDirectoryWithinAllowed(target);
      expect(real).toBe(target);
      expect((await fs.stat(target)).isDirectory()).toBe(true);
    });

    it("is idempotent for existing directories", async () => {
      const target = path.join(allowedDir, "exists");
      await fs.mkdir(target);
      await expect(ensureDirectoryWithinAllowed(target)).resolves.toBe(target);
    });

    it("refuses to create directories through a symlink/junction (GH-3)", async () => {
      const target = path.join(linkToOutside, "planted");
      await expect(ensureDirectoryWithinAllowed(target)).rejects.toThrow(
        /access denied/i,
      );
      await expect(fs.access(path.join(outsideDir, "planted"))).rejects.toThrow();
    });

    it("refuses lexical escapes", async () => {
      await expect(
        ensureDirectoryWithinAllowed(path.join(allowedDir, "..", "escaped")),
      ).rejects.toThrow(/access denied/i);
    });

    it("rejects a path that exists as a file", async () => {
      const file = path.join(allowedDir, "file-not-dir");
      await fs.writeFile(file, "x");
      await expect(ensureDirectoryWithinAllowed(file)).rejects.toThrow(
        /not a directory/i,
      );
    });
  });

  describe("atomic writes", () => {
    it("writeBinaryFileAtomic creates and replaces binary files", async () => {
      const target = path.join(allowedDir, "out.bin");
      await writeBinaryFileAtomic(target, Buffer.from([1, 2, 3]));
      await writeBinaryFileAtomic(target, Buffer.from([4, 5]));
      expect([...(await fs.readFile(target))]).toEqual([4, 5]);
    });

    it("replacing a symlinked target does not write through the link", async () => {
      if (process.platform === "win32") {
        // File symlinks need elevated privileges on Windows.
        return;
      }
      const outsideFile = path.join(outsideDir, "victim.txt");
      await fs.writeFile(outsideFile, "original");
      const linkFile = path.join(allowedDir, "victim-link.txt");
      await fs.symlink(outsideFile, linkFile);
      await writeFileContent(linkFile, "replaced");
      expect(await fs.readFile(outsideFile, "utf-8")).toBe("original");
    });
  });
});
