import type { EventSummary } from "../types";
import { EventCard } from "./EventCard";
import styles from "./EventGrid.module.css";

export function EventGrid({ events }: { events: EventSummary[] }) {
  if (events.length === 0) {
    return <p className={styles.empty}>No events found.</p>;
  }

  return (
    <div className={styles.grid}>
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}
