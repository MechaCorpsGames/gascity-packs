export type StructuredMessageStatus =
  | "unknown"
  | "partial"
  | "final"
  | "superseded";

export type StructuredResetReason =
  | "resume_invalid"
  | "stream_changed"
  | "cursor_invalidated"
  | "history_rewritten";

export interface StructuredMessage {
  readonly id: string;
  readonly role: string;
  readonly status: StructuredMessageStatus;
  readonly provider?: string;
  readonly timestamp?: string;
  readonly model?: string;
  readonly stop_reason?: string;
  readonly usage?: Readonly<Record<string, number>>;
  readonly user_prompt?: {
    readonly text?: string;
    readonly opened_files?: readonly string[];
    readonly uploaded_files?: readonly {
      readonly original_name?: string;
      readonly size?: string;
      readonly mime_type?: string;
      readonly file_path?: string;
      readonly preview_url?: string;
    }[];
    readonly selections?: readonly { readonly text?: string }[];
  };
  readonly system_event?: {
    readonly kind?: string;
    readonly category?: string;
    readonly code?: string;
    readonly message?: string;
  };
  readonly blocks?: readonly Readonly<Record<string, unknown>>[];
}

const SAME_ID_STATUS_TRANSITIONS: Readonly<
  Record<StructuredMessageStatus, readonly StructuredMessageStatus[]>
> = {
  unknown: ["unknown", "partial", "final", "superseded"],
  partial: ["partial", "final", "superseded"],
  final: ["final", "superseded"],
  superseded: ["superseded"],
};

interface MessageSemantics {
  readonly role: string;
  readonly status: StructuredMessageStatus;
  readonly toolUses: readonly {
    readonly id: string | null;
    readonly name: string | null;
  }[];
  readonly toolResults: readonly {
    readonly toolCallId: string | null;
    readonly name: string | null;
  }[];
}

interface SemanticLedger {
  readonly transcriptStreamId: string;
  readonly messages: ReadonlyMap<string, MessageSemantics>;
}

function messageSemantics(message: StructuredMessage): MessageSemantics {
  const stringField = (value: unknown): string | null =>
    typeof value === "string" ? value : null;
  return {
    role: message.role,
    status: message.status,
    toolUses: (message.blocks ?? [])
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: stringField(block.id),
        name: stringField(block.name),
      })),
    toolResults: (message.blocks ?? [])
      .filter((block) => block.type === "tool_result")
      .map((block) => ({
        toolCallId: stringField(block.tool_call_id),
        name: stringField(block.name),
      })),
  };
}

function assertObservedFieldStable(
  messageId: string,
  path: string,
  current: string | null,
  replacement: string | null | undefined,
): void {
  if (current === null || replacement === current) return;
  throw new Error(
    `Message ${messageId} changed ${path} from ${current} to ${replacement ?? "<missing>"}`,
  );
}

function assertSemanticTransition(
  messageId: string,
  current: MessageSemantics,
  replacement: StructuredMessage,
): void {
  const next = messageSemantics(replacement);
  if (current.role !== next.role) {
    throw new Error(
      `Message ${messageId} changed role from ${current.role} to ${next.role}`,
    );
  }
  if (
    !SAME_ID_STATUS_TRANSITIONS[current.status].includes(next.status)
  ) {
    throw new Error(
      `Message ${messageId} cannot transition status from ${current.status} to ${next.status}`,
    );
  }
  current.toolUses.forEach((tool, index) => {
    const replacementTool = next.toolUses[index];
    assertObservedFieldStable(
      messageId,
      `tool_use[${index}].id`,
      tool.id,
      replacementTool?.id,
    );
    assertObservedFieldStable(
      messageId,
      `tool_use[${index}].name`,
      tool.name,
      replacementTool?.name,
    );
  });
  current.toolResults.forEach((tool, index) => {
    const replacementTool = next.toolResults[index];
    assertObservedFieldStable(
      messageId,
      `tool_result[${index}].tool_call_id`,
      tool.toolCallId,
      replacementTool?.toolCallId,
    );
    assertObservedFieldStable(
      messageId,
      `tool_result[${index}].name`,
      tool.name,
      replacementTool?.name,
    );
  });
}

function ledgerFromMessages(
  transcriptStreamId: string,
  messages: readonly StructuredMessage[],
): SemanticLedger {
  const facts = new Map<string, MessageSemantics>();
  for (const message of messages) {
    if (facts.has(message.id)) {
      throw new Error(`Duplicate structured message id ${message.id}`);
    }
    facts.set(message.id, messageSemantics(message));
  }
  return { transcriptStreamId, messages: facts };
}

