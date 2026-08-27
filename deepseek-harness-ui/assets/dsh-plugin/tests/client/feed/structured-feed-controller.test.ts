import { describe, expect, it } from "vitest";

import {
  createStructuredFeedController,
  FeedMutationError,
  type FeedPort,
  type PendingInteraction,
  type SessionStreamEvent,
  type StructuredMessageStatus,
  type StructuredResetReason,
} from "../../../src/client/feed/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

async function nextTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const STATUS_MATRIX: readonly (readonly [
  StructuredMessageStatus,
  StructuredMessageStatus,
  boolean,
])[] = [
  ["unknown", "unknown", true],
  ["unknown", "partial", true],
  ["unknown", "final", true],
  ["unknown", "superseded", true],
  ["partial", "unknown", false],
  ["partial", "partial", true],
  ["partial", "final", true],
  ["partial", "superseded", true],
  ["final", "unknown", false],
  ["final", "partial", false],
  ["final", "final", true],
  ["final", "superseded", true],
  ["superseded", "unknown", false],
  ["superseded", "partial", false],
  ["superseded", "final", false],
  ["superseded", "superseded", true],
];

const RESET_REASONS: readonly StructuredResetReason[] = [
  "resume_invalid",
  "stream_changed",
  "cursor_invalidated",
  "history_rewritten",
];

