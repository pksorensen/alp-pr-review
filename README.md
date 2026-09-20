# alp-pr-review

En ALP-linje der reviewer hvert pull request i projektets repo, lader **Jev** (TypeSafe
AI's System One-model) afgøre om et menneske skal se det før merge, og merger selv når
svaret er nej og alle checks er grønne.

```
Review ──success──▶ Jev-routing ──success──────────────▶ Merge ──success──▶ Merget
   │                     │                                  │
   │                     └──failure──▶ ⛩ Godkend merge ─────┘ (port: et menneske godkender,
   └──failure──▶ Stoppet                                        så merger stationen)
                    ▲                                       │
                    └───────────────────────────failure─────┘
```

**Importér:** `https://agentics.dk/import?repo=https://github.com/pksorensen/alp-pr-review`

Linjen står på [markedspladsen](https://agentics.dk/u/pksorensen/marketplace): `.github/workflows/publish-marketplace.yml`
skubber kortet derover ved push til `main` via GitHub OIDC (ingen gemt hemmelighed) — bump `version`
i `.agentics/assembly-line.json` for en ny version.

## Hvad linjen gør

| Station | Gør | `success` | `failure` |
|---|---|---|---|
| **Review** | Læser diffen i projektets repo, skriver et review til GitHub og en struktureret dom. | Dommen er `approve` | Alt andet — og «forældet», «lukket», «release-pr». Reviewet står på GitHub; kortet stopper. |
| **Jev-routing** | Hårde regler i kode → Jev over runnerens socket → tærskler. Ser aldrig PR-teksten. | Må merges uden menneske | Et menneske skal se det → kortet parkeres ved porten **Godkend merge**. Godkend = merge-stationen kører. Porten har ingen afvis-knap: skal PR'et ikke merges, luk det på GitHub eller flyt kortet til Stoppet. |
| **Merge** | Squash-merger — kun hvis head er uændret siden reviewet og checks er grønne. | Merget | Head flyttet, røde checks, ikke mergebar, ventetid udløbet |

«Failure» er ALP v1's ene binære kanal, og linjen bruger den som «går ikke videre af sig
selv», ikke som «noget gik galt». Hver station skriver det i sin kortkommentar.

### Hvad Jev afgør — og hvad den ikke får lov til

Jev får **strukturerede felter** (filkategorier, størrelse, checks, om det er en fork, om
en submodul-pointer flyttes) og **reviewerens egen dom** (`approve`, fund, usikkerheder).
Den får aldrig PR-titel, -beskrivelse eller diff. Det er derfor et PR ikke kan tale sig
selv til automerge: den eneste fri tekst Jev ser, er skrevet af vores egen reviewer.

Før Jev overhovedet spørges, afgør hårde regler i `tools/jev-route.mjs` at et menneske
skal se: udkast, forks, release-please-PR'er, submodul-pointere, migrationer, auth,
betalinger, hemmeligheder, røde checks, blokerende fund, en dom der ikke er `approve`.
Jev afgør resten inden for tærsklerne i `tools/jev-questions.mjs`.

Kan Jev ikke nås (ingen nøgle, repoet ikke på allow-listen, socketen mangler), lukker
linjen **sikkert**: kortet går til porten med forklaringen i kommentaren.

## Det projektet skal have

1. **`gitUrl` = det repo der skal reviewes.** Stationerne står i projektets repo og læser
   PR'ets head derfra. Linjen reviewer det repo, og kun det: runnerens legitimationssocket
   udsteder GitHub-adgang for præcis det repo jobbets token blev udstedt til. **Et PR i et
   andet repo — fx et submodul under en anden ejer — kan linjen ikke nå fra dette projekt.**
   Giv hvert repo sit eget projekt og importér linjen igen dér.
   Linjen medbringer sin egen devcontainer (`.agentics/devcontainer/`), så repoets egen
   `.devcontainer/` bruges ikke af stationerne: runneren kræver `tmux`, `ttyd` og `claude`
   i containeren, og en udviklings-devcontainer har typisk kun det sidste. Den installerer
   også en git-credential-helper der taler med runnerens socket, så `git fetch` af PR'ets
   head virker uden token i containeren.
2. **En runner med TypeSafe-nøgle.** På runner-værten, én gang:
   ```bash
   pks typesafe init                       # nøglen bedes om skjult, valideres mod /v1/models
   pks typesafe allow <owner>/<repo>       # jobs fra dette repo må spørge Jev
   pks typesafe status
   ```
   Kræver pks-cli med `pks typesafe` (fra 7.6.0; commit `ed664f8`). Uden nøgle kører
   linjen stadig — alt går bare til porten.
3. **Ingress fra GitHub.** Kopiér [`workflow/alp-review.yml`](workflow/alp-review.yml) til
   `.github/workflows/alp-review.yml` i repoet og udfyld de tre værdier under `env:`
   (`ALP_OWNER`, `ALP_PROJECT`, `ALP_LINE_ID` — linje-id'et står i URL'en efter importen).
   **Ingen secrets.** Jobbet beder GitHub om et OIDC-token med linjens side-URL som
   audience, og linjen tager imod det fordi repoet står på linjens liste
   **Trusted GitHub repositories** (linjens *Settings* på agentics.dk — tilføj
   `<owner>/<repo>`, lad ref/env/workflow stå tomme). Et token udstedt til én linje virker
   ikke mod en anden, og et OIDC-kort må både oprette kortet og starte første station
   (etiketten `runner`) — det er samme rettigheder som en connection med `tasks:write`
   + `runs:dispatch`, bare uden en token der kan lækkes.

   Vil du hellere have en token (fx fra et andet CI-system end GitHub), virker en
   ProjectConnection-token (`pct_…`) med de to scopes stadig — sæt den som bearer i stedet
   for OIDC-tokenet.

Rækkefølgen er: importér → aflæs linje-id → tilføj repoet under Trusted GitHub
repositories → merge workflowet med de tre værdier. **Importér én gang.** En ny import giver en ny linje med et nyt id, og så
peger workflowets URL på den gamle. Opdateringer af linjen tages ved at redigere den
levende linje; værktøjerne i `tools/` klones friske ved hvert job og kræver ingen re-import.

## Kalibrering

Tærsklerne i `tools/jev-questions.mjs` er **ikke tunede**. De er sat så linjen sender til
et menneske ved mindste tvivl (`needs_human < 0.25` for automerge, risiko under «Medium»,
konfidens over 0.6). Det er med vilje: det dyre udfald er et forkert automerge.

Sådan tunes de: lad linjen køre et par uger. Hvert kort ved porten har Jevs tal i
kommentaren (`JEV: needs_human=… risk=… (konfidens …)`). Sammenlign dem med hvad mennesket
så gjorde. Flyt én tærskel ad gangen, løft `VERSION`, og skriv i commit-beskeden hvilke
kort der begrundede det. Skift af model (`MODEL`) nulstiller kalibreringen — spørgsmål,
model og tærskler versioneres sammen.

Håndkørsel af routingen på et vilkårligt PR, uden runner:

```bash
export GITHUB_TOKEN=$(gh auth token) TYPESAFE_API_KEY=…   # nøglen kun i denne shell
node tools/pr-context.mjs --repo owner/repo --pr 6
node tools/verdict-from-github.mjs --repo owner/repo --pr 6   # eller skriv verdict.json selv
node tools/jev-route.mjs            # --dry-run viser det Jev ville få, uden at spørge
```

## Hvad linjen ikke er

- **Ikke en erstatning for branch protection.** Kræver repoet et review fra en anden end
  forfatteren, kan linjen ikke give det (GitHub afviser at et token godkender sit eget
  PR; reviewet bliver en kommentar). Merge-stationen melder så «ikke mergebar», og kortet
  stopper. Beslut i repoet om linjens merge er nok.
- **Ikke release-flowet.** Release-please-PR'er springes over ved ingress og stoppes af
  en hård regel, hvis de alligevel kommer ind. En release er en menneskelig beslutning.
- **Ikke platform-routing.** Jev sidder i en station, fordi ALP v1's transitioner er
  binære. Hvordan det kunne blive en typet transitionsbetingelse i platformen står i
  [`docs/typed-condition.md`](docs/typed-condition.md).

## Filer

```
.agentics/        linjen: stationer, porte, transitioner — det importen læser
tools/            afhængighedsfri Node 20+, klones af stationerne ved kørsel
  pr-context.mjs          strukturerede fakta om PR'et (+ «forældet»/release-pr)
  post-review.mjs         dommen → GitHub-review + verdict.json
  verdict-from-github.mjs dommen tilbage fra GitHub i næste station
  jev-questions.mjs       spørgsmål + tærskler + version — ÉT sted
  jev-route.mjs           hårde regler → Jev over socketen → udfald (exit 0/1)
  merge.mjs               squash-merge, kun samme head og grønne checks
workflow/         ingress-workflowet til det reviewede repo
docs/             designnotat om typede transitioner i platformen
```
