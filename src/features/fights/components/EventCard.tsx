import Link from "next/link";
import type { EventSummary } from "../types";
import styles from "./EventCard.module.css";

function formatDate(dateString: string): string {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function EventCard({ event }: { event: EventSummary }) {
  return (
    <Link href={`/events/${event.id}`} className={styles.card}>
      <div className={styles.thumb}>{"\u{1F94A}"}</div>
      <div className={styles.name}>{event.name}</div>
      <div className={styles.date}>{formatDate(event.event_date)}</div>
    </Link>
  );
}
