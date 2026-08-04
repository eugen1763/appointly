import { AppointmentComposer } from "../../../features/appointments/AppointmentComposer";
import { ownerDisplayNameFromIdentity } from "../../../features/appointments/creation-owner-default";

import { requireOrganizer } from "../../../lib/organizer-access";
import { SignOutButton } from "../../_components/SignOutButton";
import { TopBar } from "../../_components/TopBar";
import styles from "../../routes.module.css";

export default async function NewAppointmentPage() {
  const identity = await requireOrganizer("/appointments/new");

  return (
    <div className={styles.page}>
      <TopBar
        links={[{ href: "/dashboard", label: "Dashboard" }]}
        end={<SignOutButton />}
      />

      <main className={styles.main}>
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.kicker}>New appointment</p>
            <h1 className={styles.pageTitle}>Create an appointment</h1>
            <p className={styles.intro}>
              Turn a handful of possible days into one public response link.
              Everyone answers in the same grid.
            </p>
          </div>
        </header>

        <AppointmentComposer
          defaultOwnerDisplayName={ownerDisplayNameFromIdentity(identity)}
        />
      </main>
    </div>
  );
}
