import { notFound } from "next/navigation";
import { getEventWithFights } from "@/features/fights/api";
import { BoutRow } from "@/features/fights/components/BoutRow";
import styles from "./page.module.css";

function formatDate(dateString: string): string {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function EventDetailPage({
  params,
  searchParams,
}: PageProps<"/events/[id]">) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const weightClassParam = resolvedSearchParams.weightClass;
  const weightClasses = Array.isArray(weightClassParam)
    ? weightClassParam
    : weightClassParam
      ? [weightClassParam]
      : [];

  const event = await getEventWithFights(id, weightClasses);
  if (!event) notFound();

  return (
    <div>
      <h1>{event.name}</h1>
      <p className={styles.date}>{formatDate(event.event_date)}</p>
      {event.fights.length === 0 ? (
        <p className={styles.empty}>No fights match the selected filter.</p>
      ) : (
        <div className={styles.fightList}>
          {event.fights.map((fight) => (
            <BoutRow key={fight.id} fight={fight} />
          ))}
        </div>
      )}
    </div>
  );
}
