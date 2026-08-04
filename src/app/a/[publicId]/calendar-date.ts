const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function formatCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error("Stored appointment date is invalid");
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthName = MONTH_NAMES[month - 1];
  if (!monthName || day < 1 || day > 31) {
    throw new Error("Stored appointment date is invalid");
  }
  return `${monthName} ${day}, ${match[1]}`;
}
