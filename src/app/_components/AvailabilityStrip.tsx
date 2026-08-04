import styles from "../routes.module.css";

export function AvailabilityStrip() {
  return (
    <div
      className={styles.availabilityStrip}
      aria-label="Availability choices: Yes, No, Unanswered"
    >
      <span className={styles.yesMark}>Yes</span>
      <span className={styles.noMark}>No</span>
      <span className={styles.openMark}>Unanswered</span>
    </div>
  );
}
