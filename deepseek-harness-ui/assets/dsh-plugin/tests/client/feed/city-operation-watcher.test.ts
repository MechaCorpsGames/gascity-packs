import { describe, expect, it } from "vitest";

import {
  createCityOperationWatcher,
  type CityEventFrame,
  type CityOperationPort,
} from "../../../src/client/feed/index.js";

async function nextTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("city operation watcher", () => {
  it.each(["01", "-1", "18446744073709551616"])(
    "rejects non-canonical or out-of-range uint64 cursor %s",
    (eventCursor) => {
      expect(() =>
        createCityOperationWatcher(
          {
            async openCityEventStream() {
              return { close() {} };
            },
          },
          {
            requestId: "request-1",
            operation: "session.create",
            eventCursor,
          },
        ),
      ).toThrow(/canonical uint64|exceeds uint64/);
    },
  );

  it("keeps adjacent uint64 event IDs above Number.MAX_SAFE_INTEGER distinct", async () => {
    let emit!: (frame: CityEventFrame) => void;
    const requests: Parameters<CityOperationPort["openCityEventStream"]>[0][] =
      [];
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        requests.push(request);
        emit = request.onEvent;
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(port, {
      requestId: "request-1",
      operation: "session.create",
      eventCursor: "9007199254740992",
    });

    await watcher.start();
    expect(requests[0]).toMatchObject({ afterSeq: "9007199254740992" });

    emit({
      id: "9007199254740993",
      eventType: "session.activity",
      payload: {},
    });
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "watching",
      cursor: "9007199254740993",
    });

    emit({
      id: "9007199254740994",
      eventType: "session.activity",
      payload: {},
    });
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "watching",
      cursor: "9007199254740994",
    });
  });

  it("commits a matching terminal result before accepting its event cursor", async () => {
    let emit!: (frame: CityEventFrame) => void;
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(port, {
      requestId: "request-1",
      operation: "session.create",
      eventCursor: "41",
    });
    const observed: { phase: string; cursor: string }[] = [];
    watcher.subscribe(() => {
      const { phase, cursor } = watcher.getSnapshot();
      observed.push({ phase, cursor });
    });
    await watcher.start();

    emit({
      id: "42",
      eventType: "request.result.session.create",
      payload: {
        request_id: "some-other-request",
        session: { id: "session-other" },
      },
    });
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "watching",
      cursor: "42",
    });

    emit({
      id: "43",
      eventType: "request.result.session.create",
      payload: {
        request_id: "request-1",
        session: { id: "session-1" },
      },
    });

    expect(observed.slice(-2)).toEqual([
      { phase: "succeeded", cursor: "42" },
      { phase: "succeeded", cursor: "43" },
    ]);
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "succeeded",
      cursor: "43",
      terminal: { id: "43" },
    });
  });

  it("keeps an immediate replayed terminal result after the stream open resolves", async () => {
    let closeCount = 0;
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        request.onEvent({
          id: "42",
          eventType: "request.result.session.create",
          payload: {
            request_id: "request-1",
            session: { id: "session-1" },
          },
        });
        return {
          close() {
            closeCount += 1;
          },
        };
      },
    };
    const watcher = createCityOperationWatcher(port, {
      requestId: "request-1",
      operation: "session.create",
      eventCursor: "41",
    });

    await watcher.start();

    expect(watcher.getSnapshot()).toMatchObject({
      phase: "succeeded",
      cursor: "42",
      terminal: { id: "42" },
    });
    expect(closeCount).toBe(1);
  });

  it("replays a malformed matching terminal once then reports unknown outcome", async () => {
    const requests: Parameters<CityOperationPort["openCityEventStream"]>[0][] =
      [];
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        requests.push(request);
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(
      port,
      {
        requestId: "request-1",
        operation: "session.create",
        eventCursor: "41",
      },
      { wait: async () => {} },
    );
    await watcher.start();

    const malformed: CityEventFrame = {
      id: "42",
      eventType: "request.result.session.create",
      payload: { request_id: "request-1" },
    };
    requests[0]?.onEvent(malformed);
    await nextTurn();

    expect(requests[1]).toMatchObject({ afterSeq: "41" });
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "watching",
      cursor: "41",
    });

    requests[1]?.onEvent(malformed);
    await nextTurn();
    expect(requests).toHaveLength(2);
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "outcome_unknown",
      cursor: "41",
      unknownReason: "malformed_terminal",
    });
  });

  it("replays a malformed matching failure without committing its cursor", async () => {
    const requests: Parameters<CityOperationPort["openCityEventStream"]>[0][] =
      [];
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        requests.push(request);
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(
      port,
      {
        requestId: "request-1",
        operation: "session.submit",
        eventCursor: "41",
      },
      { wait: async () => {} },
    );
    await watcher.start();

    const malformed: CityEventFrame = {
      id: "42",
      eventType: "request.failed",
      payload: {
        request_id: "request-1",
        operation: "session.submit",
      },
    };
    requests[0]?.onEvent(malformed);
    await nextTurn();

    expect(requests[1]).toMatchObject({ afterSeq: "41" });
    expect(watcher.getSnapshot()).toMatchObject({ cursor: "41" });

    requests[1]?.onEvent(malformed);
    await nextTurn();
    expect(requests).toHaveLength(2);
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "outcome_unknown",
      cursor: "41",
      unknownReason: "malformed_terminal",
    });
  });

  it("honors transient retry-after and stops after two consecutive 401 responses", async () => {
    const requests: Parameters<CityOperationPort["openCityEventStream"]>[0][] =
      [];
    const waits: number[] = [];
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        requests.push(request);
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(
      port,
      {
        requestId: "request-1",
        operation: "session.submit",
        eventCursor: "100",
      },
      {
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      },
    );
    await watcher.start();

    requests[0]?.onDisconnect({
      kind: "http",
      status: 503,
      retryAfterMs: 7_000,
    });
    await nextTurn();
    expect(waits).toEqual([7_000]);
    expect(requests[1]).toMatchObject({ afterSeq: "100" });

    requests[1]?.onDisconnect({ kind: "http", status: 401 });
    await nextTurn();
    expect(requests).toHaveLength(3);

    requests[2]?.onDisconnect({ kind: "http", status: 401 });
    await nextTurn();
    expect(requests).toHaveLength(3);
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "outcome_unknown",
      cursor: "100",
      unknownReason: "authorization",
    });
  });

  it.each([
    [{ kind: "unregistered" } as const, "unregistered" as const],
    [
      { kind: "http", status: 404 } as const,
      "permanent_status" as const,
    ],
  ])("maps %j disconnect to %s outcome", async (failure, unknownReason) => {
    let disconnect!: Parameters<
      CityOperationPort["openCityEventStream"]
    >[0]["onDisconnect"];
    let closed = false;
    const watcher = createCityOperationWatcher(
      {
        async openCityEventStream(request) {
          disconnect = request.onDisconnect;
          return {
            close() {
              closed = true;
            },
          };
        },
      },
      {
        requestId: "request-1",
        operation: "session.create",
        eventCursor: "100",
      },
    );
    await watcher.start();

    disconnect(failure);

    expect(closed).toBe(true);
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "outcome_unknown",
      unknownReason,
      cursor: "100",
    });
  });

  it("bounds silent reconnects while heartbeats reset the silent budget", async () => {
    const requests: Parameters<CityOperationPort["openCityEventStream"]>[0][] =
      [];
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        requests.push(request);
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(
      port,
      {
        requestId: "request-1",
        operation: "session.submit",
        eventCursor: "100",
      },
      { maxSilentAttempts: 2, wait: async () => {} },
    );
    await watcher.start();

    requests[0]?.onDisconnect({ kind: "network" });
    await nextTurn();
    requests[1]?.onHeartbeat();
    requests[1]?.onDisconnect({ kind: "network" });
    await nextTurn();
    expect(requests).toHaveLength(3);

    requests[2]?.onDisconnect({ kind: "network" });
    await nextTurn();
    expect(requests).toHaveLength(4);
    requests[3]?.onDisconnect({ kind: "network" });
    await nextTurn();
    expect(requests).toHaveLength(4);
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "outcome_unknown",
      unknownReason: "retry_exhausted",
      cursor: "100",
    });
  });

  it("backs off exponentially and resets the schedule after a heartbeat", async () => {
    const requests: Parameters<CityOperationPort["openCityEventStream"]>[0][] =
      [];
    const waits: number[] = [];
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        requests.push(request);
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(
      port,
      {
        requestId: "request-1",
        operation: "session.submit",
        eventCursor: "100",
      },
      {
        jitter: () => 0,
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      },
    );
    await watcher.start();

    requests[0]?.onDisconnect({ kind: "network" });
    await nextTurn();
    requests[1]?.onDisconnect({ kind: "network" });
    await nextTurn();
    requests[2]?.onHeartbeat();
    requests[2]?.onDisconnect({ kind: "network" });
    await nextTurn();

    expect(waits).toEqual([500, 1_000, 500]);
    expect(requests).toHaveLength(4);
  });

  it("treats a matching submit failure after acceptance as outcome-ambiguous", async () => {
    let emit!: (frame: CityEventFrame) => void;
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(port, {
      requestId: "request-1",
      operation: "session.submit",
      eventCursor: "100",
    });
    await watcher.start();

    emit({
      id: "101",
      eventType: "request.failed",
      payload: {
        request_id: "request-1",
        operation: "session.create",
        error_code: "wrong-family",
        error_message: "must not complete submit",
      },
    });
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "watching",
      cursor: "101",
    });

    emit({
      id: "102",
      eventType: "request.failed",
      payload: {
        request_id: "request-1",
        operation: "session.submit",
        error_code: "submit_failed",
        error_message: "provider rejected message",
      },
    });
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "outcome_unknown",
      cursor: "102",
      unknownReason: "reported_ambiguous_failure",
      terminal: { id: "102", eventType: "request.failed" },
    });
  });

  it("keeps a pre-delivery submit resolution failure as a known failure", async () => {
    let emit!: (frame: CityEventFrame) => void;
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(port, {
      requestId: "request-1",
      operation: "session.submit",
      eventCursor: "100",
    });
    await watcher.start();

    emit({
      id: "101",
      eventType: "request.failed",
      payload: {
        request_id: "request-1",
        operation: "session.submit",
        error_code: "resolve_failed",
        error_message: "session no longer exists",
      },
    });

    expect(watcher.getSnapshot()).toMatchObject({
      phase: "failed",
      cursor: "101",
      terminal: { id: "101", eventType: "request.failed" },
    });
  });

  it("treats a create failure after acceptance as outcome-ambiguous", async () => {
    let emit!: (frame: CityEventFrame) => void;
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        emit = request.onEvent;
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(port, {
      requestId: "request-1",
      operation: "session.create",
      eventCursor: "100",
    });
    await watcher.start();

    emit({
      id: "101",
      eventType: "request.failed",
      payload: {
        request_id: "request-1",
        operation: "session.create",
        error_code: "create_failed",
        error_message: "session did not become commandable",
      },
    });

    expect(watcher.getSnapshot()).toMatchObject({
      phase: "outcome_unknown",
      cursor: "101",
      unknownReason: "reported_ambiguous_failure",
      terminal: { id: "101", eventType: "request.failed" },
    });
  });

  it("reconnects once for nonmonotonic IDs then reports a contract recurrence", async () => {
    const requests: Parameters<CityOperationPort["openCityEventStream"]>[0][] =
      [];
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        requests.push(request);
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(
      port,
      {
        requestId: "request-1",
        operation: "session.submit",
        eventCursor: "100",
      },
      { wait: async () => {} },
    );
    await watcher.start();
    requests[0]?.onEvent({
      id: "101",
      eventType: "session.activity",
      payload: {},
    });

    expect(() =>
      requests[0]?.onEvent({
        id: "101",
        eventType: "session.activity",
        payload: {},
      }),
    ).not.toThrow();
    await nextTurn();
    expect(requests[1]).toMatchObject({ lastEventId: "101" });

    requests[1]?.onEvent({
      id: "101",
      eventType: "session.activity",
      payload: {},
    });
    await nextTurn();
    expect(requests).toHaveLength(2);
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "outcome_unknown",
      unknownReason: "contract",
      cursor: "101",
    });
  });

  it("reconnects once for a transport contract failure then reports recurrence", async () => {
    const requests: Parameters<CityOperationPort["openCityEventStream"]>[0][] =
      [];
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        requests.push(request);
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(
      port,
      {
        requestId: "request-1",
        operation: "session.submit",
        eventCursor: "100",
      },
      { wait: async () => {} },
    );
    await watcher.start();

    requests[0]?.onDisconnect({ kind: "contract" });
    await nextTurn();
    expect(requests[1]).toMatchObject({ afterSeq: "100" });
    expect(watcher.getSnapshot()).toMatchObject({ phase: "watching" });

    requests[1]?.onDisconnect({ kind: "contract" });
    await nextTurn();
    expect(requests).toHaveLength(2);
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "outcome_unknown",
      unknownReason: "contract",
      cursor: "100",
    });
  });

  it("expires the whole operation even when the stream keeps heartbeating", async () => {
    let heartbeat!: () => void;
    let expire!: () => void;
    let watchdogCanceled = false;
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        heartbeat = request.onHeartbeat;
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(
      port,
      {
        requestId: "request-1",
        operation: "session.create",
        eventCursor: "100",
      },
      {
        maxWatchMs: 120_000,
        armWatchdog(onExpire, timeoutMs) {
          expect(timeoutMs).toBe(120_000);
          expire = onExpire;
          return () => {
            watchdogCanceled = true;
          };
        },
      },
    );
    await watcher.start();

    heartbeat();
    heartbeat();
    expire();

    expect(watcher.getSnapshot()).toMatchObject({
      phase: "outcome_unknown",
      unknownReason: "watchdog_expired",
      cursor: "100",
    });
    expect(watchdogCanceled).toBe(true);
  });

  it("ignores late disconnect callbacks from a superseded connection", async () => {
    const requests: Parameters<CityOperationPort["openCityEventStream"]>[0][] =
      [];
    const port: CityOperationPort = {
      async openCityEventStream(request) {
        requests.push(request);
        return { close() {} };
      },
    };
    const watcher = createCityOperationWatcher(
      port,
      {
        requestId: "request-1",
        operation: "session.submit",
        eventCursor: "100",
      },
      { wait: async () => {} },
    );
    await watcher.start();
    requests[0]?.onDisconnect({ kind: "network" });
    await nextTurn();
    expect(requests).toHaveLength(2);

    requests[0]?.onDisconnect({ kind: "eof" });
    await nextTurn();
    expect(requests).toHaveLength(2);
    expect(watcher.getSnapshot()).toMatchObject({ phase: "watching" });
  });

  it("dismissal closes the stream and ignores every late callback", async () => {
    let request!: Parameters<CityOperationPort["openCityEventStream"]>[0];
    let closed = false;
    const watcher = createCityOperationWatcher(
      {
        async openCityEventStream(nextRequest) {
          request = nextRequest;
          return {
            close() {
              closed = true;
            },
          };
        },
      },
      {
        requestId: "request-1",
        operation: "session.submit",
        eventCursor: "100",
      },
    );
    await watcher.start();

    watcher.dismiss();
    request.onEvent({
      id: "101",
      eventType: "request.result.session.submit",
      payload: { request_id: "request-1", session_id: "session-1" },
    });
    request.onDisconnect({ kind: "network" });

    expect(closed).toBe(true);
    expect(watcher.getSnapshot()).toMatchObject({
      phase: "dismissed",
      cursor: "100",
      terminal: null,
    });
  });
});
