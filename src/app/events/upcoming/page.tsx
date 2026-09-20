import { getUpcomingEvents } from "@/features/fights/api";
import { EventGrid } from "@/features/fights/components/EventGrid";
import { CardReadinessPanel } from "@/features/job-health/components/CardReadinessPanel";

export const revalidate = 300;

export default async function UpcomingEventsPage() {
  const events = await getUpcomingEvents();

  return (
    <div>
      <h1>Upcoming Events</h1>
      <CardReadinessPanel />
      <EventGrid events={events} />
    </div>
  );
}
