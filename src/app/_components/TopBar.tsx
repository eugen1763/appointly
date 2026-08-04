import Link from "next/link";
import type { ReactNode } from "react";

import styles from "../routes.module.css";

export interface TopBarLink {
  readonly href: string;
  readonly label: string;
}

export interface TopBarProps {
  readonly links?: readonly TopBarLink[];
  readonly end?: ReactNode;
}

export function TopBar({ links, end }: TopBarProps) {
  const hasLinks = links !== undefined && links.length > 0;
  return (
    <header className={styles.topbar}>
      <div className={styles.topbarInner}>
        <Link className={styles.brand} href="/">Appointly</Link>
        {hasLinks || end ? (
          <div className={styles.topbarEnd}>
            {hasLinks ? (
              <nav className={styles.primaryNav} aria-label="Primary">
                {links.map((link) => (
                  <Link className={styles.navLink} href={link.href} key={link.href}>
                    {link.label}
                  </Link>
                ))}
              </nav>
            ) : null}
            {end ?? null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
