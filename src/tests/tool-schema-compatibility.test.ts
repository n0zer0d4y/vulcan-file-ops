import { getReadTools } from "../tools/read-tools.js";
import { getWriteTools } from "../tools/write-tools.js";
import { getFileSystemTools } from "../tools/filesystem-tools.js";
import { getSearchTools } from "../tools/search-tools.js";
import { getShellTools } from "../tools/shell-tool.js";

function scanSchema(node: unknown, findings: string[], path: string[] = []): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      scanSchema(item, findings, path.concat(String(index)))
    );
    return;
  }

  if (!node || typeof node !== "object") {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (
      key === "$schema" ||
      key === "$ref" ||
      key === "anyOf" ||
      key === "oneOf" ||
      key === "allOf"
    ) {
      findings.push(path.concat(key).join("."));
    }

    scanSchema(value, findings, path.concat(key));
  }
}

describe("MCP tool input schema compatibility", () => {
  const tools = [
    ...getReadTools(),
    ...getWriteTools(),
    ...getFileSystemTools(),
    ...getSearchTools(),
    ...getShellTools(),
  ];

  it("emits object-root input schemas for every tool", () => {
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("does not emit client-hostile schema constructs", () => {
    const findingsByTool = tools
      .map((tool) => {
        const findings: string[] = [];
        scanSchema(tool.inputSchema, findings);
        return { name: tool.name, findings };
      })
      .filter((result) => result.findings.length > 0);

    expect(findingsByTool).toEqual([]);
  });
});
