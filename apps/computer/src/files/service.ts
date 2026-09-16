import { mkdir, open, readdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileReadResult } from "@vork/contracts";
import type { LeaseManager } from "../slots/lease-manager.js";
import { resolveBotPath, resolveSharedPath } from "./path-sandbox.js";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_TASK_WRITE_BYTES = 10 * 1024 * 1024;

export type FileRoot = "bot" | "shared";

export class ReadOnlyRootError extends Error {
  readonly code = "read_only_root" as const;

  constructor() {
    super("read_only_root");
    this.name = "ReadOnlyRootError";
  }
}

export class FileTooLargeError extends Error {
  readonly code = "file_too_large" as const;

  constructor() {
    super("file_too_large");
    this.name = "FileTooLargeError";
  }
}

export class WriteQuotaExceededError extends Error {
  readonly code = "write_quota_exceeded" as const;

  constructor() {
    super("write_quota_exceeded");
    this.name = "WriteQuotaExceededError";
  }
}

export class FileNotFoundError extends Error {
  readonly code = "not_found" as const;

  constructor() {
    super("not_found");
    this.name = "FileNotFoundError";
  }
}

type FileEntry = {
  name: string;
  type: "file" | "directory";
  size?: number;
};

type FileStatResult = {
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
};

export type FileServiceOptions = {
  workspaceRoot: string;
  leaseManager: LeaseManager;
};

export class FileService {
  readonly #workspaceRoot: string;
  readonly #leaseManager: LeaseManager;
  readonly #taskWriteBytes = new Map<string, number>();

  constructor(options: FileServiceOptions) {
    this.#workspaceRoot = options.workspaceRoot;
    this.#leaseManager = options.leaseManager;
  }

  async list(input: {
    leaseId: string;
    path?: string;
    root?: FileRoot;
  }): Promise<{ entries: FileEntry[] }> {
    const lease = this.#assertLease(input.leaseId);
    const relativePath = input.path ?? ".";
    const absolutePath = this.#resolvePath(lease.botId, relativePath, input.root ?? "bot");
    const entries = await readdir(absolutePath, { withFileTypes: true });
    return {
      entries: await Promise.all(
        entries.map(async (entry) => {
          if (entry.isDirectory()) {
            return { name: entry.name, type: "directory" as const };
          }
          const fileStat = await stat(`${absolutePath}/${entry.name}`);
          return { name: entry.name, type: "file" as const, size: fileStat.size };
        })
      )
    };
  }

  async stat(input: {
    leaseId: string;
    path: string;
    root?: FileRoot;
  }): Promise<FileStatResult> {
    const lease = this.#assertLease(input.leaseId);
    const absolutePath = this.#resolvePath(lease.botId, input.path, input.root ?? "bot");
    const fileStat = await stat(absolutePath);
    return {
      path: input.path,
      type: fileStat.isDirectory() ? "directory" : "file",
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString()
    };
  }

  async read(input: {
    leaseId: string;
    path: string;
    root?: FileRoot;
    encoding?: "utf8" | "base64";
  }): Promise<FileReadResult> {
    const lease = this.#assertLease(input.leaseId);
    const absolutePath = this.#resolvePath(lease.botId, input.path, input.root ?? "bot");
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new FileNotFoundError();
    }

    const truncated = fileStat.size > MAX_FILE_BYTES;
    const bytesToRead = truncated ? MAX_FILE_BYTES : fileStat.size;
    const buffer = Buffer.alloc(bytesToRead);
    const fileHandle = await open(absolutePath, "r");
    try {
      await fileHandle.read(buffer, 0, bytesToRead, 0);
    } finally {
      await fileHandle.close();
    }

    const encoding = input.encoding ?? "utf8";
    const content =
      encoding === "base64" ? buffer.toString("base64") : buffer.toString("utf8");

    return {
      path: input.path,
      content,
      bytes: bytesToRead,
      ...(truncated ? { truncated: true } : {})
    };
  }

  async write(input: {
    leaseId: string;
    path: string;
    content: string;
    root?: FileRoot;
    encoding?: "utf8" | "base64";
  }): Promise<{ path: string; bytes: number }> {
    const root = input.root ?? "bot";
    if (root === "shared") {
      throw new ReadOnlyRootError();
    }

    const lease = this.#assertLease(input.leaseId);
    const absolutePath = this.#resolvePath(lease.botId, input.path, root);
    const buffer =
      (input.encoding ?? "utf8") === "base64"
        ? Buffer.from(input.content, "base64")
        : Buffer.from(input.content, "utf8");

    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new FileTooLargeError();
    }

    const currentTaskBytes = this.#taskWriteBytes.get(lease.taskId) ?? 0;
    if (currentTaskBytes + buffer.byteLength > MAX_TASK_WRITE_BYTES) {
      throw new WriteQuotaExceededError();
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
    this.#taskWriteBytes.set(lease.taskId, currentTaskBytes + buffer.byteLength);

    return { path: input.path, bytes: buffer.byteLength };
  }

  async mkdir(input: {
    leaseId: string;
    path: string;
    root?: FileRoot;
  }): Promise<{ path: string }> {
    const root = input.root ?? "bot";
    if (root === "shared") {
      throw new ReadOnlyRootError();
    }

    const lease = this.#assertLease(input.leaseId);
    const absolutePath = this.#resolvePath(lease.botId, input.path, root);
    await mkdir(absolutePath, { recursive: true });
    return { path: input.path };
  }

  #assertLease(leaseId: string): { botId: string; taskId: string } {
    return this.#leaseManager.assertActive(leaseId);
  }

  #resolvePath(botId: string, relativePath: string, root: FileRoot): string {
    return root === "shared"
      ? resolveSharedPath(relativePath, this.#workspaceRoot)
      : resolveBotPath(botId, relativePath, this.#workspaceRoot);
  }
}
