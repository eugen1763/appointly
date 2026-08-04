"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { guestAccessSuccessSchema } from "../../../../features/appointments/contracts";
import { TopBar } from "../../../_components/TopBar";
import routeStyles from "../../../routes.module.css";
import { storeActiveParticipantId } from "../guest-selection-storage";
import styles from "./edit.module.css";

interface EditLinkClientProps {
  readonly publicId: string;
}

type ExchangeState = "opening" | "failed";

interface EditLinkFragment {
  readonly participantId: string;
  readonly token: string;
}

function takeEditLinkFragment(): EditLinkFragment | null {
  const fragment = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );

  const entries = Array.from(new URLSearchParams(fragment).entries());
  if (entries.length !== 2) return null;
  const participantEntries = entries.filter(([key]) => key === "participant");
  const tokenEntries = entries.filter(([key]) => key === "token");
  if (participantEntries.length !== 1 || tokenEntries.length !== 1) return null;
  const participantId = participantEntries[0]?.[1] ?? "";
  const token = tokenEntries[0]?.[1] ?? "";
  return participantId.length > 0 && token.length > 0
    ? { participantId, token }
    : null;
}

export function EditLinkClient({ publicId }: EditLinkClientProps) {
  const router = useRouter();
  const startedAttempt = useRef<string | null>(null);
  const [state, setState] = useState<ExchangeState>("opening");
  const [fragmentAttempt, setFragmentAttempt] = useState(0);

  useEffect(() => {
    const handleHashChange = () => {
      setFragmentAttempt((attempt) => attempt + 1);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);


  useEffect(() => {
    const attemptKey = `${publicId}:${fragmentAttempt}`;
    if (startedAttempt.current === attemptKey) return;
    startedAttempt.current = attemptKey;
    const editLink = takeEditLinkFragment();
    if (editLink === null) {
      setState("failed");
      return;
    }
    setState("opening");
    const { participantId, token } = editLink;

    let active = true;
    async function exchange(): Promise<void> {
      try {
        const response = await fetch(
          `/api/appointments/${publicId}/guest-access`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              participantId,
              token,
            }),
          },
        );
        if (!response.ok) throw new Error("Guest access exchange failed");
        const body = guestAccessSuccessSchema.parse(await response.json());
        if (!active) return;
        storeActiveParticipantId(publicId, body.participantId);
        router.replace(`/a/${publicId}`);
      } catch {
        if (active) setState("failed");
      }
    }
    void exchange();
    return () => {
      active = false;
    };
  }, [fragmentAttempt, publicId, router]);

  return (
    <div className={routeStyles.page}>
      <TopBar />
      <main className={`${routeStyles.main} ${styles.main}`}>
        <section className={styles.panel} aria-labelledby="edit-link-title">
          <p className={routeStyles.kicker}>Private guest access</p>
          <h1 id="edit-link-title" className={routeStyles.pageTitle}>
            {state === "opening" ? "Opening your appointment" : "Link unavailable"}
          </h1>
          {state === "opening" ? (
            <p className={styles.message} role="status">
              Checking your private edit link…
            </p>
          ) : (
            <>
              <p className={styles.message} role="alert">
                This private edit link could not be opened.
              </p>
              <Link className={styles.returnLink} href={`/a/${publicId}`}>
                Return to appointment
              </Link>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