function transitionLedger(
  ledger: SemanticLedger,
  transcriptStreamId: string,
  messages: readonly StructuredMessage[],
): SemanticLedger {
  if (ledger.transcriptStreamId !== transcriptStreamId) {
    return ledgerFromMessages(transcriptStreamId, messages);
  }
  const next = new Map(ledger.messages);
  const frameIds = new Set<string>();
  for (const message of messages) {
    if (frameIds.has(message.id)) {
      throw new Error(`Duplicate structured message id ${message.id}`);
    }
    frameIds.add(message.id);
    const current = next.get(message.id);
    if (current !== undefined) {
      assertSemanticTransition(message.id, current, message);
    }
    next.set(message.id, messageSemantics(message));
  }
  return { transcriptStreamId, messages: next };
}

export interface TranscriptBootstrap {
  readonly sessionId: string;
  readonly transcriptStreamId: string;
  readonly resumeToken: string;
  readonly messages: readonly StructuredMessage[];
  readonly diagnostics?: readonly TranscriptDiagnostic[];
  readonly degraded?: boolean;
  readonly degradedReason?: string;
  readonly continuityStatus?: string;
  readonly continuityNote?: string;
}

export interface TranscriptDiagnostic {
  readonly code: string;
  readonly message?: string;
  readonly count?: number;
}

export type PendingResponseState =
  | "enabled"
  | "submitting"
  | "awaiting_clear"
  | "outcome_unknown";

export interface PendingInteraction {
  readonly requestId: string;
  readonly kind: string;
  readonly prompt: string;
  readonly responseState?: PendingResponseState;
  readonly options?: readonly string[];
}

export interface SessionState {
  readonly id: string;
  readonly state: string;
  readonly closed: boolean;
}

export type SessionStreamEvent =
  | {
      readonly type: "structured";
      readonly id: string;
      readonly operation: "snapshot" | "reset" | "upsert";
      readonly transcriptStreamId: string;
      readonly resumeToken: string;
      readonly messages: readonly StructuredMessage[];
      readonly diagnostics?: readonly TranscriptDiagnostic[];
      readonly degraded?: boolean;
      readonly degradedReason?: string;
      readonly continuityStatus?: string;
      readonly continuityNote?: string;
      readonly resetReason?: StructuredResetReason;
    }
  | {
      readonly type: "pending";
      readonly interaction: PendingInteraction;
    }
  | {
      readonly type: "pending_cleared";
      readonly requestId: string;
    }
  | {
      readonly type: "activity";
      readonly activity: string;
    }
  | {
      readonly type: "heartbeat";
    };

export interface SessionStreamRequest {
  readonly sessionId: string;
  readonly afterCursor?: string;
  readonly lastEventId?: string;
  readonly onEvent: (event: SessionStreamEvent) => void;
  readonly onEof: () => void;
  readonly onError: (error: FeedStreamError) => void;
}

export interface FeedStreamError {
  readonly kind:
    | "contract"
    | "resume_rejected"
    | "network"
    | "http"
    | "unauthorized";
  readonly message: string;
  readonly status?: number;
}

export class FeedMutationError extends Error {
  readonly outcome: "rejected" | "unknown";
  readonly status: number;

  constructor(
    outcome: "rejected" | "unknown",
    status: number,
    message: string,
  ) {
    super(message);
    this.name = "FeedMutationError";
    this.outcome = outcome;
    this.status = status;
  }
}

export interface SessionStreamHandle {
  close(): void;
}

