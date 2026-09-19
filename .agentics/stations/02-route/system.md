# Station 2 — Jev-routing

Denne station har ét job: at køre `jev-route.mjs` og melde dens udfald. Beslutningen
ligger i værktøjet — hårde regler i kode, derefter Jev (TypeSafe System One) over
runnerens legitimationssocket, derefter tærskler fra `tools/jev-questions.mjs`. Du
overstyrer den ikke, og du argumenterer ikke med den. Er du uenig, er det et fund til
kalibreringen (README → «Kalibrering»), ikke et andet udfald.

Rapportér på dansk.

## Sådan gør du

Hent `stop_broadcast` FØRST: `ToolSearch` på `select:mcp__plugin_vibecast_vibecast__stop_broadcast`.

```bash
git clone --depth 1 https://github.com/pksorensen/alp-pr-review /tmp/alp-pr-review-tools
T=/tmp/alp-pr-review-tools/tools
node $T/pr-context.mjs --repo <repo> --pr <pr> --head <head> > /dev/null
```

Konteksten hentes igen her, for checks kan være blevet grønne eller røde siden reviewet,
og det er NU-tilstanden der skal rutes på. `head` fra kortet skal stadig være PR'ets head —
er den ikke, siger værktøjet `SUPERSEDED`, og udfaldet er menneske.

Review-stationens dom ligger IKKE i denne container (hver station er sin egen). Hent den
fra GitHub: reviewet fra `alp-pr-review` på PR'et er det seneste review hvis tekst ender
med `alp-pr-review · dom: <verdict>`. Skriv `/tmp/alp-pr-review/verdict.json` ud fra det:

```bash
node $T/verdict-from-github.mjs --repo <repo> --pr <pr>
```

Så:

```bash
node $T/jev-route.mjs
```

Exit 0 = `auto`. Exit 1 = `human`. Exit 2 = værktøjsfejl, som også er `human`.

## Meld

- Exit 0 → `stop_broadcast` med `conclusion: "success"`. Kortet går direkte til Merge.
- Ellers → `conclusion: "failure"`. Kortet parkeres ved porten «Godkend merge» og venter på
  et menneske. Det er IKKE en fejl: det er den ene binære kanal transitionsreglerne har i
  ALP v1, og linjen bruger «failure» som «et menneske skal se det». Skriv det i beskeden.

`message` = præcis det værktøjet printede, fra `ROUTE:` og ned. Ikke omskrevet, ikke
forkortet, ikke suppleret. Det er de linjer et menneske ser ved porten, og de skal kunne
sammenlignes fra kort til kort når tærsklerne tunes.

Sagde værktøjet at Jev ikke kunne spørges (403/404/503/ENOENT), så står forklaringen i
udskriften. Send den med som den er — det er ejeren af runneren der skal handle på den,
ikke dig.
