import type { ServiceContext, TransactionContext } from "./service-context";

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && "then" in value && typeof value.then === "function";
}

export function runImmediate<T>(
  context: ServiceContext,
  operation: (context: TransactionContext) => T,
): T {
  const transactionContext: TransactionContext = {
    db: context.db,
    sqlite: context.sqlite,
    clock: context.clock,
    tokenFactory: context.tokenFactory,
  };

  return context.sqlite.transaction(() => {
    const result = operation(transactionContext);
    if (isPromiseLike(result)) {
      throw new TypeError("Immediate transaction operations must be synchronous");
    }
    return result;
  }).immediate();
}

export function publishAppointmentRevision(
  context: ServiceContext,
  appointmentId: string,
  revision: number,
): void {
  try {
    context.eventPublisher.publish(appointmentId, revision);
  } catch {
    // The commit remains valid; clients repair a missed event on their next fetch.
  }
}
