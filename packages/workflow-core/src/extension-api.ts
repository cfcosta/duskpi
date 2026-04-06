export type ThemeActivationResult = { success: true } | { success: false; error?: string };

export interface ExtensionTheme {
  fg(color: string, text: string): string;
  strikethrough(text: string): string;
}

export interface ExtensionMessageRenderOptions {
  expanded: boolean;
}

export interface ExtensionWidgetOptions {
  placement?: "above_editor" | "below_editor";
}

export type ExtensionWidgetFactory = (
  tui: unknown,
  theme: ExtensionTheme,
) => unknown | Promise<unknown>;

export interface ExtensionUICustomOptions {
  overlay?: boolean;
  overlayOptions?: unknown | (() => unknown);
  onHandle?: (handle: unknown) => void;
}

export type ExtensionUICustomFactory<T> = (
  tui: unknown,
  theme: ExtensionTheme,
  keybindings: unknown,
  done: (result: T) => void,
) => unknown | Promise<unknown>;

export interface ExtensionUIDialogOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ExtensionUI {
  theme: ExtensionTheme;
  notify(message: string, level?: "info" | "warning" | "error"): void;
  setStatus(id: string, status: string | undefined): void;
  setWidget(
    id: string,
    widget: string[] | ExtensionWidgetFactory | undefined,
    options?: ExtensionWidgetOptions,
  ): void;
  select(
    title: string,
    options: string[],
    dialogOptions?: ExtensionUIDialogOptions,
  ): Promise<string | undefined>;
  editor(label: string, initialValue?: string): Promise<string | undefined>;
  custom<T>(factory: ExtensionUICustomFactory<T>, options?: ExtensionUICustomOptions): Promise<T>;
  setTheme(themeName: string): ThemeActivationResult;
}

export interface ExtensionContext {
  ui: ExtensionUI;
  hasUI: boolean;
}

export interface ExtensionCustomMessage<T = unknown> {
  customType: string;
  content?: unknown;
  display?: boolean;
  details?: T;
}

export interface SendMessageOptions {
  triggerTurn?: boolean;
  deliverAs?: "steer" | "followUp" | "nextTurn";
}

export interface SendUserMessageOptions {
  deliverAs?: "steer" | "followUp";
}

export interface ToolCapabilities {
  readOnly?: boolean;
  mutatesWorkspace?: boolean;
  executesShell?: boolean;
  readsExternalResources?: boolean;
  asksUserQuestions?: boolean;
}

export interface ToolInfo {
  name: string;
  description?: string;
  parameters?: unknown;
  capabilities?: ToolCapabilities;
}

export interface ToolCallEvent {
  toolName?: string;
  input?: unknown;
}

export interface AgentEndEvent {
  messages?: unknown[];
}

export interface BeforeAgentStartEvent {
  systemPrompt: string;
  prompt?: string;
  images?: unknown[];
}

export interface BeforeAgentStartResult {
  systemPrompt?: string;
  message?: ExtensionCustomMessage;
}

export interface TurnEndEvent {
  message?: unknown;
  toolResults?: unknown[];
}

export interface SessionStartEvent {
  restored?: boolean;
}

export interface SessionSwitchEvent {
  reason: "new" | "resume";
  previousSessionFile: string | undefined;
}

export interface SessionForkEvent {
  previousSessionFile: string | undefined;
}

export interface SessionCompactEvent {
  compactionEntry: unknown;
  fromExtension: boolean;
}

export interface SessionShutdownEvent {
  reason?: string;
}

export interface ExtensionEventMap {
  tool_call: ToolCallEvent;
  agent_end: AgentEndEvent;
  before_agent_start: BeforeAgentStartEvent;
  turn_end: TurnEndEvent;
  session_start: SessionStartEvent;
  session_switch: SessionSwitchEvent;
  session_fork: SessionForkEvent;
  session_compact: SessionCompactEvent;
  session_shutdown: SessionShutdownEvent;
}

interface ExtensionEventContext {
  tool_call: ExtensionContext;
  agent_end: ExtensionContext;
  before_agent_start: ExtensionContext;
  turn_end: ExtensionContext;
  session_start: ExtensionContext;
  session_switch: ExtensionContext;
  session_fork: ExtensionContext;
  session_compact: ExtensionContext;
  session_shutdown: ExtensionContext;
}

export interface ExtensionToolResult<T = unknown> {
  content: Array<{ type: "text"; text: string }>;
  details?: T;
}

export interface ExtensionToolDefinition<Params = unknown, Details = unknown> {
  name: string;
  label?: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Params,
    signal: AbortSignal,
    onUpdate: ((update: ExtensionToolResult<Details>) => void) | undefined,
    ctx: ExtensionContext,
  ): Promise<ExtensionToolResult<Details>> | ExtensionToolResult<Details>;
  renderCall?(args: Params, theme: ExtensionTheme): unknown;
  renderResult?(
    result: ExtensionToolResult<Details>,
    options: unknown,
    theme: ExtensionTheme,
  ): unknown;
}

export interface ExtensionAPI {
  sendMessage<T = unknown>(message: ExtensionCustomMessage<T>, options?: SendMessageOptions): void;
  sendUserMessage(message: string | unknown[], options?: SendUserMessageOptions): void;
  registerCommand(
    name: string,
    command: {
      description: string;
      handler: (args: unknown, ctx: ExtensionContext) => unknown;
    },
  ): void;
  registerMessageRenderer(
    customType: string,
    renderer: (
      message: ExtensionCustomMessage,
      options: ExtensionMessageRenderOptions,
      theme: ExtensionTheme,
    ) => unknown,
  ): void;
  registerTool<Params = unknown, Details = unknown>(
    definition: ExtensionToolDefinition<Params, Details>,
  ): void;
  getActiveTools(): string[];
  getAllTools(): ToolInfo[];
  setActiveTools(toolNames: string[]): void;
  on<EventName extends keyof ExtensionEventMap>(
    event: EventName,
    handler: (
      event: ExtensionEventMap[EventName],
      ctx: ExtensionEventContext[EventName],
    ) => unknown,
  ): void;
}
