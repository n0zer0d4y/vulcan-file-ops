/**
 * register_directory consent policy (audit VFO-07)
 *
 * The model must not be able to widen its own sandbox without the user.
 * Default policy is "confirm": the server asks the human through the MCP
 * client (elicitation) via the consent handler installed by server/index.ts.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs/promises";
import { realpathSync } from "fs";
import * as os from "os";
import * as path from "path";
import {
  handleFileSystemTool,
  getFileSystemTools,
  setRuntimeRegistrationPolicy,
  getRuntimeRegistrationPolicy,
  setDirectoryRegistrationConsentHandler,
  isRuntimeRegistrationPolicy,
  type DirectoryRegistrationConsent,
} from "../tools/filesystem-tools.js";
import { setAllowedDirectories, getAllowedDirectories } from "../utils/lib.js";

describe("register_directory consent policy (VFO-07)", () => {
  let allowedDir: string;
  let candidateDir: string;
  let previousAllowed: string[];
  let previousPolicy: ReturnType<typeof getRuntimeRegistrationPolicy>;

  function consentHandler(answer: DirectoryRegistrationConsent) {
    const handler = jest.fn(async (_realPath: string) => answer);
    setDirectoryRegistrationConsentHandler(handler);
    return handler;
  }

  function register(p: string) {
    return handleFileSystemTool("register_directory", { path: p });
  }

  beforeEach(async () => {
    previousAllowed = getAllowedDirectories();
    previousPolicy = getRuntimeRegistrationPolicy();
    allowedDir = realpathSync(
      await fs.mkdtemp(path.join(os.tmpdir(), "register-allowed-"))
    );
    candidateDir = realpathSync(
      await fs.mkdtemp(path.join(os.tmpdir(), "register-candidate-"))
    );
    setAllowedDirectories([allowedDir]);
    setRuntimeRegistrationPolicy("confirm");
    setDirectoryRegistrationConsentHandler(null);
  });

  afterEach(async () => {
    setDirectoryRegistrationConsentHandler(null);
    setRuntimeRegistrationPolicy(previousPolicy);
    setAllowedDirectories(previousAllowed);
    const link = path.join(allowedDir, "link-to-candidate");
    await fs.unlink(link).catch(() => fs.rmdir(link).catch(() => {}));
    await fs.rm(allowedDir, { recursive: true, force: true });
    await fs.rm(candidateDir, { recursive: true, force: true });
  });

  describe("policy configuration", () => {
    it("defaults to confirm", async () => {
      // Fresh module instance to observe the real default
      await jest.isolateModulesAsync(async () => {
        const fresh = await import("../tools/filesystem-tools.js");
        expect(fresh.getRuntimeRegistrationPolicy()).toBe("confirm");
      });
    });

    it("validates policy values", () => {
      expect(isRuntimeRegistrationPolicy("confirm")).toBe(true);
      expect(isRuntimeRegistrationPolicy("allow")).toBe(true);
      expect(isRuntimeRegistrationPolicy("deny")).toBe(true);
      expect(isRuntimeRegistrationPolicy("yes")).toBe(false);
      expect(() => setRuntimeRegistrationPolicy("yes" as any)).toThrow(
        "Invalid runtime registration policy"
      );
    });

    it("tool description mentions user confirmation and keeps approved-folders text", () => {
      const tool = getFileSystemTools().find(
        (t) => t.name === "register_directory"
      )!;
      expect(tool.description).toContain("user must confirm");
      expect(tool.description).toContain("PRE-APPROVED DIRECTORIES");
      expect(tool.description).toContain(allowedDir);
    });
  });

  describe("confirm (default)", () => {
    it("registers the real path when the user accepts", async () => {
      const handler = consentHandler("accepted");

      const result = await register(candidateDir);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(candidateDir);
      expect(result.content[0].text).toContain(
        "Successfully registered directory"
      );
      expect(getAllowedDirectories()).toContain(candidateDir);
    });

    it("refuses when the user declines", async () => {
      consentHandler("declined");

      await expect(register(candidateDir)).rejects.toThrow(
        `User declined access to ${candidateDir}`
      );
      expect(getAllowedDirectories()).toEqual([allowedDir]);
    });

    it("refuses with an actionable message when the client cannot prompt", async () => {
      consentHandler("unsupported");

      const error = await register(candidateDir).catch((e: Error) => e);

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("does not support confirmation prompts");
      expect(message).toContain("MCP elicitation");
      expect(message).toContain("--approved-folders");
      expect(message).toContain("--runtime-registration allow");
      expect(getAllowedDirectories()).toEqual([allowedDir]);
    });

    it("treats a missing consent handler as unsupported", async () => {
      await expect(register(candidateDir)).rejects.toThrow(
        "does not support confirmation prompts"
      );
      expect(getAllowedDirectories()).toEqual([allowedDir]);
    });

    it("does not prompt for a directory that is already accessible", async () => {
      const handler = consentHandler("declined");
      const sub = path.join(allowedDir, "sub");
      await fs.mkdir(sub);

      const exact = await register(allowedDir);
      const nested = await register(sub);

      expect(exact.content[0].text).toContain("Directory already registered");
      expect(nested.content[0].text).toContain("Directory already accessible");
      expect(handler).not.toHaveBeenCalled();
      expect(getAllowedDirectories()).toEqual([allowedDir]);
    });

    it("prompts with, and stores, the real target of a symlink/junction", async () => {
      const link = path.join(allowedDir, "link-to-candidate");
      try {
        await fs.symlink(
          candidateDir,
          link,
          process.platform === "win32" ? "junction" : "dir"
        );
      } catch {
        console.warn("Skipping: could not create directory link");
        return;
      }
      const handler = consentHandler("accepted");

      const result = await register(link);

      expect(handler).toHaveBeenCalledWith(candidateDir);
      expect(result.content[0].text).toContain(`(${candidateDir})`);
      expect(getAllowedDirectories()).toContain(candidateDir);
      expect(getAllowedDirectories()).not.toContain(link);
    });

    it("refuses a filesystem root without prompting", async () => {
      const handler = consentHandler("accepted");
      const root = path.parse(candidateDir).root;

      await expect(register(root)).rejects.toThrow("a filesystem root");
      expect(handler).not.toHaveBeenCalled();
      expect(getAllowedDirectories()).toEqual([allowedDir]);
    });

    it("refuses the user's home directory without prompting", async () => {
      const handler = consentHandler("accepted");

      await expect(register(os.homedir())).rejects.toThrow(
        "the user's home directory"
      );
      await expect(register("~")).rejects.toThrow("the user's home directory");
      expect(handler).not.toHaveBeenCalled();
      expect(getAllowedDirectories()).toEqual([allowedDir]);
    });

    it("still rejects non-existent paths and files", async () => {
      consentHandler("accepted");
      const file = path.join(candidateDir, "file.txt");
      await fs.writeFile(file, "x");

      await expect(
        register(path.join(candidateDir, "missing"))
      ).rejects.toThrow("does not exist");
      await expect(register(file)).rejects.toThrow("is not a directory");
    });
  });

  describe("deny", () => {
    it("refuses registration and points to --approved-folders", async () => {
      setRuntimeRegistrationPolicy("deny");
      const handler = consentHandler("accepted");

      await expect(register(candidateDir)).rejects.toThrow("--approved-folders");
      expect(handler).not.toHaveBeenCalled();
      expect(getAllowedDirectories()).toEqual([allowedDir]);
    });

    it("still reports already-accessible directories", async () => {
      setRuntimeRegistrationPolicy("deny");

      const result = await register(allowedDir);

      expect(result.content[0].text).toContain("Directory already registered");
    });
  });

  describe("allow", () => {
    beforeEach(() => {
      setRuntimeRegistrationPolicy("allow");
    });

    it("registers without prompting", async () => {
      const handler = consentHandler("declined");

      const result = await register(candidateDir);

      expect(result.content[0].text).toContain(
        "Successfully registered directory"
      );
      expect(handler).not.toHaveBeenCalled();
      expect(getAllowedDirectories()).toContain(candidateDir);
    });

    it("permits the home directory", async () => {
      const home = realpathSync(os.homedir());

      await register(home);

      expect(getAllowedDirectories().map((d) => d.toLowerCase())).toContain(
        home.toLowerCase()
      );
    });

    it("permits a filesystem root", async () => {
      const root = path.parse(candidateDir).root;

      const result = await register(root);

      expect(result.content[0].text).toContain(
        "Successfully registered directory"
      );
      expect(getAllowedDirectories().length).toBe(2);
    });
  });
});
