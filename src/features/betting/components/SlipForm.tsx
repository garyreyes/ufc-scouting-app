"use client";

import { useState, useTransition } from "react";
import { createSlipAction, getFightsForEventAction } from "../actions";
import type {
  FightOption,
  LegMarket,
  MethodGroup,
  NewLegInput,
  SlipArchetype,
} from "../types";
import styles from "./SlipForm.module.css";

const ARCHETYPES: SlipArchetype[] = ["SAFE_PARLAY", "STRAIGHT_DOG", "LONGSHOT", "METHOD_VALUE", "LOCK", "OTHER"];
const MARKETS: LegMarket[] = ["MONEYLINE", "DOUBLE_CHANCE", "METHOD_FIGHTER", "METHOD_FIGHT", "OTHER"];
// 0064's own CHECK constraint (bet_legs: `market in ('METHOD_FIGHT',
// 'OTHER') or selection_fighter_id is not null`) means an external leg
// (no fighter row to select from) can only ever be one of these two --
// MONEYLINE/DOUBLE_CHANCE/METHOD_FIGHTER all require a selection this
// mode has no way to provide.
const EXTERNAL_MARKETS: LegMarket[] = ["OTHER", "METHOD_FIGHT"];
const METHOD_GROUPS: MethodGroup[] = ["DECISION", "KO_TKO_DQ", "SUBMISSION", "ANY_FINISH"];

interface LegDraft {
  key: string;
  mode: "fight" | "external";
  eventId: string;
  fightId: string;
  externalDescription: string;
  market: LegMarket;
  selectionFighterId: string;
  selectionDetail: string;
  methodGroup: MethodGroup | "";
  price: string;
}

function newLeg(): LegDraft {
  return {
    key: crypto.randomUUID(),
    mode: "fight",
    eventId: "",
    fightId: "",
    externalDescription: "",
    market: "MONEYLINE",
    selectionFighterId: "",
    selectionDetail: "",
    methodGroup: "",
    price: "",
  };
}

function computeCombinedPrice(legs: LegDraft[]): number | null {
  const prices = legs.map((l) => Number(l.price));
  if (prices.some((p) => !(p > 1))) return null;
  return prices.reduce((product, p) => product * p, 1);
}

