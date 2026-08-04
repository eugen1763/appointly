import type { ReactNode } from "react";

import type {
  PublicAppointment,
  PublicOption,
  PublicParticipant,
} from "../../../features/appointments/server/snapshot";
import type { LinkedGuestParticipant } from "../../../features/appointments/server/guest-session";
import { leadingOptionIds } from "../../../features/appointments/leading-option";
import { TopBar } from "../../_components/TopBar";
import routeStyles from "../../routes.module.css";
import styles from "./appointment.module.css";
import { formatCalendarDate } from "./calendar-date";
import { JoinParticipantForm } from "./JoinParticipantForm";
import { GuestIdentitySelector } from "./GuestIdentitySelector";
import { TimedOptionLabel } from "./option-label";

type ResponseLabel = "Yes" | "No" | "Unanswered";

const TYPE_LABELS: Record<PublicAppointment["appointment"]["type"], string> = {
  DATE: "Day",
  DATE_TIME: "Date and time",
  DATE_RANGE: "Date range",
  DATE_TIME_RANGE: "Date and time range",
};

function responseLabel(option: PublicOption, participantId: string): ResponseLabel {
  const response = option.responses.find((candidate) => candidate.participantId === participantId);
  if (response?.value === "YES") return "Yes";
  if (response?.value === "NO") return "No";
  return "Unanswered";
}

/**
 * Counted from the responses the snapshot carries rather than read off the option:
 * the view is typed on PublicOption, which has no yesCount, and the server derives
 * those totals from exactly these responses.
 */
function countResponses(
  option: PublicOption,
  participants: readonly PublicParticipant[],
  label: ResponseLabel,
): number {
  return participants.reduce(
    (total, participant) => total + Number(responseLabel(option, participant.id) === label),
    0,
  );
}

/** Re-exported so every existing import site keeps working after the move. */
export { leadingOptionIds };
export type { OptionYesCount } from "../../../features/appointments/leading-option";

function markClass(option: PublicOption, participantId: string): string {
  switch (responseLabel(option, participantId)) {
    case "Yes":
      return styles.markYes;
    case "No":
      return styles.markNo;
    case "Unanswered":
      return styles.markNone;
  }
}

/** Up to two leading glyphs, so a column head stays narrow at any name length. */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0] ?? "")
    .join("")
    .toUpperCase() || "?";
}

export function OptionLabel({ option }: Readonly<{ option: PublicOption }>) {
  switch (option.kind) {
    case "DATE":
      return <time dateTime={option.startDate}>{formatCalendarDate(option.startDate)}</time>;
    case "DATE_RANGE":
      return (
        <span>
          <time dateTime={option.startDate}>{formatCalendarDate(option.startDate)}</time>
          {" – "}
          <time dateTime={option.endDate}>{formatCalendarDate(option.endDate)}</time>
        </span>
      );
    case "DATE_TIME":
    case "DATE_TIME_RANGE":
      return <TimedOptionLabel option={option} />;
  }
}

export interface PublicAppointmentViewProps {
  readonly appointment: PublicAppointment;
  readonly linkedParticipants?: readonly LinkedGuestParticipant[];
  readonly activeParticipantId?: string | null;
  readonly onParticipantChange?: (participantId: string | null) => void;
  readonly participantSelectionPending?: boolean;
  readonly onJoined?: (participantId: string) => void;
  readonly managementControls?: ReactNode;
  readonly readOnly?: boolean;
  readonly showJoinForm?: boolean;
  readonly renderResponseControl?: (option: PublicOption) => ReactNode;
  readonly renderOptionActions?: (option: PublicOption) => ReactNode;
  readonly suggestionControls?: ReactNode;
  readonly refreshError?: ReactNode;
  readonly onRefresh?: () => void;
}

