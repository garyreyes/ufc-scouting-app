import { getUpcomingEvents } from "@/features/fights/api";
import { EventGrid } from "@/features/fights/components/EventGrid";

export const revalidate = 300;

export default async function UpcomingEventsPage() {
  const events = await getUpcomingEvents();

  return (
    <div>
      <h1>Upcoming Events</h1>
      <EventGrid events={events} />
    </div>
  );
}