export interface FeedPort {
  fetchTranscript(sessionId: string): Promise<TranscriptBootstrap>;
  fetchPending(sessionId: string): Promise<readonly PendingInteraction[]>;
  fetchSession(sessionId: string): Promise<SessionState>;
  openSessionStream(
    request: SessionStreamRequest,
  ): Promise<SessionStreamHandle>;
  respond(
    sessionId: string,
    requestId: string,
    response: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

export interface FeedTranscriptSnapshot {
  readonly transcriptStreamId: string;
  readonly resumeToken: string;
  readonly messages: readonly StructuredMessage[];
  readonly diagnostics?: readonly TranscriptDiagnostic[];
  readonly degraded?: boolean;
  readonly degradedReason?: string;
  readonly continuityStatus?: string;
  readonly continuityNote?: string;
}

export interface StructuredFeedSnapshot {
  readonly phase:
    | "idle"
    | "bootstrapping"
    | "reconnecting"
    | "live"
    | "quiescent"
    | "failed";
  readonly session: SessionState | null;
  readonly transcript: FeedTranscriptSnapshot | null;
  readonly pending: readonly PendingInteraction[];
  readonly activity: string | null;
  readonly resetNotice: {
    readonly reason: StructuredResetReason;
  } | null;
  readonly issue?: FeedStreamError;
}

export interface StructuredFeedController {
  getSnapshot(): StructuredFeedSnapshot;
  subscribe(listener: () => void): () => void;
  bootstrap(selection: { readonly sessionId: string }): Promise<void>;
  reconnect(): Promise<void>;
  respond(
    requestId: string,
    response: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  dispose(): void;
}

export interface FeedRecoveryPolicy {
  readonly maxContractRebootstraps?: number;
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly jitter?: (maximumMs: number) => number;
}

function freezeInteraction(
  interaction: PendingInteraction,
): PendingInteraction {
  const { options, ...base } = interaction;
  return Object.freeze(
    options === undefined
      ? base
      : { ...base, options: Object.freeze([...options]) },
  );
}

function freezeSnapshot(
  snapshot: StructuredFeedSnapshot,
): StructuredFeedSnapshot {
  return Object.freeze({
    ...snapshot,
    session:
      snapshot.session === null ? null : Object.freeze({ ...snapshot.session }),
    transcript:
      snapshot.transcript === null
        ? null
        : Object.freeze({
            ...snapshot.transcript,
            messages: Object.freeze([...snapshot.transcript.messages]),
            ...(snapshot.transcript.diagnostics === undefined
              ? {}
              : { diagnostics: Object.freeze(snapshot.transcript.diagnostics.map(diagnostic => Object.freeze({ ...diagnostic }))) }),
          }),
    pending: Object.freeze(snapshot.pending.map(freezeInteraction)),
    resetNotice:
      snapshot.resetNotice === null
        ? null
        : Object.freeze({ ...snapshot.resetNotice }),
  });
}

function reducePendingEvent(
  pending: readonly PendingInteraction[],
  event: Extract<
    SessionStreamEvent,
    { readonly type: "pending" | "pending_cleared" }
  >,
): readonly PendingInteraction[] {
  if (event.type === "pending_cleared") {
    return pending.filter((item) => item.requestId !== event.requestId);
  }
  const interaction = {
    ...event.interaction,
    responseState: pending.find(
      (item) => item.requestId === event.interaction.requestId,
    )?.responseState === "outcome_unknown"
      ? "outcome_unknown" as const
      : "enabled" as const,
  };
  const index = pending.findIndex(
    (item) => item.requestId === interaction.requestId,
  );
  if (index < 0) {
    return [...pending, interaction];
  }
  return pending.map((item, itemIndex) =>
    itemIndex === index ? interaction : item,
  );
}

function reduceFeedEvent(
  snapshot: StructuredFeedSnapshot,
  event: SessionStreamEvent,
  ledger: SemanticLedger,
): { readonly snapshot: StructuredFeedSnapshot; readonly ledger: SemanticLedger } {
  if (event.type === "activity") {
    return { ledger, snapshot: { ...snapshot, activity: event.activity } };
  }
  if (event.type === "heartbeat") {
    return { ledger, snapshot };
  }
  if (event.type === "pending" || event.type === "pending_cleared") {
    return {
      ledger,
      snapshot: {
        ...snapshot,
        pending: reducePendingEvent(snapshot.pending, event),
      },
    };
  }
  if (snapshot.transcript === null) {
    throw new Error("Structured event arrived before transcript bootstrap");
  }
  let resetNotice = snapshot.resetNotice;
  if (event.operation === "reset") {
    const resetReason = event.resetReason;
    if (resetReason === undefined) {
      throw new Error("Structured reset omitted reset reason");
    }
    resetNotice = { reason: resetReason };
  } else if (event.resetReason !== undefined) {
    throw new Error(
      `Structured ${event.operation} unexpectedly included reset reason`,
    );
  } else if (event.operation === "snapshot") {
    resetNotice = null;
  }
  if (event.id !== event.resumeToken) {
    throw new Error("SSE id does not match structured resume token");
  }
  if (
    event.operation === "upsert" &&
    event.transcriptStreamId !== snapshot.transcript.transcriptStreamId
  ) {
    throw new Error("Structured upsert changed transcript stream identity");
  }
  const nextLedger = transitionLedger(
    ledger,
    event.transcriptStreamId,
    event.messages,
  );
  let messages: StructuredMessage[];
  if (event.operation === "upsert") {
    messages = [...snapshot.transcript.messages];
    const positions = new Map(
      messages.map((message, index) => [message.id, index] as const),
    );
    for (const message of event.messages) {
      const position = positions.get(message.id);
      if (position === undefined) {
        positions.set(message.id, messages.length);
        messages.push(message);
      } else {
        messages[position] = message;
      }
    }
  } else {
    messages = [...event.messages];
  }
  return {
    ledger: nextLedger,
    snapshot: {
      ...snapshot,
      transcript: {
        transcriptStreamId: event.transcriptStreamId,
        resumeToken: event.resumeToken,
        messages,
        ...(event.diagnostics === undefined ? {} : { diagnostics: event.diagnostics }),
        ...(event.degraded === undefined ? {} : { degraded: event.degraded }),
        ...(event.degradedReason === undefined ? {} : { degradedReason: event.degradedReason }),
        ...(event.continuityStatus === undefined ? {} : { continuityStatus: event.continuityStatus }),
        ...(event.continuityNote === undefined ? {} : { continuityNote: event.continuityNote }),
      },
      resetNotice,
    },
  };
}

export function createStructuredFeedController(
  port: FeedPort,
  recoveryPolicy: FeedRecoveryPolicy = {},
): StructuredFeedController {
  let stream: SessionStreamHandle | null = null;
  let streamGeneration = 0;
  let selectedSessionId: string | null = null;
  let selectionGeneration = 0;
  let semanticLedger: SemanticLedger | null = null;
  let contractRebootstraps = 0;
  let recoveryInFlight = false;
  let eofRecoveryInFlight = false;
  let reconnectRecoveryInFlight = false;
  let reconnectAttempt = 0;
  let snapshot = freezeSnapshot({
    phase: "idle",
    session: null,
    transcript: null,
    pending: [],
    activity: null,
    resetNotice: null,
  });
  const listeners = new Set<() => void>();

  const publish = (next: StructuredFeedSnapshot): void => {
    snapshot = freezeSnapshot(next);
    for (const listener of listeners) listener();
  };

  const handleEof = (): void => {
    const terminalTranscript =
      snapshot.transcript !== null &&
      snapshot.transcript.messages.every(
        (message) =>
          message.status === "final" || message.status === "superseded",
      );
    if (
      snapshot.session?.closed === true &&
      snapshot.activity === "idle" &&
      terminalTranscript
    ) {
      publish({ ...snapshot, phase: "quiescent" });
      return;
    }
    publish({ ...snapshot, phase: "reconnecting" });
    const sessionId = selectedSessionId;
    if (sessionId === null || eofRecoveryInFlight) return;
    eofRecoveryInFlight = true;
    void controller
      .bootstrap({ sessionId })
      .catch((cause: unknown) => {
        if (selectedSessionId !== sessionId) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        publish({
          ...snapshot,
          phase: "failed",
          issue: { kind: "network", message },
        });
      })
      .finally(() => {
        eofRecoveryInFlight = false;
      });
  };

  let controller!: StructuredFeedController;
  const scheduleReconnect = (sessionId: string): void => {
    if (reconnectRecoveryInFlight) return;
    reconnectRecoveryInFlight = true;
    const exponent = Math.min(reconnectAttempt, 10);
    reconnectAttempt += 1;
    const baseDelay = Math.min(500 * 2 ** exponent, 15_000);
    const requestedJitter = (
      recoveryPolicy.jitter ??
      ((maximumMs) => Math.floor(Math.random() * (maximumMs + 1)))
    )(250);
    const delayMs = baseDelay + Math.max(0, Math.min(250, requestedJitter));
    const wait =
      recoveryPolicy.wait ??
      ((delay: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, delay)));
    void wait(delayMs)
      .then(async () => {
        if (
          selectedSessionId !== sessionId ||
          snapshot.phase !== "reconnecting"
        ) {
          return;
        }
        await controller.reconnect();
      })
      .catch((cause: unknown) => {
        if (selectedSessionId !== sessionId) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        publish({
          ...snapshot,
          phase: "failed",
          issue: { kind: "network", message },
        });
      })
      .finally(() => {
        reconnectRecoveryInFlight = false;
        if (
          selectedSessionId === sessionId &&
          snapshot.phase === "reconnecting" &&
          snapshot.issue !== undefined &&
          snapshot.issue.kind !== "contract" &&
          snapshot.issue.kind !== "resume_rejected"
        ) {
          scheduleReconnect(sessionId);
        }
      });
  };
  const handleStreamError = (
    error: FeedStreamError,
    sessionId: string,
  ): void => {
    if (selectedSessionId !== sessionId) return;
    if (error.kind !== "contract" && error.kind !== "resume_rejected") {
      streamGeneration += 1;
      stream?.close();
      stream = null;
      publish({ ...snapshot, phase: "reconnecting", issue: error });
      scheduleReconnect(sessionId);
      return;
    }
    const maximum = recoveryPolicy.maxContractRebootstraps ?? 1;
    if (recoveryInFlight) {
      streamGeneration += 1;
      stream?.close();
      stream = null;
      publish({ ...snapshot, phase: "failed", issue: error });
      return;
    }
    if (contractRebootstraps >= maximum) {
      streamGeneration += 1;
      stream?.close();
      stream = null;
      publish({ ...snapshot, phase: "failed", issue: error });
      return;
    }
    contractRebootstraps += 1;
    recoveryInFlight = true;
    void controller
      .bootstrap({ sessionId })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        publish({
          ...snapshot,
          phase: "failed",
          issue: { kind: "contract", message },
        });
      })
      .finally(() => {
        recoveryInFlight = false;
      });
  };

