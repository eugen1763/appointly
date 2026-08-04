// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonthGrid, type MonthCursor } from "./MonthGrid";
import { cleanup, fireEvent, render, screen } from "./react-dom-test-support";

const APRIL_2030: MonthCursor = { year: 2030, monthIndex: 3 };

interface RenderGridOptions {
  month?: MonthCursor;
  selectedDays?: ReadonlySet<string>;
  today?: string;
}

function renderGrid(options: RenderGridOptions = {}) {
  const onToggleDay = vi.fn<(isoDate: string, picked: boolean) => void>();
  const onStepMonth = vi.fn<(delta: -1 | 1) => void>();

  render(
    <MonthGrid
      month={options.month ?? APRIL_2030}
      selectedDays={options.selectedDays ?? new Set()}
      today={options.today ?? "2030-04-15"}
      onToggleDay={onToggleDay}
      onStepMonth={onStepMonth}
    />,
  );

  return { onToggleDay, onStepMonth };
}

function dayButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-date]"));
}

function dayButton(isoDate: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-date="${isoDate}"]`);
  if (!button) throw new Error(`Day ${isoDate} was not rendered`);
  return button;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MonthGrid", () => {
  it("labels the month without Intl and pads the grid to the first weekday", () => {
    renderGrid();

    expect(document.querySelector("[data-cal-month]")?.textContent).toBe("April 2030");
    const cells = Array.from(dayButton("2030-04-01").parentElement?.children ?? []);
    const blanks = cells.filter((cell) => !cell.hasAttribute("data-date"));
    expect(blanks).toHaveLength(1);
    expect(cells.indexOf(dayButton("2030-04-01"))).toBe(1);
  });

  it("renders one accessible button per calendar day", () => {
    renderGrid();

    const buttons = dayButtons();
    expect(buttons).toHaveLength(30);
    expect(buttons[0].getAttribute("data-date")).toBe("2030-04-01");
    expect(buttons[29].getAttribute("data-date")).toBe("2030-04-30");
    expect(buttons[0].getAttribute("aria-label")).toBe("April 1, 2030");
    expect(buttons[29].getAttribute("aria-label")).toBe("April 30, 2030");
    expect(buttons[29].textContent).toBe("30");
  });

  it("disables past days, enables today, and marks today and weekends", () => {
    renderGrid();

    expect(dayButton("2030-04-14").disabled).toBe(true);
    expect(dayButton("2030-04-15").disabled).toBe(false);
    expect(dayButton("2030-04-15").getAttribute("data-today")).toBe("1");
    expect(dayButton("2030-04-16").getAttribute("data-today")).toBeNull();
    expect(dayButton("2030-04-20").getAttribute("data-weekend")).toBe("1");
    expect(dayButton("2030-04-16").getAttribute("data-weekend")).toBeNull();
  });

  it("reflects the selected days through aria-pressed", () => {
    renderGrid({ selectedDays: new Set(["2030-04-16", "2030-04-20"]) });

    expect(dayButton("2030-04-16").getAttribute("aria-pressed")).toBe("true");
    expect(dayButton("2030-04-20").getAttribute("aria-pressed")).toBe("true");
    expect(dayButton("2030-04-17").getAttribute("aria-pressed")).toBe("false");
  });

  it("reports the toggled day and its next picked state", () => {
    const { onToggleDay } = renderGrid({ selectedDays: new Set(["2030-04-20"]) });

    fireEvent.click(dayButton("2030-04-16"));
    fireEvent.click(dayButton("2030-04-20"));

    expect(onToggleDay).toHaveBeenNthCalledWith(1, "2030-04-16", true);
    expect(onToggleDay).toHaveBeenNthCalledWith(2, "2030-04-20", false);
  });

  it("steps the month in both directions", () => {
    const { onStepMonth } = renderGrid();

    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));

    expect(onStepMonth).toHaveBeenNthCalledWith(1, -1);
    expect(onStepMonth).toHaveBeenNthCalledWith(2, 1);
  });
});
