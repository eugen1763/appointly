import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const roots: Array<{ container: HTMLDivElement; root: Root }> = [];

function setControlValue(control: Element, value: string): void {
  const prototype = control instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("The control has no value setter");
  setter.call(control, value);
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function roleElements(role: string): Element[] {
  const selector = role === "button" ? "button"
    : role === "heading" ? "h1,h2,h3,h4,h5,h6"
      : role === "link" ? "a[href]"
        : role === "list" ? "ol,ul"
          : `[role="${role}"]`;
  return Array.from(document.body.querySelectorAll(selector));
}

function accessibleName(element: Element): string {
  return element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
}

function matchesName(element: Element, name?: string | RegExp): boolean {
  if (name === undefined) return true;
  const value = accessibleName(element);
  return typeof name === "string" ? value === name : name.test(value);
}

export function render(node: ReactNode): void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  roots.push({ container, root });
}

export function cleanup(): void {
  for (const rendered of roots.splice(0)) {
    act(() => rendered.root.unmount());
    rendered.container.remove();
  }
}

export const fireEvent = {
  change(control: Element, init: { target: { value: string } }): void {
    act(() => setControlValue(control, init.target.value));
  },
  click(control: Element): void {
    act(() => (control as HTMLElement).click());
  },
};

export const screen = {
  getByLabelText(labelText: string): Element {
    const label = Array.from(document.body.querySelectorAll("label"))
      .find((item) => item.textContent === labelText);
    const control = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
    if (!control) throw new Error(`Control labelled ${labelText} was not rendered`);
    return control;
  },
  queryByLabelText(labelText: string): Element | null {
    const label = Array.from(document.body.querySelectorAll("label"))
      .find((item) => item.textContent === labelText);
    return label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  },
  getByRole(role: string, options: { name?: string | RegExp } = {}): Element {
    const element = roleElements(role).find((item) => matchesName(item, options.name));
    if (!element) throw new Error(`${role} ${String(options.name ?? "")} was not rendered`);
    return element;
  },
  queryByRole(role: string, options: { name?: string | RegExp } = {}): Element | null {
    return roleElements(role).find((item) => matchesName(item, options.name)) ?? null;
  },
  getAllByRole(role: string, options: { name?: string | RegExp } = {}): Element[] {
    const elements = roleElements(role).filter((item) => matchesName(item, options.name));
    if (elements.length === 0) throw new Error(`${role} ${String(options.name ?? "")} was not rendered`);
    return elements;
  },
  getByText(text: string): Element {
    const element = Array.from(document.body.querySelectorAll("*")).find(
      (item) => item.children.length === 0 && item.textContent?.trim() === text,
    );
    if (!element) throw new Error(`Text ${text} was not rendered`);
    return element;
  },
  async findByRole(role: string, options: { name?: string | RegExp } = {}): Promise<Element> {
    await act(async () => Promise.resolve());
    return this.getByRole(role, options);
  },
};

async function interact(operation: () => void): Promise<void> {
  await act(async () => {
    operation();
    await Promise.resolve();
  });
}

export const userEvent = {
  setup() {
    return {
      click(control: Element): Promise<void> {
        return interact(() => (control as HTMLElement).click());
      },
      clear(control: Element): Promise<void> {
        return interact(() => setControlValue(control, ""));
      },
      type(control: Element, text: string): Promise<void> {
        return interact(() => setControlValue(control, `${(control as HTMLInputElement).value}${text}`));
      },
      selectOptions(control: Element, value: string): Promise<void> {
        return interact(() => setControlValue(control, value));
      },
    };
  },
};
