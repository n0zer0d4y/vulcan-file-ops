import fs from "fs/promises";
import { realpathSync } from "fs";
import os from "os";
import path from "path";
import { handleFileSystemTool } from "../tools/filesystem-tools.js";
import {
  setAllowedDirectories,
  getAllowedDirectories,
  validatePath,
} from "../utils/lib.js";

// Mock the validatePath function to allow our test paths
jest.mock("../utils/lib.js", () => {
  const originalModule = jest.requireActual("../utils/lib.js");
  return {
    ...originalModule,
    validatePath: jest.fn(async (path: string) => path),
  };
});

describe("file_operations tool", () => {
  const testDir = path.join(process.cwd(), "test-files");
  const sourceDir = path.join(testDir, "source");
  const destDir = path.join(testDir, "dest");

  beforeAll(async () => {
    // Register test directory
    const currentDirs = getAllowedDirectories();
    setAllowedDirectories([...currentDirs, testDir]);

    // Create test directories and files
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "test1.txt"), "content1");
    await fs.writeFile(path.join(sourceDir, "test2.txt"), "content2");
  });

  afterAll(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test("should copy files successfully", async () => {
    const args = {
      operation: "copy",
      files: [
        {
          source: path.join(sourceDir, "test1.txt"),
          destination: path.join(destDir, "copied1.txt"),
        },
        {
          source: path.join(sourceDir, "test2.txt"),
          destination: path.join(destDir, "copied2.txt"),
        },
      ],
      onConflict: "error",
    };

    const result = await handleFileSystemTool("file_operations", args);

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");

    const responseText = result.content[0].text;
    expect(responseText).toContain("Successfully performed copy operations");
    expect(responseText).toContain("Total operations: 2");
    expect(responseText).toContain("Successful: 2");
    expect(responseText).toContain("Failed: 0");

    // Verify files were copied
    const copied1 = await fs.readFile(
      path.join(destDir, "copied1.txt"),
      "utf-8"
    );
    const copied2 = await fs.readFile(
      path.join(destDir, "copied2.txt"),
      "utf-8"
    );
    expect(copied1).toBe("content1");
    expect(copied2).toBe("content2");
  });

  test("should move files successfully", async () => {
    // Create files to move
    await fs.writeFile(path.join(sourceDir, "move1.txt"), "movecontent1");
    await fs.writeFile(path.join(sourceDir, "move2.txt"), "movecontent2");

    const args = {
      operation: "move",
      files: [
        {
          source: path.join(sourceDir, "move1.txt"),
          destination: path.join(destDir, "moved1.txt"),
        },
        {
          source: path.join(sourceDir, "move2.txt"),
          destination: path.join(destDir, "moved2.txt"),
        },
      ],
      onConflict: "error",
    };

    const result = await handleFileSystemTool("file_operations", args);

    expect(result).toBeDefined();
    expect(result.content[0].text).toContain(
      "Successfully performed move operations"
    );
    expect(result.content[0].text).toContain("Total operations: 2");
    expect(result.content[0].text).toContain("Successful: 2");

    // Verify files were moved (not copied)
    const moved1 = await fs.readFile(path.join(destDir, "moved1.txt"), "utf-8");
    const moved2 = await fs.readFile(path.join(destDir, "moved2.txt"), "utf-8");
    expect(moved1).toBe("movecontent1");
    expect(moved2).toBe("movecontent2");

    // Verify source files are gone
    await expect(
      fs.access(path.join(sourceDir, "move1.txt"))
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(sourceDir, "move2.txt"))
    ).rejects.toThrow();
  });

  test("should handle conflict resolution", async () => {
    // Create a file that will conflict
    await fs.writeFile(path.join(destDir, "conflict.txt"), "existing");

    const args = {
      operation: "copy",
      files: [
        {
          source: path.join(sourceDir, "test1.txt"),
          destination: path.join(destDir, "conflict.txt"),
        },
      ],
      onConflict: "skip",
    };

    const result = await handleFileSystemTool("file_operations", args);

    expect(result.content[0].text).toContain(
      "Successfully performed copy operations"
    );
    expect(result.content[0].text).toContain("Total operations: 0"); // Skipped due to conflict

    // Verify original file is unchanged
    const content = await fs.readFile(
      path.join(destDir, "conflict.txt"),
      "utf-8"
    );
    expect(content).toBe("existing");
  });

  test("should validate schema", async () => {
    const invalidArgs = {
      operation: "invalid_operation",
      files: [],
    };

    await expect(
      handleFileSystemTool("file_operations", invalidArgs)
    ).rejects.toThrow();
  });
});