  controller = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async bootstrap({ sessionId }) {
      const generation = ++selectionGeneration;
      const connectionGeneration = ++streamGeneration;
      const retainLedger = selectedSessionId === sessionId;
      const uncertainResponseIds = retainLedger
        ? new Set(snapshot.pending
            .filter(interaction => interaction.responseState === "outcome_unknown")
            .map(interaction => interaction.requestId))
        : new Set<string>();
      selectedSessionId = sessionId;
      stream?.close();
      publish({
        phase: "bootstrapping",
        session: null,
        transcript: null,
        pending: [],
        activity: null,
        resetNotice: null,
      });

      const transcript = await port.fetchTranscript(sessionId);
      if (generation !== selectionGeneration) return;
      let installedLedger =
        retainLedger && semanticLedger !== null
          ? transitionLedger(
              semanticLedger,
              transcript.transcriptStreamId,
              transcript.messages,
            )
          : ledgerFromMessages(
              transcript.transcriptStreamId,
              transcript.messages,
            );
      const buffered: SessionStreamEvent[] = [];
      let buffering = true;
      let bufferedEof = false;
      const openedStream = await port.openSessionStream({
        sessionId,
        afterCursor: transcript.resumeToken,
        onEvent(event) {
          if (
            generation !== selectionGeneration ||
            connectionGeneration !== streamGeneration
          ) {
            return;
          }
          if (buffering) {
            buffered.push(event);
            return;
          }
          if (semanticLedger === null) {
            throw new Error("Structured event arrived before semantic bootstrap");
          }
          const reduced = reduceFeedEvent(snapshot, event, semanticLedger);
          semanticLedger = reduced.ledger;
          publish(reduced.snapshot);
          reconnectAttempt = 0;
          if (event.type === "structured") contractRebootstraps = 0;
        },
        onEof() {
          if (
            generation !== selectionGeneration ||
            connectionGeneration !== streamGeneration
          ) {
            return;
          }
          if (buffering) {
            bufferedEof = true;
          } else {
            handleEof();
          }
        },
        onError(error) {
          if (
            generation !== selectionGeneration ||
            connectionGeneration !== streamGeneration
          ) {
            return;
          }
          handleStreamError(error, sessionId);
        },
      });
      if (
        generation !== selectionGeneration ||
        connectionGeneration !== streamGeneration
      ) {
        openedStream.close();
        return;
      }
      stream = openedStream;
      const [pending, session] = await Promise.all([
        port.fetchPending(sessionId),
        port.fetchSession(sessionId),
      ]);
      if (
        generation !== selectionGeneration ||
        connectionGeneration !== streamGeneration
      ) {
        openedStream.close();
        return;
      }
      let installed: StructuredFeedSnapshot = {
        phase: "live",
        session,
        transcript: {
          transcriptStreamId: transcript.transcriptStreamId,
          resumeToken: transcript.resumeToken,
          messages: transcript.messages,
          ...(transcript.diagnostics === undefined ? {} : { diagnostics: transcript.diagnostics }),
          ...(transcript.degraded === undefined ? {} : { degraded: transcript.degraded }),
          ...(transcript.degradedReason === undefined ? {} : { degradedReason: transcript.degradedReason }),
          ...(transcript.continuityStatus === undefined ? {} : { continuityStatus: transcript.continuityStatus }),
          ...(transcript.continuityNote === undefined ? {} : { continuityNote: transcript.continuityNote }),
        },
        pending: pending.map((interaction) => ({
          ...interaction,
          responseState: uncertainResponseIds.has(interaction.requestId)
            ? "outcome_unknown" as const
            : "enabled" as const,
        })),
        activity: null,
        resetNotice: null,
      };
      for (const event of buffered) {
        const reduced = reduceFeedEvent(installed, event, installedLedger);
        installed = reduced.snapshot;
        installedLedger = reduced.ledger;
      }
      buffering = false;
      semanticLedger = installedLedger;
      publish(installed);
      if (bufferedEof) handleEof();
    },
    async reconnect() {
      if (selectedSessionId === null || snapshot.transcript === null) {
        throw new Error("Cannot reconnect before bootstrap");
      }
      const generation = selectionGeneration;
      const connectionGeneration = ++streamGeneration;
      const sessionId = selectedSessionId;
      const uncertainResponseIds = new Set(snapshot.pending
        .filter(interaction => interaction.responseState === "outcome_unknown")
        .map(interaction => interaction.requestId));
      stream?.close();
      publish({ ...snapshot, phase: "reconnecting" });

      const buffered: SessionStreamEvent[] = [];
      let buffering = true;
      let bufferedEof = false;
      const openedStream = await port.openSessionStream({
        sessionId,
        lastEventId: snapshot.transcript.resumeToken,
        onEvent(event) {
          if (
            generation !== selectionGeneration ||
            connectionGeneration !== streamGeneration
          ) {
            return;
          }
          if (buffering) {
            buffered.push(event);
            return;
          }
          if (semanticLedger === null) {
            throw new Error("Structured event arrived before semantic bootstrap");
          }
          const reduced = reduceFeedEvent(snapshot, event, semanticLedger);
          semanticLedger = reduced.ledger;
          publish(reduced.snapshot);
          reconnectAttempt = 0;
          if (event.type === "structured") contractRebootstraps = 0;
        },
        onEof() {
          if (
            generation !== selectionGeneration ||
            connectionGeneration !== streamGeneration
          ) {
            return;
          }
          if (buffering) {
            bufferedEof = true;
          } else {
            handleEof();
          }
        },
        onError(error) {
          if (
            generation !== selectionGeneration ||
            connectionGeneration !== streamGeneration
          ) {
            return;
          }
          handleStreamError(error, sessionId);
        },
      });
      if (
        generation !== selectionGeneration ||
        connectionGeneration !== streamGeneration
      ) {
        openedStream.close();
        return;
      }
      stream = openedStream;
      const [pending, session] = await Promise.all([
        port.fetchPending(sessionId),
        port.fetchSession(sessionId),
      ]);
      if (
        generation !== selectionGeneration ||
        connectionGeneration !== streamGeneration
      ) {
        openedStream.close();
        return;
      }
      const { issue: _issue, ...acceptedSnapshot } = snapshot;
      let installed: StructuredFeedSnapshot = {
        ...acceptedSnapshot,
        phase: "live",
        session,
        pending: pending.map((interaction) => ({
          ...interaction,
          responseState: uncertainResponseIds.has(interaction.requestId)
            ? "outcome_unknown" as const
            : "enabled" as const,
        })),
      };
      let installedLedger = semanticLedger;
      if (installedLedger === null) {
        throw new Error("Cannot reconnect before semantic bootstrap");
      }
      for (const event of buffered) {
        const reduced = reduceFeedEvent(installed, event, installedLedger);
        installed = reduced.snapshot;
        installedLedger = reduced.ledger;
      }
      buffering = false;
      semanticLedger = installedLedger;
      publish(installed);
      if (bufferedEof) handleEof();
    },
    async respond(requestId, response) {
      if (selectedSessionId === null) {
        throw new Error("Cannot respond before bootstrap");
      }
      const current = snapshot.pending.find(
        (interaction) => interaction.requestId === requestId,
      );
      if (current === undefined || current.responseState !== "enabled") {
        throw new Error(`Pending interaction ${requestId} is not actionable`);
      }
      const responseSessionId = selectedSessionId;
      const responseGeneration = selectionGeneration;
      publish({
        ...snapshot,
        pending: snapshot.pending.map((interaction) =>
          interaction.requestId === requestId
            ? { ...interaction, responseState: "submitting" }
            : interaction,
        ),
      });
      try {
        await port.respond(responseSessionId, requestId, response);
      } catch (error) {
        if (responseGeneration !== selectionGeneration || responseSessionId !== selectedSessionId) {
          throw error;
        }
        const outcomeUnknown = error instanceof FeedMutationError && error.outcome === "unknown";
        publish({
          ...snapshot,
          pending: snapshot.pending.map((interaction) =>
            interaction.requestId === requestId &&
            interaction.responseState === "submitting"
              ? { ...interaction, responseState: outcomeUnknown ? "outcome_unknown" : "enabled" }
              : interaction,
          ),
        });
        if (outcomeUnknown) {
          try {
            await controller.reconnect();
          } catch {
            // Preserve the original mutation uncertainty when its authoritative refresh also fails.
          }
        }
        throw error;
      }
      publish({
        ...snapshot,
        pending: snapshot.pending.map((interaction) =>
          interaction.requestId === requestId &&
          interaction.responseState === "submitting"
            ? { ...interaction, responseState: "awaiting_clear" }
            : interaction,
        ),
      });
    },
    dispose() {
      selectionGeneration += 1;
      streamGeneration += 1;
      selectedSessionId = null;
      stream?.close();
      stream = null;
      listeners.clear();
    },
  };
  return controller;
}

