export interface OptionYesCount {
  readonly id: string;
  readonly yesCount: number;
}

/**
 * The options that are ahead — or none at all.
 *
 * Leaders are marked only when at least one option is strictly behind them. A mark
 * on every option carries exactly as much information as a mark on none, and it
 * spends the amber signal on undifferentiated noise: creation records the creator's
 * Yes on every option, so a fresh appointment starts with every option tied at one
 * and would otherwise be entirely amber the moment it is first shared. Joint
 * leaders standing above a lower option are still all marked, because at that point
 * the mark is telling the reader something true.
 *
 * Shared by the board and the dashboard card so both answer "who is ahead?" the
 * same way; server code cannot import the view module, whose CSS-module imports
 * break under the node test environment.
 */
export function leadingOptionIds(
  optionYesCounts: readonly OptionYesCount[],
): ReadonlySet<string> {
  if (optionYesCounts.length === 0) return new Set();
  const highest = Math.max(...optionYesCounts.map(({ yesCount }) => yesCount));
  if (optionYesCounts.every(({ yesCount }) => yesCount === highest)) return new Set();
  return new Set(
    optionYesCounts
      .filter(({ yesCount }) => yesCount === highest)
      .map(({ id }) => id),
  );
}
