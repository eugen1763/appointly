import { describe, expect, it, vi } from "vitest";

import { InProcessAppointmentEventPublisher } from "./event-publisher";

describe("InProcessAppointmentEventPublisher", () => {
  it("publishes synchronously to current subscribers and supports unsubscribe", () => {
    const publisher = new InProcessAppointmentEventPublisher();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = publisher.subscribe("appointment-1", first);
    publisher.subscribe("appointment-1", second);
    publisher.subscribe("appointment-2", vi.fn());

    publisher.publish("appointment-1", 2);
    unsubscribeFirst();
    publisher.publish("appointment-1", 3);

    expect(first.mock.calls).toEqual([[2]]);
    expect(second.mock.calls).toEqual([[2], [3]]);
  });

  it("removes a throwing subscriber and still notifies later subscribers", () => {
    const publisher = new InProcessAppointmentEventPublisher();
    const throwing = vi.fn(() => {
      throw new Error("subscriber failed");
    });
    const later = vi.fn();
    publisher.subscribe("appointment-1", throwing);
    publisher.subscribe("appointment-1", later);

    expect(() => publisher.publish("appointment-1", 2)).not.toThrow();
    publisher.publish("appointment-1", 3);

    expect(throwing.mock.calls).toEqual([[2]]);
    expect(later.mock.calls).toEqual([[2], [3]]);
  });

  it("does not let a stale unsubscribe remove a replacement listener set", () => {
    const publisher = new InProcessAppointmentEventPublisher();
    const unsubscribeThrowing = publisher.subscribe("appointment-1", () => {
      throw new Error("subscriber failed");
    });
    publisher.publish("appointment-1", 2);

    const replacement = vi.fn();
    publisher.subscribe("appointment-1", replacement);
    unsubscribeThrowing();
    publisher.publish("appointment-1", 3);

    expect(replacement.mock.calls).toEqual([[3]]);
  });
});
