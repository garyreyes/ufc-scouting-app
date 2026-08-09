import { getPastEvents } from "@/features/fights/api";
import { EventGrid } from "@/features/fights/components/EventGrid";

export const revalidate = 300;

export default async function PastEventsPage() {
  const events = await getPastEvents();

  return (
    <div>
      <h1>Past Events</h1>
      <EventGrid events={events} />
    </div>
  );
}
