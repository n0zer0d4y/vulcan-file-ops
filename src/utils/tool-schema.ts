type JsonSchema = Record<string, any>;

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function unescapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveLocalRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => unescapeJsonPointerSegment(segment));

  let current: any = root;
  for (const segment of segments) {
    if (current == null || typeof current !== "object" || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function sanitizeSchemaNode(node: unknown, root: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => sanitizeSchemaNode(item, root));
  }

  if (!node || typeof node !== "object") {
    return node;
  }

  const schema = node as JsonSchema;

  if (typeof schema.$ref === "string") {
    const resolved = resolveLocalRef(root, schema.$ref);
    if (resolved && typeof resolved === "object") {
      const { $ref: _ignoredRef, ...siblings } = schema;
      return sanitizeSchemaNode(
        {
          ...(cloneValue(resolved) as JsonSchema),
          ...siblings,
        },
        root
      );
    }
  }

  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema" || key === "$defs" || key === "definitions") {
      continue;
    }
    result[key] = sanitizeSchemaNode(value, root);
  }

  return result;
}

export function sanitizeToolInputSchema(schema: JsonSchema): JsonSchema {
  const cloned = cloneValue(schema);
  const sanitized = sanitizeSchemaNode(cloned, cloned);

  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return {
      type: "object",
      additionalProperties: false,
    };
  }

  const normalized = sanitized as JsonSchema;
  if (normalized.type !== "object") {
    normalized.type = "object";
  }

  if (!("additionalProperties" in normalized)) {
    normalized.additionalProperties = false;
  }

  return normalized;
}

export function createEmptyObjectSchema(): JsonSchema {
  return {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  };
}

export function createPathArraySchema(description: string): JsonSchema {
  return {
    type: "array",
    items: {
      type: "string",
    },
    minItems: 1,
    description,
  };
}
