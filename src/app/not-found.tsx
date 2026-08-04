import Link from "next/link";

import { TopBar } from "./_components/TopBar";
import styles from "./routes.module.css";

/**
 * Next routes both unknown URLs and the notFound() thrown for an unknown or
 * deleted appointment here, so the copy has to cover a mistyped address and a
 * link that has stopped existing without guessing which one happened.
 */
export default function NotFound() {
  return (
    <div className={styles.page}>
      <TopBar links={[{ href: "/", label: "Home" }]} />

      <main className={styles.main}>
        <section aria-labelledby="not-found-title">
          <p className={styles.kicker}>Nothing here</p>
          <h1 className={styles.pageTitle} id="not-found-title">Page not found</h1>
          <p className={styles.lede}>
            This link does not point to anything. The appointment may have been
            deleted, or the address may be incomplete — check the link you
            received.
          </p>
          <div className={styles.actions}>
            <Link className={styles.secondaryAction} href="/">
              Go to the home page
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
