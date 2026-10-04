/**
 * End-to-end tests for server-level security configuration.
 *
 * src/server/index.ts uses import.meta and cannot be imported under Jest's
 * CommonJS transform, so these tests start the real server over stdio (via
 * the ts-node ESM loader) and talk to it with the MCP SDK client.
 *
 * Covered:
 * - VFO-07: register_directory consent via MCP elicitation and
 *   --runtime-registration
 */
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import { realpathSync } from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ElicitRequestSchema,
  type ElicitRequest,
  type ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";

jest.setTimeout(120_000);

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "src", "cli.ts");
const loaderUrl = pathToFileURL(
  path.join(repoRoot, "node_modules", "ts-node", "esm", "transpile-only.mjs")
).href;

function serverEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TS_NODE_PROJECT = path.join(repoRoot, "tsconfig.json");
  env.NODE_NO_WARNINGS = "1";
  return { ...env, ...extra };
}

interface StartOptions {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  onElicit?: (request: ElicitRequest) => ElicitResult | Promise<ElicitResult>;
}

async function startServer(options: StartOptions = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--loader", loaderUrl, cliPath, ...(options.args ?? [])],
    cwd: options.cwd ?? repoRoot,
    env: serverEnv(options.env),
    stderr: "pipe",
  });
  const client = new Client(
    { name: "vfo-e2e-test", version: "1.0.0" },
    { capabilities: options.onElicit ? { elicitation: {} } : {} }
  );
  if (options.onElicit) {
    const onElicit = options.onElicit;
    client.setRequestHandler(ElicitRequestSchema, async (request) =>
      onElicit(request)
    );
  }
  await client.connect(transport);
  return client;
}

function runCli(
  args: string[],
  cwd = repoRoot
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--loader", loaderUrl, cliPath, ...args], {
      cwd,
      env: serverEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end();
  });
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return { text: result.content[0]?.text ?? "", isError: !!result.isError };
}

describe("server e2e: register_directory consent (VFO-07)", () => {
  let approvedDir: string;
  let candidateDir: string;

  beforeAll(async () => {
    approvedDir = realpathSync(
      await fs.mkdtemp(path.join(os.tmpdir(), "e2e-approved-"))
    );
    candidateDir = realpathSync(
      await fs.mkdtemp(path.join(os.tmpdir(), "e2e-candidate-"))
    );
  });

  afterAll(async () => {
    await fs.rm(approvedDir, { recursive: true, force: true });
    await fs.rm(candidateDir, { recursive: true, force: true });
  });

  it("documents --runtime-registration in --help", async () => {
    const { code, stderr } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stderr).toContain("--runtime-registration <mode>");
  });

  it("rejects an invalid --runtime-registration value", async () => {
    const { code } = await runCli(["--runtime-registration", "sometimes"]);
    expect(code).toBe(1);
  });

  it("asks the user via elicitation and registers the real path on accept", async () => {
    const requests: ElicitRequest[] = [];
    const client = await startServer({
      args: ["--approved-folders", approvedDir],
      onElicit: (request) => {
        requests.push(request);
        return { action: "accept", content: { allow: true } };
      },
    });
    try {
      const result = await callTool(client, "register_directory", {
        path: candidateDir,
      });
      expect(result.isError).toBe(false);
      expect(result.text).toContain("Successfully registered directory");

      expect(requests).toHaveLength(1);
      expect(requests[0].params.message).toContain(candidateDir);
      expect(requests[0].params.requestedSchema.required).toEqual(["allow"]);

      const listed = await callTool(client, "list_allowed_directories");
      expect(listed.text).toContain(candidateDir);
    } finally {
      await client.close();
    }
  });

  it("refuses when the user declines, cancels, or accepts with allow=false", async () => {
    const answers: ElicitResult[] = [
      { action: "decline" },
      { action: "cancel" },
      { action: "accept", content: { allow: false } },
    ];
    let index = 0;
    const client = await startServer({
      args: ["--approved-folders", approvedDir],
      onElicit: () => answers[index++],
    });
    try {
      for (let i = 0; i < answers.length; i++) {
        const result = await callTool(client, "register_directory", {
          path: candidateDir,
        });
        expect(result.isError).toBe(true);
        expect(result.text).toContain("User declined access");
      }
      const listed = await callTool(client, "list_allowed_directories");
      expect(listed.text).not.toContain(candidateDir);
    } finally {
      await client.close();
    }
  });

  it("refuses with an actionable message when the client has no elicitation capability", async () => {
    const client = await startServer({
      args: ["--approved-folders", approvedDir],
    });
    try {
      const result = await callTool(client, "register_directory", {
        path: candidateDir,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("does not support confirmation prompts");
      expect(result.text).toContain("--approved-folders");
      expect(result.text).toContain("--runtime-registration allow");
    } finally {
      await client.close();
    }
  });

  it("--runtime-registration deny refuses without prompting", async () => {
    let prompted = false;
    const client = await startServer({
      args: ["--approved-folders", approvedDir, "--runtime-registration", "deny"],
      onElicit: () => {
        prompted = true;
        return { action: "accept", content: { allow: true } };
      },
    });
    try {
      const result = await callTool(client, "register_directory", {
        path: candidateDir,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("--approved-folders");
      expect(prompted).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("--runtime-registration allow registers without prompting", async () => {
    const client = await startServer({
      args: ["--approved-folders", approvedDir, "--runtime-registration=allow"],
    });
    try {
      const result = await callTool(client, "register_directory", {
        path: candidateDir,
      });
      expect(result.isError).toBe(false);
      expect(result.text).toContain("Successfully registered directory");
    } finally {
      await client.close();
    }
  });
});
