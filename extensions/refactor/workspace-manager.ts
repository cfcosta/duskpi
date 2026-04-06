import {
  JjWorkspaceManager as SharedJjWorkspaceManager,
  type JjWorkspaceManagerOptions,
  type ManagedWorkspace,
  type WorkspaceExec,
} from "../../packages/workflow-core/src/index";

export type { JjWorkspaceManagerOptions, ManagedWorkspace, WorkspaceExec };

export class JjWorkspaceManager {
  private readonly delegate: SharedJjWorkspaceManager;

  constructor(private readonly options: JjWorkspaceManagerOptions) {
    this.delegate = new SharedJjWorkspaceManager({
      ...options,
      exec: (command, args, execOptions) =>
        options.exec(command, args, {
          ...(execOptions ?? {}),
          env: undefined,
        } as typeof execOptions),
    });
  }

  createWorkspace(name: string, destinationPath: string): Promise<ManagedWorkspace> {
    return this.delegate.createWorkspace(name, destinationPath);
  }

  getWorkspaceRoot(name: string): Promise<string> {
    return this.delegate.getWorkspaceRoot(name);
  }

  updateStaleWorkspace(name: string): Promise<void> {
    return this.delegate.updateStaleWorkspace(name);
  }

  forgetWorkspace(name: string): Promise<void> {
    return this.delegate.forgetWorkspace(name);
  }
}
