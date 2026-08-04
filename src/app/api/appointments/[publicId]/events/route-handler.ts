import { appointmentParamsSchema } from "../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../features/appointments/http-errors";
import type { AppointmentRevisionListener } from "../../../../../features/appointments/server/event-publisher";
import type { findAppointmentEventTarget } from "../../../../../features/appointments/server/event-stream";
import { parseRouteValue } from "../../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";

const HEARTBEAT_INTERVAL_MS = 15_000;
const CONNECTED_FRAME = ": connected\n\n";
const HEARTBEAT_FRAME = ": heartbeat\n\n";

export interface AppointmentEventSubscriber {
  subscribe(
    appointmentId: string,
    listener: AppointmentRevisionListener,
  ): () => void;
}

export interface AppointmentEventsTimer {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const systemTimer: AppointmentEventsTimer = {
  setInterval(callback, milliseconds) {
    return globalThis.setInterval(callback, milliseconds);
  },
  clearInterval(handle) {
    globalThis.clearInterval(
      handle as Parameters<typeof globalThis.clearInterval>[0],
    );
  },
};

export interface AppointmentEventsGetDependencies {
  readonly context: ServiceContext;
  readonly findEventTarget: typeof findAppointmentEventTarget;
  readonly subscriber: AppointmentEventSubscriber;
  readonly timer?: AppointmentEventsTimer;
}

export interface AppointmentEventsRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type AppointmentEventsGetHandler = (
  request: Request,
  routeContext: AppointmentEventsRouteContext,
) => Promise<Response>;

function createEventStream(
  appointmentId: string,
  requestSignal: AbortSignal,
  subscriber: AppointmentEventSubscriber,
  timer: AppointmentEventsTimer,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let intervalHandle: unknown;
  let unsubscribe: (() => void) | undefined;
  let released = false;

  const release = (closeStream: boolean): void => {
    if (released) return;
    released = true;
    requestSignal.removeEventListener("abort", onAbort);

    const activeInterval = intervalHandle;
    intervalHandle = undefined;
    if (activeInterval !== undefined) timer.clearInterval(activeInterval);

    const activeUnsubscribe = unsubscribe;
    unsubscribe = undefined;
    activeUnsubscribe?.();

    if (closeStream && controller !== undefined) {
      try {
        controller.close();
      } catch {
        // Cancellation may have closed the controller before abort delivery.
      }
    }
  };

  const enqueue = (frame: string): void => {
    if (released || controller === undefined) return;
    try {
      controller.enqueue(encoder.encode(frame));
    } catch {
      release(true);
    }
  };

  const onAbort = (): void => release(true);

  return new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      enqueue(CONNECTED_FRAME);
      if (released) return;

      const stopSubscription = subscriber.subscribe(
        appointmentId,
        (revision) => enqueue(`data: ${JSON.stringify({ revision })}\n\n`),
      );
      unsubscribe = stopSubscription;
      if (released) {
        unsubscribe = undefined;
        stopSubscription();
        return;
      }

      intervalHandle = timer.setInterval(
        () => enqueue(HEARTBEAT_FRAME),
        HEARTBEAT_INTERVAL_MS,
      );
      requestSignal.addEventListener("abort", onAbort, { once: true });
      if (requestSignal.aborted) onAbort();
    },
    cancel() {
      release(false);
    },
  });
}

export function createAppointmentEventsGetHandler(
  dependencies: AppointmentEventsGetDependencies,
): AppointmentEventsGetHandler {
  return async (request, routeContext) => {
    try {
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      const target = dependencies.findEventTarget(
        dependencies.context,
        params.publicId,
      );
      const stream = createEventStream(
        target.appointmentId,
        request.signal,
        dependencies.subscriber,
        dependencies.timer ?? systemTimer,
      );

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