export function SlipForm({ events }: { events: { id: string; name: string; event_date: string }[] }) {
  const [archetype, setArchetype] = useState<SlipArchetype>("SAFE_PARLAY");
  const [stakePhp, setStakePhp] = useState("");
  const [stakeUnits, setStakeUnits] = useState("");
  const [book, setBook] = useState("");
  const [bookmakerBetId, setBookmakerBetId] = useState("");
  const [placedAt, setPlacedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [note, setNote] = useState("");
  const [legs, setLegs] = useState<LegDraft[]>([newLeg()]);
  const [fightsByEvent, setFightsByEvent] = useState<Record<string, FightOption[]>>({});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function updateLeg(key: string, patch: Partial<LegDraft>) {
    setLegs((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function loadFightsForEvent(eventId: string) {
    if (!eventId || fightsByEvent[eventId]) return;
    startTransition(async () => {
      const fights = await getFightsForEventAction(eventId);
      setFightsByEvent((prev) => ({ ...prev, [eventId]: fights }));
    });
  }

  const combinedPrice = computeCombinedPrice(legs);

  function buildLegInputs(): NewLegInput[] | null {
    const inputs: NewLegInput[] = [];
    for (const leg of legs) {
      const price = Number(leg.price);
      if (!(price > 1)) return null;
      if (leg.mode === "external") {
        if (leg.externalDescription.trim() === "") return null;
        // Defense in depth: the market dropdown already restricts an
        // external leg to EXTERNAL_MARKETS, but this guards the same
        // invariant the DB's own CHECK constraint enforces, matching the
        // needsFighter check the fight-mode branch below applies.
        if (leg.market !== "OTHER" && leg.market !== "METHOD_FIGHT") return null;
        const needsMethod = leg.market === "METHOD_FIGHT";
        if (needsMethod && !leg.methodGroup) return null;
        inputs.push({
          fightId: null,
          externalDescription: leg.externalDescription.trim(),
          market: leg.market,
          selectionFighterId: null,
          selectionDetail: leg.selectionDetail.trim() || null,
          methodGroup: needsMethod ? (leg.methodGroup as MethodGroup) : null,
          price,
        });
        continue;
      }
      if (!leg.fightId) return null;
      const needsFighter = leg.market !== "OTHER" && leg.market !== "METHOD_FIGHT";
      if (needsFighter && !leg.selectionFighterId) return null;
      const needsMethod = leg.market === "METHOD_FIGHTER" || leg.market === "METHOD_FIGHT";
      if (needsMethod && !leg.methodGroup) return null;
      inputs.push({
        fightId: leg.fightId,
        externalDescription: null,
        market: leg.market,
        selectionFighterId: needsFighter ? leg.selectionFighterId : null,
        selectionDetail: leg.selectionDetail.trim() || null,
        methodGroup: needsMethod ? (leg.methodGroup as MethodGroup) : null,
        price,
      });
    }
    return inputs;
  }

  function submit() {
    setError(null);
    const legInputs = buildLegInputs();
    if (legInputs === null) {
      setError("Every leg needs its selection, market, and a price above 1.");
      return;
    }
    const stake = Number(stakePhp);
    const units = Number(stakeUnits);
    if (!(stake > 0) || !(units > 0)) {
      setError("Stake (php and units) must be greater than 0.");
      return;
    }
    if (combinedPrice === null) {
      setError("Combined price could not be computed -- check every leg's price.");
      return;
    }
    // A slip's event_id only applies when every fight-backed leg shares
    // one event -- an accumulator spanning events (or a non-UFC leg) has
    // none, same as 0064_bankroll_and_slips.sql's own nullable design.
    const eventIds = new Set(legs.filter((l) => l.mode === "fight" && l.eventId).map((l) => l.eventId));
    const eventId = eventIds.size === 1 ? [...eventIds][0] : null;

    startTransition(async () => {
      try {
        await createSlipAction({
          eventId,
          archetype,
          stakePhp: stake,
          stakeUnits: units,
          book: book.trim() || null,
          bookmakerBetId: bookmakerBetId.trim() || null,
          combinedPrice,
          placedAt: new Date(placedAt).toISOString(),
          note: note.trim() || null,
          legs: legInputs,
        });
        setStakePhp("");
        setStakeUnits("");
        setBook("");
        setBookmakerBetId("");
        setNote("");
        setLegs([newLeg()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to record slip");
      }
    });
  }

  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Archetype</span>
          <select value={archetype} onChange={(e) => setArchetype(e.target.value as SlipArchetype)} className={styles.select}>
            {ARCHETYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Stake (₱)</span>
          <input type="number" step="0.01" min="0.01" value={stakePhp} onChange={(e) => setStakePhp(e.target.value)} className={styles.input} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Stake (units)</span>
          <input type="number" step="0.01" min="0.01" value={stakeUnits} onChange={(e) => setStakeUnits(e.target.value)} className={styles.input} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Book</span>
          <input type="text" value={book} onChange={(e) => setBook(e.target.value)} className={styles.input} />
        </label>
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Bookmaker ticket # (optional)</span>
          <input type="text" value={bookmakerBetId} onChange={(e) => setBookmakerBetId(e.target.value)} className={styles.input} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Placed at</span>
          <input type="datetime-local" value={placedAt} onChange={(e) => setPlacedAt(e.target.value)} className={styles.input} />
        </label>
      </div>

      <div className={styles.legs}>
        {legs.map((leg, i) => (
          <div key={leg.key} className={styles.legRow}>
            <div className={styles.legHeader}>
              <span className={styles.legTitle}>Leg {i + 1}</span>
              <div className={styles.modeToggle}>
                <button
                  type="button"
                  className={`${styles.modeButton} ${leg.mode === "fight" ? styles.modeButtonActive : ""}`}
                  onClick={() => updateLeg(leg.key, { mode: "fight" })}
                >
                  UFC fight
                </button>
                <button
                  type="button"
                  className={`${styles.modeButton} ${leg.mode === "external" ? styles.modeButtonActive : ""}`}
                  onClick={() =>
                    // An external leg has no fighter row to select from,
                    // so it can only ever be OTHER/METHOD_FIGHT (0064's
                    // CHECK constraint) -- reset off whatever market a
                    // fight-mode leg may have left selected.
                    updateLeg(leg.key, {
                      mode: "external",
                      market: leg.market === "OTHER" || leg.market === "METHOD_FIGHT" ? leg.market : "OTHER",
                      selectionFighterId: "",
                    })
                  }
                >
                  Other / not listed
                </button>
              </div>
              {legs.length > 1 && (
                <button type="button" className={styles.removeLeg} onClick={() => setLegs((prev) => prev.filter((l) => l.key !== leg.key))}>
                  Remove
                </button>
              )}
            </div>

            {leg.mode === "fight" ? (
              <div className={styles.row}>
                <select
                  value={leg.eventId}
                  onChange={(e) => {
                    const eventId = e.target.value;
                    updateLeg(leg.key, { eventId, fightId: "", selectionFighterId: "" });
                    loadFightsForEvent(eventId);
                  }}
                  className={styles.select}
                >
                  <option value="">Select event…</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </select>
                <select
                  value={leg.fightId}
                  onChange={(e) => updateLeg(leg.key, { fightId: e.target.value, selectionFighterId: "" })}
                  className={styles.select}
                  disabled={!leg.eventId}
                >
                  <option value="">Select fight…</option>
                  {(fightsByEvent[leg.eventId] ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.fighter1.name} vs {f.fighter2.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <input
                type="text"
                placeholder="e.g. Alcaraz to win 1st set (US Open)"
                value={leg.externalDescription}
                onChange={(e) => updateLeg(leg.key, { externalDescription: e.target.value })}
                className={styles.input}
              />
            )}

            <div className={styles.row}>
              <select value={leg.market} onChange={(e) => updateLeg(leg.key, { market: e.target.value as LegMarket })} className={styles.select}>
                {(leg.mode === "external" ? EXTERNAL_MARKETS : MARKETS).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              {leg.market !== "OTHER" && leg.market !== "METHOD_FIGHT" && (
                <select
                  value={leg.selectionFighterId}
                  onChange={(e) => updateLeg(leg.key, { selectionFighterId: e.target.value })}
                  className={styles.select}
                  disabled={leg.mode === "fight" && !leg.fightId}
                >
                  <option value="">Selection…</option>
                  {leg.mode === "fight" &&
                    leg.fightId &&
                    (() => {
                      const fight = (fightsByEvent[leg.eventId] ?? []).find((f) => f.id === leg.fightId);
                      if (!fight) return null;
                      return (
                        <>
                          <option value={fight.fighter1.id}>{fight.fighter1.name}</option>
                          <option value={fight.fighter2.id}>{fight.fighter2.name}</option>
                        </>
                      );
                    })()}
                </select>
              )}

              {(leg.market === "METHOD_FIGHTER" || leg.market === "METHOD_FIGHT") && (
                <select value={leg.methodGroup} onChange={(e) => updateLeg(leg.key, { methodGroup: e.target.value as MethodGroup })} className={styles.select}>
                  <option value="">Method…</option>
                  {METHOD_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              )}

              <input
                type="number"
                step="0.001"
                min="1.001"
                placeholder="Price"
                value={leg.price}
                onChange={(e) => updateLeg(leg.key, { price: e.target.value })}
                className={styles.priceInput}
              />
            </div>

            <input
              type="text"
              placeholder="Selection detail, as the book wrote it (optional)"
              value={leg.selectionDetail}
              onChange={(e) => updateLeg(leg.key, { selectionDetail: e.target.value })}
              className={styles.input}
            />
          </div>
        ))}
        <button type="button" className={styles.addLeg} onClick={() => setLegs((prev) => [...prev, newLeg()])}>
          + Add leg
        </button>
      </div>

      <textarea placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className={styles.textarea} rows={2} />

      {combinedPrice !== null && (
        <p className={styles.combined}>
          Combined price: {combinedPrice.toFixed(3)}
          {stakePhp && Number(stakePhp) > 0 && ` · potential return ₱${(Number(stakePhp) * combinedPrice).toFixed(2)}`}
        </p>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <button type="button" className={styles.submit} onClick={submit} disabled={isPending}>
        Record slip
      </button>
    </div>
  );
}
