import { resolve, sep } from "node:path";

export class PathTraversalError extends Error {
  readonly code = "path_traversal" as const;

  constructor(message = "path_traversal") {
    super(message);
    this.name = "PathTraversalError";
  }
}

const DEFAULT_WORKSPACE_ROOT = "/workspace";

function assertRelativeSafe(relativePath: string): void {
  if (relativePath.startsWith("/")) {
    throw new PathTraversalError();
  }
  if (relativePath.split(/[/\\]/).some((segment) => segment === "..")) {
    throw new PathTraversalError();
  }
}

function resolveUnderRoot(root: string, relativePath: string): string {
  assertRelativeSafe(relativePath);
  const normalizedRoot = resolve(root);
  const absolutePath = resolve(normalizedRoot, relativePath);
  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(rootPrefix)) {
    throw new PathTraversalError();
  }
  return absolutePath;
}

export function resolveBotPath(
  botId: string,
  relativePath: string,
  workspaceRoot: string = DEFAULT_WORKSPACE_ROOT
): string {
  if (!botId.trim()) {
    throw new PathTraversalError();
  }
  return resolveUnderRoot(resolve(workspaceRoot, "bots", botId), relativePath);
}

export function resolveSharedPath(
  relativePath: string,
  workspaceRoot: string = DEFAULT_WORKSPACE_ROOT
): string {
  return resolveUnderRoot(resolve(workspaceRoot, "shared"), relativePath);
}
