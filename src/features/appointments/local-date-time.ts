export function localTimeToUtc(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(value);
  if (!match) throw new Error("Enter a real local date and time.");

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", millisecondText = "0"] = match;
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(millisecondText.padEnd(3, "0"));
  const date = new Date(0);
  date.setFullYear(year, monthIndex, day);
  date.setHours(hour, minute, second, millisecond);

  if (
    date.getFullYear() !== year
    || date.getMonth() !== monthIndex
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
    || date.getSeconds() !== second
    || date.getMilliseconds() !== millisecond
  ) {
    throw new Error("Enter a real local date and time.");
  }
  const utc = date.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(utc)) {
    throw new Error("Enter a real local date and time.");
  }
  return utc;
}