describe("file_operations copy: symbolic links (VFO-09)", () => {
  const actualLib = jest.requireActual("../utils/lib.js") as {
    validatePath: (p: string) => Promise<string>;
  };
  const mockedValidatePath = validatePath as unknown as jest.Mock;
  const linkType = process.platform === "win32" ? "junction" : "dir";

  let previousAllowed: string[];
  let allowedRoot: string;
  let outsideDir: string;
  let srcDir: string;

  async function tryDirLink(target: string, link: string): Promise<boolean> {
    try {
      await fs.symlink(target, link, linkType);
      return true;
    } catch {
      console.warn(`Skipping: could not create ${linkType} at ${link}`);
      return false;
    }
  }

  async function tryFileSymlink(target: string, link: string): Promise<boolean> {
    try {
      await fs.symlink(target, link, "file");
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // File symlinks need admin or Developer Mode on Windows
      if (code === "EPERM" || code === "EACCES") {
        console.warn("Skipping: file symlinks not permitted on this host");
        return false;
      }
      throw error;
    }
  }

  async function exists(p: string): Promise<boolean> {
    try {
      await fs.lstat(p);
      return true;
    } catch {
      return false;
    }
  }

  function copyArgs(source: string, destination: string, onConflict = "error") {
    return {
      operation: "copy",
      files: [{ source, destination }],
      onConflict,
    };
  }

  beforeEach(async () => {
    // Use the real, symlink-aware validatePath for these tests
    mockedValidatePath.mockImplementation((p: unknown) =>
      actualLib.validatePath(p as string)
    );

    previousAllowed = getAllowedDirectories();
    allowedRoot = realpathSync(
      await fs.mkdtemp(path.join(os.tmpdir(), "copy-symlink-allowed-"))
    );
    outsideDir = realpathSync(
      await fs.mkdtemp(path.join(os.tmpdir(), "copy-symlink-outside-"))
    );
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "TOP SECRET");
    setAllowedDirectories([allowedRoot]);

    srcDir = path.join(allowedRoot, "src");
    await fs.mkdir(path.join(srcDir, "nested"), { recursive: true });
    await fs.writeFile(path.join(srcDir, "a.txt"), "A");
    await fs.writeFile(path.join(srcDir, "nested", "b.txt"), "B");
  });

  afterEach(async () => {
    mockedValidatePath.mockImplementation(async (p: unknown) => p);
    setAllowedDirectories(previousAllowed);
    // Remove links before recursive deletion so nothing outside is touched
    const removeLinks = async (dir: string): Promise<void> => {
      let entries: import("fs").Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        const stats = await fs.lstat(p);
        if (stats.isSymbolicLink()) {
          await fs.unlink(p).catch(() => fs.rmdir(p).catch(() => {}));
        } else if (stats.isDirectory()) {
          await removeLinks(p);
        }
      }
    };
    await removeLinks(allowedRoot);
    await fs.rm(allowedRoot, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  test("copies a normal directory tree", async () => {
    const dest = path.join(allowedRoot, "copy");

    const result = await handleFileSystemTool(
      "file_operations",
      copyArgs(srcDir, dest)
    );

    expect(result.content[0].text).toContain("Successful: 1");
    expect(result.content[0].text).toContain("Failed: 0");
    expect(await fs.readFile(path.join(dest, "a.txt"), "utf-8")).toBe("A");
    expect(
      await fs.readFile(path.join(dest, "nested", "b.txt"), "utf-8")
    ).toBe("B");
  });

  test("refuses a directory containing a directory link pointing outside", async () => {
    if (!(await tryDirLink(outsideDir, path.join(srcDir, "nested", "escape")))) {
      return;
    }
    const dest = path.join(allowedRoot, "copy");

    const result = await handleFileSystemTool(
      "file_operations",
      copyArgs(srcDir, dest)
    );
    const text = result.content[0].text;

    expect(text).toContain("Failed: 1");
    expect(text).toContain("Refusing to copy symbolic link inside directory");
    expect(text).toContain(path.join(srcDir, "nested", "escape"));
    // The whole tree is validated first, so nothing was created
    expect(await exists(dest)).toBe(false);
  });

  test("refuses a directory link even when it points inside the sandbox", async () => {
    const innerTarget = path.join(allowedRoot, "inner-target");
    await fs.mkdir(innerTarget);
    if (!(await tryDirLink(innerTarget, path.join(srcDir, "inner-link")))) {
      return;
    }
    const dest = path.join(allowedRoot, "copy");

    const result = await handleFileSystemTool(
      "file_operations",
      copyArgs(srcDir, dest)
    );

    expect(result.content[0].text).toContain("Failed: 1");
    expect(result.content[0].text).toContain(
      "symbolic links are not copied for security reasons"
    );
    expect(await exists(dest)).toBe(false);
  });

  test("refuses a directory containing a file symlink (POSIX / privileged Windows)", async () => {
    if (
      !(await tryFileSymlink(
        path.join(outsideDir, "secret.txt"),
        path.join(srcDir, "nested", "s.txt")
      ))
    ) {
      return;
    }
    const dest = path.join(allowedRoot, "copy");

    const result = await handleFileSystemTool(
      "file_operations",
      copyArgs(srcDir, dest)
    );

    expect(result.content[0].text).toContain("Failed: 1");
    expect(result.content[0].text).toContain(
      "Refusing to copy symbolic link inside directory"
    );
    expect(await exists(dest)).toBe(false);
    expect(await exists(path.join(dest, "nested", "s.txt"))).toBe(false);
  });

  test("still copies sibling sources in the same batch", async () => {
    const badSrc = path.join(allowedRoot, "bad-src");
    await fs.mkdir(badSrc);
    if (!(await tryDirLink(outsideDir, path.join(badSrc, "escape")))) {
      return;
    }
    const goodDest = path.join(allowedRoot, "good-copy");
    const badDest = path.join(allowedRoot, "bad-copy");

    const result = await handleFileSystemTool("file_operations", {
      operation: "copy",
      files: [
        { source: srcDir, destination: goodDest },
        { source: badSrc, destination: badDest },
      ],
      onConflict: "error",
    });

    expect(result.content[0].text).toContain("Successful: 1");
    expect(result.content[0].text).toContain("Failed: 1");
    expect(await exists(path.join(goodDest, "a.txt"))).toBe(true);
    expect(await exists(badDest)).toBe(false);
  });

  test("rejects a top-level source that is a link pointing outside", async () => {
    const topLink = path.join(allowedRoot, "top-link");
    if (!(await tryDirLink(outsideDir, topLink))) {
      return;
    }

    await expect(
      handleFileSystemTool(
        "file_operations",
        copyArgs(topLink, path.join(allowedRoot, "copy"))
      )
    ).rejects.toThrow("Path validation failed");
    expect(await exists(path.join(allowedRoot, "copy"))).toBe(false);
  });

  test("copies the real target of a top-level link that stays inside", async () => {
    const topLink = path.join(allowedRoot, "top-link");
    if (!(await tryDirLink(srcDir, topLink))) {
      return;
    }
    const dest = path.join(allowedRoot, "copy");

    const result = await handleFileSystemTool(
      "file_operations",
      copyArgs(topLink, dest)
    );

    expect(result.content[0].text).toContain("Successful: 1");
    expect((await fs.lstat(dest)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(dest, "a.txt"), "utf-8")).toBe("A");
  });

  test("does not write through a link that already exists at the destination", async () => {
    const dest = path.join(allowedRoot, "copy");
    await fs.mkdir(dest);
    // dest/nested is a link to the outside directory
    if (!(await tryDirLink(outsideDir, path.join(dest, "nested")))) {
      return;
    }

    const result = await handleFileSystemTool(
      "file_operations",
      copyArgs(srcDir, dest, "overwrite")
    );

    expect(result.content[0].text).toContain("Failed: 1");
    expect(result.content[0].text).toContain("Access denied");
    expect(await exists(path.join(outsideDir, "b.txt"))).toBe(false);
  });

  test("refuses to copy a directory into itself", async () => {
    const result = await handleFileSystemTool(
      "file_operations",
      copyArgs(srcDir, path.join(srcDir, "nested", "self-copy"))
    );

    expect(result.content[0].text).toContain("Failed: 1");
    expect(result.content[0].text).toContain(
      "Cannot copy a directory into itself"
    );
    expect(await exists(path.join(srcDir, "nested", "self-copy"))).toBe(false);
  });
});
