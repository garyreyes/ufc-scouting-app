# Sherdog HTML fixtures

Real pages saved 2026-09-07 for the Phase J parser tests, so the tests
never touch the network and a Sherdog markup change fails a test instead
of silently returning nulls in production.

**These are trimmed, not verbatim.** `<script>`, `<style>`, `<svg>`, and
HTML comments were stripped on save to keep the files small — everything
the parsers read (bio block, `winsloses-holder`, `fight_history` table,
`fightfinder_result` table) is untouched. Re-pull with a real browser
User-Agent at ≥1.5s spacing if you need to refresh them.

| File | Fighter / query | Why this one |
|---|---|---|
| `fighter-oliveira-30300.html` | Charles Oliveira | long career (49 bouts), a No Contest, a nickname, pre-2008 debut |
| `fighter-makhachev-76836.html` | Islam Makhachev | clean 29-1, no NC block on the page |
| `fighter-qileng-aori-222519.html` | Qileng Aori | Sherdog's own name order differs from ours ("Aori Qileng"); transliterated |
| `fighter-letoi-345261.html` | Liam Letoi | single-bout career; Sherdog has no height/DOB — the missing-field path |
| `search-makhachev.html` | `SearchTxt=Makhachev` | 4 candidates, `0'0"`/`0 lbs` placeholder rows |
| `search-andre-lima.html` | `SearchTxt=Andre Lima` | 13 candidates, none an obvious top match — why identity goes through the review queue |
