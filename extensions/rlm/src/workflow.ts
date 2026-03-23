import {
  getLastAssistantTextResult,
  type AgentEndEvent,
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionCompactEvent,
  type SessionForkEvent,
  type SessionShutdownEvent,
  type SessionStartEvent,
  type SessionSwitchEvent,
  type ToolCallEvent,
  type TurnEndEvent,
} from "../../../packages/workflow-core/src/index";
import { RlmDocumentEnvironment } from "./environment";
import { parseAssistantAction, type RlmAssistantAction } from "./protocol";
import { resolveRlmRequest, type RlmRequest } from "./request";

export const RLM_COMMAND_DESCRIPTION =
  "Run the Recursive Language Model workflow scaffold for long documents and notes";

const RLM_INTERNAL_MESSAGE_TYPE = "rlm-internal";
const INITIAL_PREVIEW_CHARS = 160;

interface ActiveRunState {
  request: RlmRequest;
  environment: RlmDocumentEnvironment;
  pendingRequestId: string;
  awaitingResponse: boolean;
}

export class RlmWorkflow {
  private state?: ActiveRunState;
  private requestSequence = 0;

  constructor(private readonly api: ExtensionAPI) {}

  async handleCommand(args: unknown, ctx: ExtensionContext): Promise<void> {
    if (this.state?.awaitingResponse) {
      ctx.ui.notify("RLM is already running. Finish the current run before starting another.", "warning");
      return;
    }

    const request = await resolveRlmRequest(args);
    if (!request.ok) {
      ctx.ui.notify(request.error.message, "error");
      return;
    }

    const environment = new RlmDocumentEnvironment(request.value);
    const prompt = buildInitialPrompt(environment.getMetadata({ previewChars: INITIAL_PREVIEW_CHARS }));
    const requestId = this.nextRequestId();

    this.state = {
      request: request.value,
      environment,
      pendingRequestId: requestId,
      awaitingResponse: true,
    };

    this.api.sendUserMessage(`${prompt}\n\n${requestIdMarker(requestId)}`);
  }

  handleToolCall(_event: ToolCallEvent, _ctx: ExtensionContext): void {}

  handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext): void {
    if (!this.state || !this.state.awaitingResponse) {
      return;
    }

    const messages = event.messages ?? [];
    const observedRequestId = extractRequestId(extractLastPromptText(messages) ?? "");
    if (!observedRequestId || observedRequestId !== this.state.pendingRequestId) {
      return;
    }

    const assistantResult = getLastAssistantTextResult(messages);
    if (assistantResult.kind !== "ok") {
      ctx.ui.notify("RLM stopped: assistant action output was missing or invalid.", "error");
      this.state = undefined;
      return;
    }

    const action = parseAssistantAction(assistantResult.text);
    if (!action.ok) {
      ctx.ui.notify(action.error.message, "error");
      this.state = undefined;
      return;
    }

    if (action.value.kind === "final_result") {
      this.state.environment.setFinalResult(action.value.result);
      ctx.ui.notify(`RLM final result ready for ${this.state.request.path}.`, "info");
      this.state = undefined;
      return;
    }

    const observation = this.executeAction(action.value);
    this.sendObservationFollowUp(observation, ctx);
  }

  handleBeforeAgentStart(
    event: BeforeAgentStartEvent,
    _ctx: ExtensionContext,
  ): void | { systemPrompt: string } {
    if (!this.state) {
      return undefined;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildRlmSystemPrompt()}`,
    };
  }

  handleTurnEnd(_event: TurnEndEvent, _ctx: ExtensionContext): void {}

  handleSessionStart(_event: SessionStartEvent, _ctx: ExtensionContext): void {}

  handleSessionSwitch(_event: SessionSwitchEvent, _ctx: ExtensionContext): void {}

  handleSessionFork(_event: SessionForkEvent, _ctx: ExtensionContext): void {}

  handleSessionCompact(_event: SessionCompactEvent, _ctx: ExtensionContext): void {}

  handleSessionShutdown(_event: SessionShutdownEvent, _ctx: ExtensionContext): void {}

  private executeAction(action: RlmAssistantAction): unknown {
    if (!this.state) {
      return undefined;
    }

    switch (action.kind) {
      case "inspect_document":
        return {
          type: "inspect_document",
          metadata: this.state.environment.getMetadata(),
        };
      case "read_segment":
        return {
          type: "read_segment",
          segment: this.state.environment.readSegment(action.offset, action.length),
        };
      case "search_document":
        return {
          type: "search_document",
          result: this.state.environment.search(action.query, {
            maxResults: action.maxResults,
          }),
        };
      case "final_result":
        return undefined;
    }
  }

  private sendObservationFollowUp(observation: unknown, ctx: ExtensionContext): void {
    if (!this.state) {
      return;
    }

    const requestId = this.nextRequestId();
    const prompt = buildObservationPrompt(observation);

    try {
      this.api.sendMessage(
        {
          customType: RLM_INTERNAL_MESSAGE_TYPE,
          content: `${prompt}\n\n${requestIdMarker(requestId)}`,
          display: false,
        },
        {
          triggerTurn: true,
          deliverAs: "followUp",
        },
      );
    } catch {
      ctx.ui.notify("RLM stopped: failed to send follow-up prompt.", "error");
      this.state = undefined;
      return;
    }

    this.state.pendingRequestId = requestId;
    this.state.awaitingResponse = true;
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `rlm-${this.requestSequence}`;
  }
}

function buildInitialPrompt(metadata: ReturnType<RlmDocumentEnvironment["getMetadata"]>): string {
  return [
    "You are operating inside a Recursive Language Model-style document environment.",
    "The full document is not in your context window.",
    "Choose exactly one next action and return only a JSON object or a fenced ```json block.",
    "Available actions: inspect_document, read_segment, search_document, final_result.",
    "Document metadata:",
    JSON.stringify(metadata, null, 2),
  ].join("\n\n");
}

function buildObservationPrompt(observation: unknown): string {
  return [
    "Observation from the document environment.",
    "Choose exactly one next action and return only a JSON object or a fenced ```json block.",
    JSON.stringify(observation, null, 2),
  ].join("\n\n");
}

function buildRlmSystemPrompt(): string {
  return [
    "[RLM MODE ACTIVE]",
    "Operate over the extension-managed document environment.",
    "Do not respond with prose.",
    "Return exactly one JSON action at a time.",
  ].join("\n");
}

function requestIdMarker(requestId: string): string {
  return `<!-- workflow-request-id:${requestId} -->`;
}

function extractRequestId(message: string): string | undefined {
  const markerMatch = message.match(/<!--\s*workflow-request-id:([^>]+)\s*-->/i);
  return markerMatch?.[1]?.trim();
}

function extractLastPromptText(messages: unknown[]): string | undefined {
  const typedMessages = messages.filter(
    (message): message is { role?: unknown; content?: unknown } => {
      return typeof message === "object" && message !== null;
    },
  );

  const message = [...typedMessages].reverse().find((entry) => {
    return entry.role === "user" || entry.role === "custom";
  });

  if (!message) {
    return undefined;
  }

  return extractMessageText(message.content);
}

function extractMessageText(content: unknown): string | undefined {
  if (typeof content === "string") {
    const text = content.trim();
    return text.length > 0 ? text : undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .filter((block): block is { type?: unknown; text?: unknown } => {
      return typeof block === "object" && block !== null;
    })
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}