describe("structured feed controller", () => {
  it("opens a buffered stream after transcript and drains it after authoritative pending replacement", async () => {
    const calls: string[] = [];
    const pending = deferred<readonly PendingInteraction[]>();
    let emit!: (event: SessionStreamEvent) => void;

    const port: FeedPort = {
      async fetchTranscript() {
        calls.push("transcript");
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream(request) {
        calls.push(`open:${request.afterCursor ?? request.lastEventId}`);
        emit = request.onEvent;
        return { close() {} };
      },
      async fetchPending() {
        calls.push("pending");
        return pending.promise;
      },
      async fetchSession() {
        calls.push("session");
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };

    const controller = createStructuredFeedController(port);
    const bootstrapping = controller.bootstrap({ sessionId: "session-1" });
    await nextTurn();

    expect(calls[0]).toBe("transcript");
    expect(calls).toEqual([
      "transcript",
      "open:cursor-1",
      "pending",
      "session",
    ]);

    emit({
      type: "pending",
      interaction: {
        requestId: "request-1",
        kind: "approval",
        prompt: "Proceed?",
      },
    });
    expect(controller.getSnapshot().pending).toEqual([]);

    pending.resolve([]);
    await bootstrapping;

    expect(controller.getSnapshot()).toMatchObject({
      phase: "live",
      pending: [
        {
          requestId: "request-1",
          kind: "approval",
          prompt: "Proceed?",
          responseState: "enabled",
        },
      ],
      transcript: {
        transcriptStreamId: "stream-1",
        resumeToken: "cursor-1",
        messages: [],
      },
    });
  });

  it("reconnect replaces stale pending before draining events from the new stream", async () => {
    const reconnectPending = deferred<readonly PendingInteraction[]>();
    const streamRequests: Parameters<FeedPort["openSessionStream"]>[0][] = [];
    const emitters: ((event: SessionStreamEvent) => void)[] = [];
    let pendingRead = 0;

    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream(request) {
        streamRequests.push(request);
        emitters.push(request.onEvent);
        return { close() {} };
      },
      async fetchPending() {
        pendingRead += 1;
        if (pendingRead === 1) {
          return [
            {
              requestId: "stale-request",
              kind: "approval",
              prompt: "Old prompt",
            },
          ];
        }
        return reconnectPending.promise;
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };

    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });
    expect(controller.getSnapshot().pending[0]?.requestId).toBe(
      "stale-request",
    );

    const reconnecting = controller.reconnect();
    await nextTurn();
    expect(streamRequests[0]).toMatchObject({
      sessionId: "session-1",
      afterCursor: "cursor-1",
    });
    expect(streamRequests[1]).toMatchObject({
      sessionId: "session-1",
      lastEventId: "cursor-1",
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "reconnecting",
      pending: [{ requestId: "stale-request" }],
    });

    emitters[1]?.({
      type: "pending",
      interaction: {
        requestId: "new-request",
        kind: "question",
        prompt: "New prompt",
      },
    });
    reconnectPending.resolve([]);
    await reconnecting;

    expect(controller.getSnapshot()).toMatchObject({
      phase: "live",
      pending: [
        {
          requestId: "new-request",
          responseState: "enabled",
        },
      ],
    });
  });

  it("ignores late frames from the stream superseded by reconnect", async () => {
    const streamRequests: Parameters<FeedPort["openSessionStream"]>[0][] = [];
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream(request) {
        streamRequests.push(request);
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });
    await controller.reconnect();

    streamRequests[0]?.onEvent({
      type: "structured",
      id: "stale-cursor",
      operation: "upsert",
      transcriptStreamId: "stream-1",
      resumeToken: "stale-cursor",
      messages: [
        { id: "stale-message", role: "assistant", status: "partial" },
      ],
    });

    expect(controller.getSnapshot().transcript).toMatchObject({
      resumeToken: "cursor-1",
      messages: [],
    });
  });

  it("keeps a submitted interaction visible until clear is authoritative", async () => {
    const accepted = deferred<void>();
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream() {
        return { close() {} };
      },
      async fetchPending() {
        return [
          {
            requestId: "request-1",
            kind: "approval",
            prompt: "Proceed?",
          },
        ];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {
        return accepted.promise;
      },
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    const responding = controller.respond("request-1", { action: "approve" });
    expect(controller.getSnapshot().pending).toMatchObject([
      { requestId: "request-1", responseState: "submitting" },
    ]);

    accepted.resolve();
    await responding;
    expect(controller.getSnapshot().pending).toMatchObject([
      { requestId: "request-1", responseState: "awaiting_clear" },
    ]);
  });

  it("re-enables an interaction after a received response rejection", async () => {
    const accepted = deferred<void>();
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream() {
        return { close() {} };
      },
      async fetchPending() {
        return [
          {
            requestId: "request-1",
            kind: "approval",
            prompt: "Proceed?",
          },
        ];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {
        return accepted.promise;
      },
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    const responding = controller.respond("request-1", { action: "deny" });
    accepted.reject(new FeedMutationError("rejected", 409, "interaction conflict"));

    await expect(responding).rejects.toThrow("interaction conflict");
    expect(controller.getSnapshot().pending).toMatchObject([
      { requestId: "request-1", responseState: "enabled" },
    ]);
  });

  it("keeps an interaction uncertain and refreshes authoritative state after a lost response outcome", async () => {
    const calls: string[] = [];
    let streamNumber = 0;
    const port: FeedPort = {
      async fetchTranscript() {
        calls.push("transcript");
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream() {
        streamNumber += 1;
        calls.push(`stream:${streamNumber}`);
        return { close() {} };
      },
      async fetchPending() {
        calls.push("pending");
        return [
          {
            requestId: "request-1",
            kind: "approval",
            prompt: "Proceed?",
          },
        ];
      },
      async fetchSession() {
        calls.push("session");
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {
        calls.push("respond");
        throw new FeedMutationError(
          "unknown",
          502,
          "the interaction response may have been accepted",
        );
      },
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    const responding = controller.respond("request-1", { action: "approve" });

    await expect(responding).rejects.toThrow("may have been accepted");
    expect(calls).toEqual([
      "transcript",
      "stream:1",
      "pending",
      "session",
      "respond",
      "stream:2",
      "pending",
      "session",
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "live",
      pending: [
        { requestId: "request-1", responseState: "outcome_unknown" },
      ],
    });
  });

  it("keeps a same-id replacement actionable when an older response resolves", async () => {
    const accepted = deferred<void>();
    let emit!: (event: SessionStreamEvent) => void;
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
      async fetchPending() {
        return [
          {
            requestId: "request-1",
            kind: "approval",
            prompt: "Old prompt",
          },
        ];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {
        return accepted.promise;
      },
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    const responding = controller.respond("request-1", { action: "approve" });
    emit({
      type: "pending",
      interaction: {
        requestId: "request-1",
        kind: "approval",
        prompt: "Replacement prompt",
      },
    });
    accepted.resolve();
    await responding;

    expect(controller.getSnapshot().pending).toMatchObject([
      {
        requestId: "request-1",
        prompt: "Replacement prompt",
        responseState: "enabled",
      },
    ]);
  });

  it("commits a legal same-id transcript upsert in place with its cursor", async () => {
    let emit!: (event: SessionStreamEvent) => void;
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [
            { id: "message-1", role: "assistant", status: "partial" },
          ],
        };
      },
      async openSessionStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    emit({
      type: "structured",
      id: "cursor-2",
      operation: "upsert",
      transcriptStreamId: "stream-1",
      resumeToken: "cursor-2",
      messages: [
        { id: "message-1", role: "assistant", status: "final" },
      ],
    });

    expect(controller.getSnapshot().transcript).toEqual({
      transcriptStreamId: "stream-1",
      resumeToken: "cursor-2",
      messages: [
        { id: "message-1", role: "assistant", status: "final" },
      ],
    });
  });

  it.each(STATUS_MATRIX)(
    "enforces same-id status transition %s -> %s (allowed=%s)",
    async (from, to, allowed) => {
      let emit!: (event: SessionStreamEvent) => void;
      const port: FeedPort = {
        async fetchTranscript() {
          return {
            sessionId: "session-1",
            transcriptStreamId: "stream-1",
            resumeToken: "cursor-1",
            messages: [{ id: "message-1", role: "assistant", status: from }],
          };
        },
        async openSessionStream(request) {
          emit = request.onEvent;
          return { close() {} };
        },
        async fetchPending() {
          return [];
        },
        async fetchSession() {
          return { id: "session-1", state: "active", closed: false };
        },
        async respond() {},
      };
      const controller = createStructuredFeedController(port);
      await controller.bootstrap({ sessionId: "session-1" });
      const update: SessionStreamEvent = {
        type: "structured",
        id: "cursor-2",
        operation: "upsert",
        transcriptStreamId: "stream-1",
        resumeToken: "cursor-2",
        messages: [{ id: "message-1", role: "assistant", status: to }],
      };

      if (allowed) {
        emit(update);
        expect(controller.getSnapshot().transcript).toMatchObject({
          resumeToken: "cursor-2",
          messages: [{ id: "message-1", status: to }],
        });
      } else {
        expect(() => emit(update)).toThrow(
          `cannot transition status from ${from} to ${to}`,
        );
        expect(controller.getSnapshot().transcript).toMatchObject({
          resumeToken: "cursor-1",
          messages: [{ id: "message-1", status: from }],
        });
      }
    },
  );

  it("rejects a terminal status regression without advancing the cursor", async () => {
    let emit!: (event: SessionStreamEvent) => void;
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [
            { id: "message-1", role: "assistant", status: "final" },
          ],
        };
      },
      async openSessionStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    expect(() =>
      emit({
        type: "structured",
        id: "cursor-2",
        operation: "upsert",
        transcriptStreamId: "stream-1",
        resumeToken: "cursor-2",
        messages: [
          { id: "message-1", role: "assistant", status: "partial" },
        ],
      }),
    ).toThrow("cannot transition status from final to partial");
    expect(controller.getSnapshot().transcript).toMatchObject({
      resumeToken: "cursor-1",
      messages: [{ id: "message-1", status: "final" }],
    });
  });

  it("rejects a structured event whose SSE id differs from its resume token", async () => {
    let emit!: (event: SessionStreamEvent) => void;
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    expect(() =>
      emit({
        type: "structured",
        id: "different-cursor",
        operation: "upsert",
        transcriptStreamId: "stream-1",
        resumeToken: "cursor-2",
        messages: [],
      }),
    ).toThrow("SSE id does not match structured resume token");
    expect(controller.getSnapshot().transcript).toMatchObject({
      resumeToken: "cursor-1",
      messages: [],
    });
  });

  it("rejects a same-id role change without advancing the cursor", async () => {
    let emit!: (event: SessionStreamEvent) => void;
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [
            { id: "message-1", role: "assistant", status: "partial" },
          ],
        };
      },
      async openSessionStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    expect(() =>
      emit({
        type: "structured",
        id: "cursor-2",
        operation: "upsert",
        transcriptStreamId: "stream-1",
        resumeToken: "cursor-2",
        messages: [
          { id: "message-1", role: "system", status: "partial" },
        ],
      }),
    ).toThrow("changed role from assistant to system");
    expect(controller.getSnapshot().transcript).toMatchObject({
      resumeToken: "cursor-1",
      messages: [{ id: "message-1", role: "assistant" }],
    });
  });

  it("rejects a change to an observed same-id tool identity", async () => {
    let emit!: (event: SessionStreamEvent) => void;
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [
            {
              id: "message-1",
              role: "assistant",
              status: "partial",
              blocks: [{ type: "tool_use", id: "tool-1", name: "Read" }],
            },
          ],
        };
      },
      async openSessionStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    expect(() =>
      emit({
        type: "structured",
        id: "cursor-2",
        operation: "upsert",
        transcriptStreamId: "stream-1",
        resumeToken: "cursor-2",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            status: "final",
            blocks: [{ type: "tool_use", id: "tool-2", name: "Read" }],
          },
        ],
      }),
    ).toThrow("changed tool_use[0].id from tool-1 to tool-2");
    expect(controller.getSnapshot().transcript).toMatchObject({
      resumeToken: "cursor-1",
      messages: [{ status: "partial" }],
    });
  });

  it("allows newly observed tool identity but preserves every observed tool field", async () => {
    let emit!: (event: SessionStreamEvent) => void;
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [
            {
              id: "message-use",
              role: "assistant",
              status: "partial",
              blocks: [{ type: "tool_use", name: "Read" }],
            },
            {
              id: "message-result",
              role: "assistant",
              status: "partial",
              blocks: [
                {
                  type: "tool_result",
                  tool_call_id: "tool-1",
                  name: "Read",
                },
              ],
            },
          ],
        };
      },
      async openSessionStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    emit({
      type: "structured",
      id: "cursor-2",
      operation: "upsert",
      transcriptStreamId: "stream-1",
      resumeToken: "cursor-2",
      messages: [
        {
          id: "message-use",
          role: "assistant",
          status: "partial",
          blocks: [{ type: "tool_use", id: "tool-1", name: "Read" }],
        },
      ],
    });
    expect(controller.getSnapshot().transcript).toMatchObject({
      resumeToken: "cursor-2",
    });

    expect(() =>
      emit({
        type: "structured",
        id: "cursor-3",
        operation: "upsert",
        transcriptStreamId: "stream-1",
        resumeToken: "cursor-3",
        messages: [
          {
            id: "message-use",
            role: "assistant",
            status: "final",
            blocks: [{ type: "tool_use", id: "tool-1", name: "Write" }],
          },
        ],
      }),
    ).toThrow("changed tool_use[0].name from Read to Write");
    expect(() =>
      emit({
        type: "structured",
        id: "cursor-3",
        operation: "upsert",
        transcriptStreamId: "stream-1",
        resumeToken: "cursor-3",
        messages: [
          {
            id: "message-result",
            role: "assistant",
            status: "final",
            blocks: [
              {
                type: "tool_result",
                tool_call_id: "tool-2",
                name: "Read",
              },
            ],
          },
        ],
      }),
    ).toThrow(
      "changed tool_result[0].tool_call_id from tool-1 to tool-2",
    );
    expect(controller.getSnapshot().transcript).toMatchObject({
      resumeToken: "cursor-2",
    });
  });

  it("retains same-stream semantic authority after a snapshot omits a message", async () => {
    let emit!: (event: SessionStreamEvent) => void;
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [
            { id: "message-1", role: "assistant", status: "final" },
          ],
        };
      },
      async openSessionStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    emit({
      type: "structured",
      id: "cursor-2",
      operation: "snapshot",
      transcriptStreamId: "stream-1",
      resumeToken: "cursor-2",
      messages: [],
    });
    expect(controller.getSnapshot().transcript).toMatchObject({
      resumeToken: "cursor-2",
      messages: [],
    });

    expect(() =>
      emit({
        type: "structured",
        id: "cursor-3",
        operation: "upsert",
        transcriptStreamId: "stream-1",
        resumeToken: "cursor-3",
        messages: [
          { id: "message-1", role: "assistant", status: "partial" },
        ],
      }),
    ).toThrow("cannot transition status from final to partial");
    expect(controller.getSnapshot().transcript).toMatchObject({
      resumeToken: "cursor-2",
      messages: [],
    });
  });

  it.each(RESET_REASONS)(
    "records %s reset provenance while retaining same-stream semantic authority",
    async (resetReason) => {
      let emit!: (event: SessionStreamEvent) => void;
      const port: FeedPort = {
        async fetchTranscript() {
          return {
            sessionId: "session-1",
            transcriptStreamId: "stream-1",
            resumeToken: "cursor-1",
            messages: [
              { id: "message-1", role: "assistant", status: "final" },
            ],
          };
        },
        async openSessionStream(request) {
          emit = request.onEvent;
          return { close() {} };
        },
        async fetchPending() {
          return [];
        },
        async fetchSession() {
          return { id: "session-1", state: "active", closed: false };
        },
        async respond() {},
      };
      const controller = createStructuredFeedController(port);
      await controller.bootstrap({ sessionId: "session-1" });

      emit({
        type: "structured",
        id: "cursor-2",
        operation: "reset",
        transcriptStreamId: "stream-1",
        resumeToken: "cursor-2",
        resetReason,
        messages: [],
      });
      expect(controller.getSnapshot()).toMatchObject({
        resetNotice: { reason: resetReason },
        transcript: { resumeToken: "cursor-2", messages: [] },
      });

      expect(() =>
        emit({
          type: "structured",
          id: "cursor-3",
          operation: "upsert",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-3",
          messages: [
            { id: "message-1", role: "assistant", status: "partial" },
          ],
        }),
      ).toThrow("cannot transition status from final to partial");
      expect(controller.getSnapshot().transcript).toMatchObject({
        resumeToken: "cursor-2",
        messages: [],
      });
    },
  );

  it("becomes quiescent when a closed terminal idle stream reaches EOF", async () => {
    let emit!: (event: SessionStreamEvent) => void;
    let eof!: () => void;
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [
            { id: "message-1", role: "assistant", status: "final" },
          ],
        };
      },
      async openSessionStream(request) {
        emit = request.onEvent;
        eof = request.onEof;
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "closed", closed: true };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    emit({ type: "activity", activity: "idle" });
    eof();

    expect(controller.getSnapshot()).toMatchObject({
      phase: "quiescent",
      activity: "idle",
      session: { closed: true },
      transcript: { messages: [{ status: "final" }] },
    });
  });

  it("authoritatively rebootstraps an ambiguous non-quiescent EOF", async () => {
    let transcriptReads = 0;
    const streamRequests: Parameters<FeedPort["openSessionStream"]>[0][] = [];
    const port: FeedPort = {
      async fetchTranscript() {
        transcriptReads += 1;
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: `cursor-${transcriptReads}`,
          messages: [],
        };
      },
      async openSessionStream(request) {
        streamRequests.push(request);
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-1" });

    streamRequests[0]?.onEof();
    await nextTurn();
    await nextTurn();

    expect(transcriptReads).toBe(2);
    expect(streamRequests[1]).toMatchObject({
      sessionId: "session-1",
      afterCursor: "cursor-2",
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "live",
      transcript: { resumeToken: "cursor-2" },
    });
  });

  it("performs one contract rebootstrap then fails a recurrence before stability", async () => {
    const streamRequests: Parameters<FeedPort["openSessionStream"]>[0][] = [];
    let transcriptReads = 0;
    const port: FeedPort = {
      async fetchTranscript() {
        transcriptReads += 1;
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: `cursor-${transcriptReads}`,
          messages: [],
        };
      },
      async openSessionStream(request) {
        streamRequests.push(request);
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port, {
      maxContractRebootstraps: 1,
    });
    await controller.bootstrap({ sessionId: "session-1" });

    streamRequests[0]?.onError({
      kind: "contract",
      message: "malformed SSE frame",
    });
    await nextTurn();
    await nextTurn();
    expect({ transcriptReads, streams: streamRequests.length }).toEqual({
      transcriptReads: 2,
      streams: 2,
    });
    expect(controller.getSnapshot()).toMatchObject({ phase: "live" });

    streamRequests[1]?.onError({
      kind: "contract",
      message: "malformed SSE frame again",
    });
    await nextTurn();
    expect({ transcriptReads, streams: streamRequests.length }).toEqual({
      transcriptReads: 2,
      streams: 2,
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      issue: {
        kind: "contract",
        message: "malformed SSE frame again",
      },
    });
  });

  it("fails a contract recurrence reported while its rebootstrap is opening", async () => {
    const streamRequests: Parameters<FeedPort["openSessionStream"]>[0][] = [];
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream(request) {
        streamRequests.push(request);
        if (streamRequests.length === 2) {
          request.onError({
            kind: "contract",
            message: "contract recurred during rebootstrap",
          });
        }
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port, {
      maxContractRebootstraps: 1,
    });
    await controller.bootstrap({ sessionId: "session-1" });

    streamRequests[0]?.onError({
      kind: "contract",
      message: "initial contract failure",
    });
    await nextTurn();
    await nextTurn();

    expect(streamRequests).toHaveLength(2);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      issue: {
        kind: "contract",
        message: "contract recurred during rebootstrap",
      },
    });
  });

  it("automatically reconnects a network failure from the last committed cursor", async () => {
    const streamRequests: Parameters<FeedPort["openSessionStream"]>[0][] = [];
    const waits: number[] = [];
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream(request) {
        streamRequests.push(request);
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port, {
      jitter: () => 0,
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    });
    await controller.bootstrap({ sessionId: "session-1" });

    streamRequests[0]?.onError({
      kind: "network",
      message: "connection lost",
    });
    await nextTurn();
    await nextTurn();

    expect(waits).toEqual([500]);
    expect(streamRequests[1]).toMatchObject({
      sessionId: "session-1",
      lastEventId: "cursor-1",
    });
    expect(controller.getSnapshot()).toMatchObject({ phase: "live" });
  });

  it("continues backoff when a replacement stream fails while opening", async () => {
    const streamRequests: Parameters<FeedPort["openSessionStream"]>[0][] = [];
    const waits: number[] = [];
    const port: FeedPort = {
      async fetchTranscript() {
        return {
          sessionId: "session-1",
          transcriptStreamId: "stream-1",
          resumeToken: "cursor-1",
          messages: [],
        };
      },
      async openSessionStream(request) {
        streamRequests.push(request);
        if (streamRequests.length === 2) {
          request.onError({
            kind: "network",
            message: "replacement failed while opening",
          });
        }
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession() {
        return { id: "session-1", state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port, {
      jitter: () => 0,
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    });
    await controller.bootstrap({ sessionId: "session-1" });

    streamRequests[0]?.onError({
      kind: "network",
      message: "connection lost",
    });
    await nextTurn();
    await nextTurn();
    await nextTurn();
    await nextTurn();

    expect(waits).toEqual([500, 1_000]);
    expect(streamRequests).toHaveLength(3);
    expect(controller.getSnapshot()).toMatchObject({ phase: "live" });
  });

  it("does not open or commit a slow bootstrap after selection changes", async () => {
    const oldTranscript = deferred<{
      sessionId: string;
      transcriptStreamId: string;
      resumeToken: string;
      messages: [];
    }>();
    const openedSessions: string[] = [];
    const port: FeedPort = {
      async fetchTranscript(sessionId) {
        if (sessionId === "session-old") return oldTranscript.promise;
        return {
          sessionId,
          transcriptStreamId: "stream-new",
          resumeToken: "cursor-new",
          messages: [],
        };
      },
      async openSessionStream(request) {
        openedSessions.push(request.sessionId);
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession(sessionId) {
        return { id: sessionId, state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);

    const oldBootstrap = controller.bootstrap({ sessionId: "session-old" });
    await controller.bootstrap({ sessionId: "session-new" });
    oldTranscript.resolve({
      sessionId: "session-old",
      transcriptStreamId: "stream-old",
      resumeToken: "cursor-old",
      messages: [],
    });
    await oldBootstrap;

    expect(openedSessions).toEqual(["session-new"]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "live",
      session: { id: "session-new" },
      transcript: { transcriptStreamId: "stream-new" },
    });
  });

  it("does not open or commit a slow bootstrap after disposal", async () => {
    const transcript = deferred<{
      sessionId: string;
      transcriptStreamId: string;
      resumeToken: string;
      messages: [];
    }>();
    const openedSessions: string[] = [];
    const port: FeedPort = {
      async fetchTranscript() {
        return transcript.promise;
      },
      async openSessionStream(request) {
        openedSessions.push(request.sessionId);
        return { close() {} };
      },
      async fetchPending() {
        return [];
      },
      async fetchSession(sessionId) {
        return { id: sessionId, state: "active", closed: false };
      },
      async respond() {},
    };
    const controller = createStructuredFeedController(port);

    const bootstrapping = controller.bootstrap({ sessionId: "session-1" });
    controller.dispose();
    transcript.resolve({
      sessionId: "session-1",
      transcriptStreamId: "stream-1",
      resumeToken: "cursor-1",
      messages: [],
    });
    await bootstrapping;

    expect(openedSessions).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({ phase: "bootstrapping" });
  });

  it("does not apply an old response result to a same-id interaction in a new session", async () => {
    const accepted = deferred<void>();
    const port: FeedPort = {
      async fetchTranscript(sessionId) {
        return {
          sessionId,
          transcriptStreamId: `stream-${sessionId}`,
          resumeToken: `cursor-${sessionId}`,
          messages: [],
        };
      },
      async openSessionStream() {
        return { close() {} };
      },
      async fetchPending() {
        return [
          {
            requestId: "shared-request",
            kind: "approval",
            prompt: "Proceed?",
          },
        ];
      },
      async fetchSession(sessionId) {
        return { id: sessionId, state: "active", closed: false };
      },
      async respond() {
        return accepted.promise;
      },
    };
    const controller = createStructuredFeedController(port);
    await controller.bootstrap({ sessionId: "session-old" });

    const responding = controller.respond("shared-request", {
      action: "approve",
    });
    await controller.bootstrap({ sessionId: "session-new" });
    accepted.resolve();
    await responding;

    expect(controller.getSnapshot()).toMatchObject({
      session: { id: "session-new" },
      pending: [
        { requestId: "shared-request", responseState: "enabled" },
      ],
    });
  });
});
