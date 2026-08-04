"use client";

import { useState } from "react";

import { authClient } from "../../lib/auth-client";
import styles from "../routes.module.css";

export interface SignInActionProps {
  readonly returnTo: string;
  readonly label?: string;
}

export function SignInAction({ returnTo, label }: SignInActionProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  async function startGoogleSignIn(): Promise<void> {
    setErrorMessage(null);
    setIsStarting(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: returnTo,
      });
      if (result.error) {
        setErrorMessage(
          "Google sign-in did not start. Check your connection and try again.",
        );
      }
    } catch {
      setErrorMessage(
        "Google sign-in did not start. Check your connection and try again.",
      );
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div className={styles.actionStack}>
      <button
        type="button"
        disabled={isStarting}
        aria-describedby={errorMessage ? "google-sign-in-error" : undefined}
        className={styles.signInButton}
        onClick={startGoogleSignIn}
      >
        {isStarting ? "Starting Google sign-in\u2026" : (label ?? "Continue with Google")}
      </button>
      {errorMessage ? (
        <p
          className={styles.signInError}
          id="google-sign-in-error"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