export type CityOperationKind = "session.create" | "session.submit";

export interface CityOperationDescriptor {
  readonly requestId: string;
  readonly operation: CityOperationKind;
  readonly eventCursor: string;
}

export interface CityEventFrame {
  readonly id: string;
  readonly eventType: string;
  readonly payload: unknown;
}

export interface CityStreamDisconnect {
  readonly kind: "eof" | "network" | "http" | "contract" | "unregistered";
  readonly status?: number;
  readonly retryAfterMs?: number;
}

export interface CityEventStreamRequest {
  readonly afterSeq?: string;
  readonly lastEventId?: string;
  readonly onEvent: (frame: CityEventFrame) => void;
  readonly onHeartbeat: () => void;
  readonly onDisconnect: (failure: CityStreamDisconnect) => void;
}

export interface CityOperationPort {
  openCityEventStream(
    request: CityEventStreamRequest,
  ): Promise<SessionStreamHandle>;
}

export interface CityOperationSnapshot {
  readonly phase:
    | "idle"
    | "connecting"
    | "watching"
    | "retrying"
    | "succeeded"
    | "failed"
    | "outcome_unknown"
    | "dismissed";
  readonly cursor: string;
  readonly terminal: CityEventFrame | null;
  readonly unknownReason?:
    | "malformed_terminal"
    | "unregistered"
    | "authorization"
    | "permanent_status"
    | "retry_exhausted"
    | "contract"
    | "watchdog_expired";
}

