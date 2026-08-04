import { safeReturnPath } from "../../lib/return-path";
import { AvailabilityStrip } from "../_components/AvailabilityStrip";
import { TopBar } from "../_components/TopBar";
import styles from "../routes.module.css";
import { SignInAction } from "./SignInAction";

interface SignInPageProps {
  readonly searchParams: Promise<{
    readonly returnTo?: string | readonly string[];
  }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const returnTo = safeReturnPath((await searchParams).returnTo, "/dashboard");

  return (
    <div className={styles.page}>
      <TopBar links={[{ href: "/", label: "Home" }]} />

      <main className={styles.main}>
        <div className={styles.signInLayout}>
          <section className={styles.signInPanel} aria-labelledby="sign-in-title">
            <p className={styles.kicker}>Organizer access</p>
            <h1 className={styles.pageTitle} id="sign-in-title">
              Sign in to manage appointments
            </h1>
            <p>
              Continue with the Google account you use to organize. Guests do
              not need to sign in; they can open a shared appointment link.
            </p>
            <SignInAction returnTo={returnTo} />
          </section>
          <div>
            <p className={styles.kicker}>Availability stays easy to scan</p>
            <AvailabilityStrip />
          </div>
        </div>
      </main>
    </div>
  );
}
