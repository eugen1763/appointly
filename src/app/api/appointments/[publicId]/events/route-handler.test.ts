import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../../../../features/appointments/http-errors";
import { InProcessAppointmentEventPublisher } from "../../../../../features/appointments/server/event-publisher";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";
import {
  createAppointmentEventsGetHandler,
  type AppointmentEventsGetDependencies,
  type AppointmentEventsTimer,
} from "./route-handler";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const APPOINTMENT_ID = "00000000-0000-4000-8000-000000000001";
const context = {} as ServiceContext;

type RevisionListener = (revision: number) => void;

function timerHarness() {
  let callback: (() => void) | undefined;
  const clearInterval = vi.fn();
  const timer: AppointmentEventsTimer = {
    setInterval(next, milliseconds) {
      expect(milliseconds).toBe(15_000);
      callback = next;
      return 1;
    },
    clearInterval,
  };
  return {
    timer,
    clearInterval,
    tick() {
      if (!callback) throw new Error("Heartbeat interval was not installed");
      callback();
    },
  };
}

function dependencyHarness(
  overrides: Partial<AppointmentEventsGetDependencies> = {},
) {
  let listener: RevisionListener | undefined;
  const unsubscribe = vi.fn();
  const timer = timerHarness();
  const subscriber = {
    subscribe: vi.fn((_appointmentId: string, next: RevisionListener) => {
      listener = next;
      return unsubscribe;
    }),
  };
  const dependencies: AppointmentEventsGetDependencies = {
    context,
    findEventTarget: vi.fn(() => ({ appointmentId: APPOINTMENT_ID, revision: 4 })),
    subscriber,
    timer: timer.timer,
    ...overrides,
  };
  return {
    dependencies,
    subscriber,
    unsubscribe,
    timer,
    listener: () => {
      if (!listener) throw new Error("Event listener was not installed");
      return listener;
    },
  };
}

function request(signal?: AbortSignal): Request {
  return new Request(`https://appointments.example/api/appointments/${PUBLIC_ID}/events`, {
    signal,
  });
}

function get(
  dependencies: AppointmentEventsGetDependencies,
  params: Record<string, string> = { publicId: PUBLIC_ID },
  signal?: AbortSignal,
): Promise<Response> {
  return createAppointmentEventsGetHandler(dependencies)(
    request(signal),
    { params: Promise.resolve(params) },
  );
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const chunk = await reader.read();
  expect(chunk.done).toBe(false);
  return new TextDecoder().decode(chunk.value);
}

describe("createAppointmentEventsGetHandler", () => {
  it.each([
    "bad",
    "a".repeat(23),
    "a".repeat(25),
    "!".repeat(24),
  ])("rejects invalid public ID %s before lookup or stream headers", async (publicId) => {
    const harness = dependencyHarness();

    const response = await get(harness.dependencies, { publicId });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("x-accel-buffering")).toBeNull();
    expect(await response.json()).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        fieldErrors: { publicId: expect.any(Array) },
      },
    });
    expect(harness.dependencies.findEventTarget).not.toHaveBeenCalled();
    expect(harness.subscriber.subscribe).not.toHaveBeenCalled();
  });

  it("rejects an unknown route param before lookup or stream construction", async () => {
    const harness = dependencyHarness();

    const response = await get(harness.dependencies, {
      publicId: PUBLIC_ID,
      extra: "value",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
    expect(harness.dependencies.findEventTarget).not.toHaveBeenCalled();
    expect(harness.subscriber.subscribe).not.toHaveBeenCalled();
  });

  it("returns an unknown appointment as stable JSON before subscribing", async () => {
    const harness = dependencyHarness({
      findEventTarget: vi.fn(() => {
        throw new AppError("NOT_FOUND", "Appointment was not found.");
      }),
    });

    const response = await get(harness.dependencies);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("x-accel-buffering")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Appointment was not found." },
    });
    expect(harness.subscriber.subscribe).not.toHaveBeenCalled();
  });

  it("completes lookup before stream construction and returns exact headers and initial frame", async () => {
    const calls: string[] = [];
    const harness = dependencyHarness({
      findEventTarget: vi.fn(() => {
        calls.push("lookup");
        return { appointmentId: APPOINTMENT_ID, revision: 4 };
      }),
    });
    harness.subscriber.subscribe.mockImplementation((_appointmentId, next) => {
      calls.push("subscribe");
      return harness.unsubscribe;
    });

    const response = await get(harness.dependencies);
    const reader = response.body!.getReader();

    expect(calls).toEqual(["lookup", "subscribe"]);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });
    expect(await readChunk(reader)).toBe(": connected\n\n");
    expect(harness.subscriber.subscribe).toHaveBeenCalledWith(
      APPOINTMENT_ID,
      expect.any(Function),
    );
    await reader.cancel();
  });

  it("frames a synchronously published revision", async () => {
    const publisher = new InProcessAppointmentEventPublisher();
    const timer = timerHarness();
    const dependencies: AppointmentEventsGetDependencies = {
      context,
      findEventTarget: vi.fn(() => ({ appointmentId: APPOINTMENT_ID, revision: 4 })),
      subscriber: publisher,
      timer: timer.timer,
    };
    const response = await get(dependencies);
    const reader = response.body!.getReader();
    await readChunk(reader);

    publisher.publish(APPOINTMENT_ID, 5);

    expect(await readChunk(reader)).toBe('data: {"revision":5}\n\n');
    await reader.cancel();
  });

  it("enqueues a heartbeat comment every 15 seconds", async () => {
    const harness = dependencyHarness();
    const response = await get(harness.dependencies);
    const reader = response.body!.getReader();
    await readChunk(reader);

    harness.timer.tick();

    expect(await readChunk(reader)).toBe(": heartbeat\n\n");
    await reader.cancel();
  });

  it("closes and releases resources when the request aborts", async () => {
    const abortController = new AbortController();
    const harness = dependencyHarness();
    const response = await get(harness.dependencies, undefined, abortController.signal);
    const reader = response.body!.getReader();
    await readChunk(reader);

    abortController.abort();

    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.timer.clearInterval).toHaveBeenCalledOnce();
  });

  it("releases resources when the response reader is canceled", async () => {
    const harness = dependencyHarness();
    const response = await get(harness.dependencies);
    const reader = response.body!.getReader();
    await readChunk(reader);

    await reader.cancel();

    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.timer.clearInterval).toHaveBeenCalledOnce();
  });

  it("contains enqueue failure and releases every resource only once", async () => {
    const abortController = new AbortController();
    const harness = dependencyHarness();
    const response = await get(harness.dependencies, undefined, abortController.signal);
    const reader = response.body!.getReader();
    await readChunk(reader);
    const listener = harness.listener();
    const enqueue = vi.spyOn(
      ReadableStreamDefaultController.prototype,
      "enqueue",
    ).mockImplementationOnce(() => {
      throw new Error("stream is closed");
    });

    try {
      expect(() => listener(8)).not.toThrow();
    } finally {
      enqueue.mockRestore();
    }
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    abortController.abort();

    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.timer.clearInterval).toHaveBeenCalledOnce();
  });

  it("propagates unknown lookup errors without constructing a stream", async () => {
    const error = new Error("database failed");
    const harness = dependencyHarness({
      findEventTarget: vi.fn(() => {
        throw error;
      }),
    });

    await expect(get(harness.dependencies)).rejects.toBe(error);
    expect(harness.subscriber.subscribe).not.toHaveBeenCalled();
  });
});
