import type { EventPublisher } from "./service-context";

export type AppointmentRevisionListener = (revision: number) => void;
export type UnsubscribeAppointmentEvents = () => void;

export class InProcessAppointmentEventPublisher implements EventPublisher {
  private readonly listeners = new Map<string, Set<AppointmentRevisionListener>>();

  subscribe(
    appointmentId: string,
    listener: AppointmentRevisionListener,
  ): UnsubscribeAppointmentEvents {
    let appointmentListeners = this.listeners.get(appointmentId);
    if (!appointmentListeners) {
      appointmentListeners = new Set();
      this.listeners.set(appointmentId, appointmentListeners);
    }
    appointmentListeners.add(listener);

    return () => {
      appointmentListeners.delete(listener);
      if (
        appointmentListeners.size === 0
        && this.listeners.get(appointmentId) === appointmentListeners
      ) {
        this.listeners.delete(appointmentId);
      }
    };
  }

  publish(appointmentId: string, revision: number): void {
    const appointmentListeners = this.listeners.get(appointmentId);
    if (!appointmentListeners) return;
    for (const listener of [...appointmentListeners]) {
      try {
        listener(revision);
      } catch {
        appointmentListeners.delete(listener);
      }
    }
    if (
      appointmentListeners.size === 0
      && this.listeners.get(appointmentId) === appointmentListeners
    ) {
      this.listeners.delete(appointmentId);
    }
  }
}

export const appointmentEventPublisher = new InProcessAppointmentEventPublisher();
