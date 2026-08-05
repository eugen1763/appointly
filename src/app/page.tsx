import Link from "next/link";

import { signInPathFor } from "../lib/return-path";
import { getEnv } from "../lib/env";
import { AvailabilityStrip } from "./_components/AvailabilityStrip";
import { TopBar } from "./_components/TopBar";
import styles from "./routes.module.css";
import { SignInAction } from "./sign-in/SignInAction";

export const dynamic = "force-dynamic";

export default function Home() {
  const googleAuthEnabled = getEnv().GOOGLE_AUTH_ENABLED;
  return (
    <div className={styles.page}>
      <TopBar
        links={[
          { href: "/dashboard", label: "Dashboard" },
          ...(googleAuthEnabled
            ? [{ href: signInPathFor("/dashboard"), label: "Sign in" }]
            : []),
        ]}
      />

      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div>
            <p className={styles.kicker}>A shared scheduling ledger</p>
            <h1 className={styles.title} id="landing-title">
              Find the time everyone can make.
            </h1>
            <p className={styles.lede}>
              Put possible times in one place, collect clear answers, and choose
              an option without a long message thread.
            </p>
            <div className={styles.actions}>
              {googleAuthEnabled ? (
                <SignInAction returnTo="/dashboard" label="Sign in with Google" />
              ) : (
                <Link className={styles.signInButton} href="/appointments/new">
                  Create an appointment
                </Link>
              )}
              <Link className={styles.secondaryAction} href="/dashboard">
                Open dashboard
              </Link>
            </div>
          </div>
          <div>
            <p className={styles.kicker}>One mark for each option</p>
            <AvailabilityStrip />
          </div>
        </section>

        <section className={styles.paths} aria-label="Ways to use Appointly">
          <article className={styles.path}>
            <h2>Organizing an appointment?</h2>
            <p>
              {googleAuthEnabled
                ? "Sign in with Google to create an appointment and manage the ones you own or co-organize."
                : "Create and manage appointments directly on this shared internal instance."}
            </p>
            <Link className={styles.secondaryAction} href="/appointments/new">
              Create an appointment
            </Link>
          </article>
          <article className={styles.path}>
            <h2>Responding as a guest?</h2>
            <p>
              Open the appointment link your organizer shared. You can respond
              without an account.
            </p>
          </article>
        </section>
      </main>
    </div>
  );
}
