import styles from "../routes.module.css";

/**
 * A fixed illustration of the three marks, so it carries one name as an image.
 * On a role-less div the aria-label is prohibited and never exposed.
 */
export function AvailabilityStrip() {
  return (
    <div
      className={styles.availabilityStrip}
      role="img"
      aria-label="Availability choices: Yes, No, Unanswered"
    >
      <span className={styles.yesMark}>Yes</span>
      <span className={styles.noMark}>No</span>
      <span className={styles.openMark}>Unanswered</span>
    </div>
  );
}
