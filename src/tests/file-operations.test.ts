import fs from "fs/promises";
import path from "path";
import { handleFileSystemTool } from "../tools/filesystem-tools.js";
import { setAllowedDirectories, getAllowedDirectories } from "../utils/lib.js";

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

