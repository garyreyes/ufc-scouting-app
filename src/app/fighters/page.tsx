import { getFighters } from "@/features/fighters/api";
import { FighterGrid } from "@/features/fighters/components/FighterGrid";

export default async function FightersPage({ searchParams }: PageProps<"/fighters">) {
  const resolvedSearchParams = await searchParams;
  const query = typeof resolvedSearchParams.q === "string" ? resolvedSearchParams.q : "";
  const weightClassParam = resolvedSearchParams.weightClass;
  const weightClasses = Array.isArray(weightClassParam)
    ? weightClassParam
    : weightClassParam
      ? [weightClassParam]
      : [];

  const fighters = await getFighters(query, weightClasses);

  return (
    <div>
      <h1>Fighters</h1>
      <FighterGrid fighters={fighters} />
    </div>
  );
}
