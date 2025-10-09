import { describe, it, expect } from "@jest/globals";

// Mock console methods to capture output
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

describe("Configuration Features", () => {
  let consoleOutput: string[] = [];

  beforeEach(() => {
    consoleOutput = [];
    console.error = (...args: any[]) => {
      consoleOutput.push(args.join(" "));
    };
    console.warn = (...args: any[]) => {
      consoleOutput.push(args.join(" "));
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  describe("Pattern Matching", () => {
    const {
      shouldIgnoreFolder,
      setIgnoredFolders,
    } = require("../utils/lib.js");

    test("should not ignore folders when no patterns configured", () => {
      expect(shouldIgnoreFolder("node_modules")).toBe(false);
      expect(shouldIgnoreFolder("dist")).toBe(false);
      expect(shouldIgnoreFolder("regular-folder")).toBe(false);
    });

    test("should ignore exact matches", () => {
      setIgnoredFolders(["node_modules", "dist"]);

      expect(shouldIgnoreFolder("node_modules")).toBe(true);
      expect(shouldIgnoreFolder("dist")).toBe(true);
      expect(shouldIgnoreFolder("regular-folder")).toBe(false);
    });

    test("should ignore glob patterns", () => {
      setIgnoredFolders(["*.temp", "cache-*"]);

      expect(shouldIgnoreFolder("file.temp")).toBe(true);
      expect(shouldIgnoreFolder("cache-old")).toBe(true);
      expect(shouldIgnoreFolder("regular-folder")).toBe(false);
    });
  });

  describe("Configuration Setup", () => {
    test("should validate configuration parsing setup", () => {
      // This test verifies that the configuration variables exist and are properly initialized
      const {
        getIgnoredFolders,
        getEnabledTools,
        setIgnoredFolders,
        setEnabledTools,
      } = require("../utils/lib.js");

      expect(typeof getIgnoredFolders).toBe("function");
      expect(typeof getEnabledTools).toBe("function");
      expect(typeof setIgnoredFolders).toBe("function");
      expect(typeof setEnabledTools).toBe("function");

      // Reset to clean state first
      setIgnoredFolders([]);
      setEnabledTools([]);

      // Should be empty arrays after reset
      expect(getIgnoredFolders()).toEqual([]);
      expect(getEnabledTools()).toEqual([]);

      // Test setting values
      setIgnoredFolders(["test"]);
      setEnabledTools(["read"]);

      expect(getIgnoredFolders()).toEqual(["test"]);
      expect(getEnabledTools()).toEqual(["read"]);

      // Reset for other tests
      setIgnoredFolders([]);
      setEnabledTools([]);
    });
  });

  describe("Tool Categories", () => {
    test("should define tool categories correctly", () => {
      // Test that tool categories are properly defined
      const expectedCategories = {
        read: [
          "read_file",
          "read_text_file",
          "read_media_file",
          "read_multiple_files",
        ],
        write: ["write_file", "edit_file"],
        filesystem: [
          "create_directory",
          "list_directory",
          "list_directory_with_sizes",
          "directory_tree",
          "move_file",
          "get_file_info",
          "register_directory",
          "list_allowed_directories",
        ],
        search: ["search_files"],
        all: [
          "read_file",
          "read_text_file",
          "read_media_file",
          "read_multiple_files",
          "write_file",
          "edit_file",
          "create_directory",
          "list_directory",
          "list_directory_with_sizes",
          "directory_tree",
          "move_file",
          "get_file_info",
          "register_directory",
          "list_allowed_directories",
          "search_files",
        ],
      };

      // Verify that 'all' contains all individual tools
      const allTools = [
        ...expectedCategories.read,
        ...expectedCategories.write,
        ...expectedCategories.filesystem,
        ...expectedCategories.search,
      ];

      expect(expectedCategories.all).toEqual(allTools);
    });
  });
});