export interface CityOperationWatcherPolicy {
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly jitter?: (maximumMs: number) => number;
  readonly maxSilentAttempts?: number;
  readonly maxWatchMs?: number;
  readonly armWatchdog?: (
    onExpire: () => void,
    timeoutMs: number,
  ) => () => void;
}

export interface CityOperationWatcher {
  getSnapshot(): CityOperationSnapshot;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  dismiss(): void;
  dispose(): void;
}

const UINT64_MAX = 18_446_744_073_709_551_615n;

function parseCanonicalUint64(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Event ID ${JSON.stringify(value)} is not canonical uint64`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX) {
    throw new Error(`Event ID ${value} exceeds uint64`);
  }
  return parsed;
}

export function createCityOperationWatcher(
  port: CityOperationPort,
  operation: CityOperationDescriptor,
  policy: CityOperationWatcherPolicy = {},
): CityOperationWatcher {
  parseCanonicalUint64(operation.eventCursor);
  const successEventType = `request.result.${operation.operation}`;
  const wait = policy.wait ?? ((delayMs) => new Promise((done) => setTimeout(done, delayMs)));
  const armWatchdog =
    policy.armWatchdog ??
    ((onExpire: () => void, timeoutMs: number) => {
      const timer = setTimeout(onExpire, timeoutMs);
      return () => clearTimeout(timer);
    });
  let connection: SessionStreamHandle | null = null;
  let connectionGeneration = 0;
  let cancelWatchdog: (() => void) | null = null;
  let started = false;
  let dataCommitted = false;
  let poisonEventId: string | null = null;
  let contractFailureSeen = false;
  let consecutive401 = 0;
  let silentAttempts = 0;
  let retryAttempt = 0;
  let snapshot: CityOperationSnapshot = Object.freeze({
    phase: "idle",
    cursor: operation.eventCursor,
    terminal: null,
  });
  const listeners = new Set<() => void>();
  const publish = (next: CityOperationSnapshot): void => {
    snapshot = Object.freeze({ ...next });
    for (const listener of listeners) listener();
  };

  const finishUnknown = (
    reason: NonNullable<CityOperationSnapshot["unknownReason"]>,
  ): void => {
    cancelWatchdog?.();
    cancelWatchdog = null;
    connectionGeneration += 1;
    connection?.close();
    connection = null;
    publish({ ...snapshot, phase: "outcome_unknown", unknownReason: reason });
  };

  const payloadRequestId = (payload: unknown): string | null => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("request_id" in payload) ||
      typeof payload.request_id !== "string"
    ) {
      return null;
    }
    return payload.request_id;
  };

  const validSuccessPayload = (payload: unknown): boolean => {
    if (typeof payload !== "object" || payload === null) return false;
    if (operation.operation === "session.create") {
      return (
        "session" in payload &&
        typeof payload.session === "object" &&
        payload.session !== null &&
        "id" in payload.session &&
        typeof payload.session.id === "string"
      );
    }
    return "session_id" in payload && typeof payload.session_id === "string";
  };

  const nextRetryDelay = (minimumMs = 0): number => {
    const exponent = Math.min(retryAttempt, 10);
    retryAttempt += 1;
    const baseDelay = Math.min(500 * 2 ** exponent, 15_000);
    const requestedJitter = (
      policy.jitter ??
      ((maximumMs) => Math.floor(Math.random() * (maximumMs + 1)))
    )(250);
    const jitter = Math.max(0, Math.min(250, requestedJitter));
    return Math.max(minimumMs, baseDelay + jitter);
  };

  const connect = async (
    reconnect: boolean,
    retryDelayMs = 500,
  ): Promise<void> => {
    const generation = ++connectionGeneration;
    connection?.close();
    connection = null;
    if (reconnect) {
      publish({ ...snapshot, phase: "retrying" });
      await wait(retryDelayMs);
    } else {
      publish({ ...snapshot, phase: "connecting" });
    }
    if (generation !== connectionGeneration) return;
    const resume = dataCommitted
      ? { lastEventId: snapshot.cursor }
      : { afterSeq: operation.eventCursor };
    let sawFrame = false;
    const openedConnection = await port.openCityEventStream({
      ...resume,
      onEvent(frame) {
        if (generation !== connectionGeneration) return;
        sawFrame = true;
        silentAttempts = 0;
        retryAttempt = 0;
        try {
          const current = parseCanonicalUint64(snapshot.cursor);
          const next = parseCanonicalUint64(frame.id);
          if (next <= current) {
            throw new Error(
              `Event ID ${frame.id} did not advance beyond ${snapshot.cursor}`,
            );
          }
        } catch {
          if (contractFailureSeen) {
            finishUnknown("contract");
          } else {
            contractFailureSeen = true;
            void connect(true, nextRetryDelay());
          }
          return;
        }
        contractFailureSeen = false;
        if (
          frame.eventType === successEventType &&
          payloadRequestId(frame.payload) === operation.requestId
        ) {
          if (!validSuccessPayload(frame.payload)) {
            if (poisonEventId === frame.id) {
              finishUnknown("malformed_terminal");
            } else {
              poisonEventId = frame.id;
              void connect(true, nextRetryDelay());
            }
            return;
          }
          publish({ ...snapshot, phase: "succeeded", terminal: frame });
          publish({ ...snapshot, cursor: frame.id });
          dataCommitted = true;
          cancelWatchdog?.();
          cancelWatchdog = null;
          connection?.close();
          connection = null;
          return;
        }
        if (
          frame.eventType === "request.failed" &&
          typeof frame.payload === "object" &&
          frame.payload !== null &&
          "request_id" in frame.payload &&
          frame.payload.request_id === operation.requestId &&
          "operation" in frame.payload &&
          frame.payload.operation === operation.operation
        ) {
          if (
            !("error_code" in frame.payload) ||
            typeof frame.payload.error_code !== "string" ||
            !("error_message" in frame.payload) ||
            typeof frame.payload.error_message !== "string"
          ) {
            if (poisonEventId === frame.id) {
              finishUnknown("malformed_terminal");
            } else {
              poisonEventId = frame.id;
              void connect(true, nextRetryDelay());
            }
            return;
          }
          publish({ ...snapshot, phase: "failed", terminal: frame });
          publish({ ...snapshot, cursor: frame.id });
          dataCommitted = true;
          cancelWatchdog?.();
          cancelWatchdog = null;
          connection?.close();
          connection = null;
          return;
        }
        poisonEventId = null;
        consecutive401 = 0;
        dataCommitted = true;
        publish({ ...snapshot, phase: "watching", cursor: frame.id });
      },
      onHeartbeat() {
        if (generation !== connectionGeneration) return;
        sawFrame = true;
        silentAttempts = 0;
        retryAttempt = 0;
        consecutive401 = 0;
      },
      onDisconnect(failure) {
        if (generation !== connectionGeneration) return;
        if (
          snapshot.phase === "succeeded" ||
          snapshot.phase === "failed" ||
          snapshot.phase === "outcome_unknown" ||
          snapshot.phase === "dismissed"
        ) {
          return;
        }
        const retryTransient = (minimumDelayMs = 0): void => {
          if (sawFrame) {
            silentAttempts = 0;
            retryAttempt = 0;
          } else {
            silentAttempts += 1;
          }
          if (silentAttempts >= (policy.maxSilentAttempts ?? 8)) {
            finishUnknown("retry_exhausted");
            return;
          }
          void connect(true, nextRetryDelay(minimumDelayMs));
        };
        if (failure.kind === "unregistered") {
          finishUnknown("unregistered");
          return;
        }
        if (failure.kind === "contract") {
          if (contractFailureSeen) {
            finishUnknown("contract");
          } else {
            contractFailureSeen = true;
            void connect(true, nextRetryDelay());
          }
          return;
        }
        if (failure.kind === "http") {
          if (failure.status === 401) {
            consecutive401 += 1;
            if (consecutive401 >= 2) {
              finishUnknown("authorization");
              return;
            }
            retryTransient();
            return;
          }
          if (failure.status === 429 || failure.status === 503) {
            consecutive401 = 0;
            retryTransient(Math.max(500, failure.retryAfterMs ?? 0));
            return;
          }
          if (
            failure.status !== undefined &&
            failure.status >= 400 &&
            failure.status < 500
          ) {
            finishUnknown("permanent_status");
            return;
          }
        }
        consecutive401 = 0;
        retryTransient();
      },
    });
    if (generation !== connectionGeneration) {
      openedConnection.close();
      return;
    }
    connection = openedConnection;
    publish({ ...snapshot, phase: "watching" });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      if (started) return;
      started = true;
      cancelWatchdog = armWatchdog(
        () => finishUnknown("watchdog_expired"),
        policy.maxWatchMs ?? 5 * 60_000,
      );
      await connect(false);
    },
    dismiss() {
      connectionGeneration += 1;
      connection?.close();
      connection = null;
      cancelWatchdog?.();
      cancelWatchdog = null;
      publish({ ...snapshot, phase: "dismissed" });
    },
    dispose() {
      connectionGeneration += 1;
      connection?.close();
      connection = null;
      cancelWatchdog?.();
      cancelWatchdog = null;
      listeners.clear();
    },
  };
}
