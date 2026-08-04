"use client";

import { useState } from "react";

import { authClient } from "../../lib/auth-client";
import styles from "../routes.module.css";

export interface SignOutButtonProps {
  readonly navigate?: (href: string) => void;
}

export function SignOutButton({
  navigate = (href) => window.location.assign(href),
}: SignOutButtonProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut(): Promise<void> {
    setFailed(false);
    setIsSigningOut(true);
    try {
      const result = await authClient.signOut({
        fetchOptions: { onSuccess: () => navigate("/") },
      });
      if (result.error) {
        setFailed(true);
        setIsSigningOut(false);
      }
    } catch {
      setFailed(true);
      setIsSigningOut(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.navButton} disabled={isSigningOut} onClick={signOut}>
        {isSigningOut ? "Signing out…" : "Sign out"}
      </button>
      {failed ? (
        <span className={styles.navError} role="alert">
          Sign-out did not complete. Check your connection and try again.
        </span>
      ) : null}
    </>
  );
}
