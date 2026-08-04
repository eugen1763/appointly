import Link from "next/link";

import { AppointmentComposer } from "../../features/appointments/AppointmentComposer";
import { ownerDisplayNameFromIdentity } from "../../features/appointments/creation-owner-default";
import {
  bindPendingManagersForDashboard,
  listDashboardAppointments,
  type DashboardAppointment,
} from "../../features/appointments/server/management";
import { productionServiceContext } from "../../features/appointments/server/production-service-context";
import { requireOrganizer } from "../../lib/organizer-access";
import { SignOutButton } from "../_components/SignOutButton";
import { TopBar } from "../_components/TopBar";
import styles from "../routes.module.css";

const TYPE_LABELS: Record<DashboardAppointment["type"], string> = {
  DATE: "Day",
  DATE_TIME: "Date and time",
  DATE_RANGE: "Date range",
  DATE_TIME_RANGE: "Date and time range",
};

const STATUS_LABELS: Record<DashboardAppointment["status"], string> = {
  ACTIVE: "Active",
  FINALIZED: "Finalized",
};

const ROLE_LABELS: Record<DashboardAppointment["role"], string> = {
  OWNER: "Owner",
  COORGANIZER: "Co-organizer",
};

const updatedAtFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function DashboardPage() {
  const organizer = await requireOrganizer("/dashboard");
  bindPendingManagersForDashboard(productionServiceContext, organizer);
  const { appointments } = listDashboardAppointments(productionServiceContext, {
    userId: organizer.userId,
  });

  return (
    <div className={styles.page}>
      <TopBar
        links={[{ href: "/", label: "Home" }]}
        end={<SignOutButton />}
      />

      <main className={styles.main}>
        <section aria-labelledby="composer-heading">
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.kicker}>New appointment</p>
              <h1 className={styles.pageTitle} id="composer-heading">
                Create an appointment
              </h1>
              <p className={styles.intro}>
                Turn a handful of possible days into one public response link.
              </p>
            </div>
          </header>

          <AppointmentComposer
            defaultOwnerDisplayName={ownerDisplayNameFromIdentity(organizer)}
          />
        </section>

        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.kicker}>Organizer ledger</p>
            <h2 className={styles.pageTitle}>Your appointments</h2>
            <p className={styles.intro}>
              Owned and co-organized appointments, newest update first.
            </p>
          </div>
        </header>

        {appointments.length === 0 ? (
          <section className={styles.emptyState} aria-labelledby="empty-title">
            <h2 id="empty-title">No appointments yet</h2>
            <p>
              Use the composer above to collect possible times and share one
              response link with your guests.
            </p>
          </section>
        ) : (
          <ul className={styles.appointmentList} aria-label="Appointments">
            {appointments.map((appointment) => (
              <li className={styles.appointmentItem} key={appointment.publicId}>
                <article>
                  <h2 className={styles.appointmentTitle}>
                    <Link href={`/a/${appointment.publicId}`}>
                      {appointment.title}
                    </Link>
                  </h2>
                  <dl className={styles.metadata}>
                    <div>
                      <dt>Status</dt>
                      <dd>{STATUS_LABELS[appointment.status]}</dd>
                    </div>
                    <div>
                      <dt>Type</dt>
                      <dd>{TYPE_LABELS[appointment.type]}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>
                        <time dateTime={new Date(appointment.updatedAt).toISOString()}>
                          {updatedAtFormatter.format(appointment.updatedAt)}
                        </time>
                      </dd>
                    </div>
                  </dl>
                  <Link className={styles.navLink} href={`/a/${appointment.publicId}`}>
                    Open public link
                  </Link>
                </article>
                <span className={styles.roleBadge}>
                  {ROLE_LABELS[appointment.role]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