export function PublicAppointmentView({
  appointment,
  linkedParticipants = [],
  activeParticipantId,
  onParticipantChange,
  participantSelectionPending = false,
  onJoined,
  managementControls = null,
  readOnly = true,
  showJoinForm = true,
  renderResponseControl,
  renderOptionActions,
  suggestionControls = null,
  refreshError = null,
  onRefresh,
}: Readonly<PublicAppointmentViewProps>) {
  const finalized = appointment.appointment.status === "FINALIZED";
  const { participants, options } = appointment;
  // The viewer's own answer lives in the you-cell, so it never gets a column too.
  const columnParticipants = renderResponseControl
    ? participants.filter((participant) => participant.id !== activeParticipantId)
    : participants;
  const yesCounts = new Map(options.map((option) => (
    [option.id, countResponses(option, participants, "Yes")] as const
  )));
  const leadingIds = finalized
    ? new Set<string>()
    : leadingOptionIds(options.map((option) => ({
      id: option.id,
      yesCount: yesCounts.get(option.id) ?? 0,
    })));

  return (
    <div className={routeStyles.page}>
      <TopBar
        end={(
          <span className={styles.readOnlyMark}>
            {readOnly ? "Read-only availability" : "Response editing"}
          </span>
        )}
      />

      <main className={routeStyles.main}>
        <header className={styles.appointmentHeader}>
          <div>
            <p className={routeStyles.kicker}>{TYPE_LABELS[appointment.appointment.type]}</p>
            <h1>{appointment.appointment.title}</h1>
            {appointment.appointment.description ? (
              <p className={styles.description}>{appointment.appointment.description}</p>
            ) : null}
          </div>
          <dl className={styles.summary}>
            <div><dt>Status</dt><dd>{finalized ? "Finalized" : "Active"}</dd></div>
            <div><dt>Options</dt><dd>{appointment.options.length} of {appointment.appointment.optionLimit}</dd></div>
            <div><dt>Participants</dt><dd>{appointment.participants.length}</dd></div>
          </dl>
        </header>

        {finalized ? (
          <p className={styles.finalizedNotice} role="status">
            Appointment finalized. The selected option is marked below.
          </p>
        ) : (
          <p className={styles.activeNotice}>Responses are shown as last saved.</p>
        )}
        {refreshError ? (
          <div className={styles.refreshError} role="alert">
            <span>{refreshError}</span>
            {onRefresh ? <button type="button" onClick={onRefresh}>Refresh</button> : null}
          </div>
        ) : null}
        <GuestIdentitySelector
          publicId={appointment.appointment.publicId}
          linkedParticipants={linkedParticipants}
          activeParticipantId={activeParticipantId}
          onParticipantChange={onParticipantChange}
          disabled={participantSelectionPending}
        />
        {!finalized && showJoinForm ? (
          <JoinParticipantForm
            publicId={appointment.appointment.publicId}
            onJoined={onJoined}
          />
        ) : null}

        <section aria-labelledby="board-heading" className={styles.boardSection}>
          <p className={routeStyles.kicker}>Shared response board</p>
          <h2 id="board-heading">{renderResponseControl ? "Your response" : "Availability"}</h2>
          {renderResponseControl ? (
            <p>Each option saves separately.</p>
          ) : (
            <p>Yes, No, and Unanswered are shown for each participant.</p>
          )}
          {options.length === 0 ? (
            <p className={styles.emptyState}>No appointment options are available.</p>
          ) : (
            <div className={styles.boardWrap}>
              <div className={styles.boardScroll} data-board-scroll>
                <table className={styles.board} role="table" aria-labelledby="board-caption">
                  <caption className={routeStyles.visuallyHidden} id="board-caption">
                    Participant availability by appointment option
                  </caption>
                  <thead role="rowgroup">
                    <tr role="row">
                      <th role="columnheader" scope="col" className={styles.optHead}>Option</th>
                      {renderResponseControl ? (
                        <th role="columnheader" scope="col" className={styles.youHead}>Your response</th>
                      ) : null}
                      <th role="columnheader" scope="col" className={styles.sumHead}>Result</th>
                      {columnParticipants.map((participant) => (
                        <th
                          role="columnheader"
                          scope="col"
                          className={styles.pHead}
                          data-participant-id={participant.id}
                          key={participant.id}
                        >
                          <span aria-hidden="true">{initials(participant.displayName)}</span>
                          <span className={routeStyles.visuallyHidden}>{participant.displayName}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {options.map((option) => {
                      const selected = appointment.appointment.finalOptionId === option.id;
                      const leading = leadingIds.has(option.id);
                      const yesCount = yesCounts.get(option.id) ?? 0;
                      const noCount = countResponses(option, participants, "No");
                      const tallyPercent = participants.length === 0
                        ? 0
                        : Math.round((yesCount / participants.length) * 100);
                      return (
                        <tr
                          role="row"
                          key={option.id}
                          className={selected ? styles.chosenRow : leading ? styles.leadingRow : undefined}
                        >
                          <th
                            role="rowheader"
                            scope="row"
                            className={styles.optName}
                            id={`option-label-${option.id}`}
                            data-option-id={option.id}
                            data-selected={selected ? "true" : undefined}
                          >
                            {selected ? <span className={styles.chosenStamp}>CHOSEN</span> : null}
                            <OptionLabel option={option} />
                          </th>
                          {renderResponseControl ? (
                            <td
                              role="cell"
                              className={styles.youCell}
                              data-option-id={option.id}
                              data-participant-id={activeParticipantId ?? undefined}
                            >
                              {renderResponseControl(option)}
                            </td>
                          ) : null}
                          <td role="cell" className={styles.sumCell}>
                            <span
                              className={styles.tally}
                              role="img"
                              aria-label={`${yesCount} of ${participants.length} say yes`}
                            >
                              <i style={{ width: `${tallyPercent}%` }} />
                            </span>
                            <span className={styles.tallyCount}>{yesCount} yes · {noCount} no</span>
                            {leading ? <span className={styles.leadingMark}>LEADING</span> : null}
                            {!finalized && renderOptionActions ? renderOptionActions(option) : null}
                          </td>
                          {columnParticipants.map((participant) => (
                            <td
                              role="cell"
                              className={styles.pCell}
                              key={participant.id}
                              data-option-id={option.id}
                              data-participant-id={participant.id}
                              data-ini={initials(participant.displayName)}
                            >
                              <span
                                className={`${styles.mark} ${markClass(option, participant.id)}`}
                                role="img"
                                aria-label={`${participant.displayName}: ${responseLabel(option, participant.id)}`}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!finalized && suggestionControls ? (
                <div className={styles.boardFooter}>{suggestionControls}</div>
              ) : null}
            </div>
          )}
          {columnParticipants.length > 0 ? (
            <p className={styles.iniLegend}>
              {columnParticipants.map((participant) => (
                <span key={participant.id}>
                  <b>{initials(participant.displayName)}</b> {participant.displayName}
                </span>
              ))}
            </p>
          ) : null}
        </section>
        {managementControls}
      </main>
    </div>
  );
}
