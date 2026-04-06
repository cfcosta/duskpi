import type { ExecOptions, ExecResult } from "./extension-api";

const DEFAULT_JJ_TIMEOUT_MS = 15_000;

export interface WorkspaceExec {
  (command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
}

export interface JjWorkspaceManagerOptions {
  repoRoot: string;
  exec: WorkspaceExec;
  timeoutMs?: number;
}

export interface ManagedWorkspace {
  name: string;
  root: string;
}

export class JjWorkspaceManager {
  private readonly timeoutMs: number;

  constructor(private readonly options: JjWorkspaceManagerOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_JJ_TIMEOUT_MS;
  }

  async createWorkspace(name: string, destinationPath: string): Promise<ManagedWorkspace> {
    await this.runJj(["workspace", "add", destinationPath, "--name", name]);
    const root = await this.getWorkspaceRoot(name);
    return { name, root };
  }

  async getWorkspaceRoot(name: string): Promise<string> {
    const result = await this.runJj(["workspace", "root", "--name", name]);
    const root = result.stdout.trim();
    if (root.length === 0) {
      throw new Error(`jj workspace root returned an empty path for workspace '${name}'.`);
    }

    return root;
  }

  async updateStaleWorkspace(name: string): Promise<void> {
    const root = await this.getWorkspaceRoot(name);
    await this.runJj(["workspace", "update-stale"], { cwd: root });
  }

  async forgetWorkspace(name: string): Promise<void> {
    await this.runJj(["workspace", "forget", name]);
  }

  private async runJj(args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const result = await this.options.exec("jj", args, {
      cwd: options.cwd ?? this.options.repoRoot,
      timeout: options.timeout ?? this.timeoutMs,
      signal: options.signal,
    });

    if (result.killed) {
      throw new Error(`jj ${args.join(" ")} timed out or was killed.`);
    }

    if (result.code !== 0) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      const details = stderr || stdout;
      throw new Error(
        details.length > 0
          ? `jj ${args.join(" ")} failed: ${details}`
          : `jj ${args.join(" ")} failed with exit code ${result.code}.`,
      );
    }

    return result;
  }
}
