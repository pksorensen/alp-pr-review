# Designnotat: typede transitionsbetingelser i ALP

*Status: forslag, ikke implementeret. Linjen `alp-pr-review` kører uden det — Jev-routingen
ligger i en station (`02-route`), og stationens binære `success`/`failure` bærer svaret.*

## Problemet

ALP v1 (`external/alp-spec/2026-03-30-draft/spec/06-transition-rules.md`) kender fire
betingelser: `success | failure | cancelled | any`. En linje der vil rute på *noget andet
end om jobbet lykkedes* — en score, en sandsynlighed, en klassifikation — må enten

1. bruge en hel station som «router» og kode svaret ind i `success`/`failure`
   (det gør `alp-pr-review` og CommuteConnects' feedback-linje i dag), eller
2. vente på spec v2's «Agentic Condition» (`evaluator`, `onYes`/`onNo`), som ikke er
   implementeret.

Løsning 1 virker, men koster en agentkørsel (container, model, minutter) for at træffe
en beslutning der tager 300 ms og ikke behøver en agent. Og den overbelaster ordet
«failure»: hver station-prompt i den stil har et afsnit der forklarer at «failure» ikke
er en fejl.

## Forslaget: `condition: { kind: "typed", … }`

En transitionsregel kan bære en typet betingelse, som platformen evaluerer i
`PATCH …/runs/[runId]/jobs/[jobId]` (trin 7, `rules.find(...)`) og i mock-stien i
`task-dispatch.ts`, **efter** jobbet er afsluttet og **før** kortet flyttes:

```jsonc
{
  "id": "route-auto",
  "fromColumnId": "review",
  "toColumnId": "merge",
  "condition": {
    "kind": "typed",
    "when": "success",                // jobbets udfald skal stadig matche først
    "evaluator": "typesafe/systemone", // hvem der svarer
    "input": { "from": "job.result" }, // stationens strukturerede resultat (se nedenfor)
    "questions": { "needs_human": { "type": "noul", "instructions": "…" } },
    "route": [
      { "if": { "needs_human": { "lt": 0.25 } }, "to": "merge" },
      { "else": true, "to": "merge", "gateId": "godkend-merge" }
    ],
    "fallback": { "to": "merge", "gateId": "godkend-merge" }  // evaluator utilgængelig
  }
}
```

Tre ting gør det til mere end syntaks:

- **Stationen leverer et struktureret resultat.** `stop_broadcast` får et valgfrit
  `result: object` (spec: `JobCompletion.result`), som platformen gemmer på jobbet. Det er
  det evaluatoren ser — ikke joblogget, ikke kortet. En station der vil rutes typet,
  skriver sit resultat; en der ikke gør, får `fallback`.
- **Evaluatoren er platformens, ikke stationens.** Nøglen til TypeSafe ligger hos
  platformen (env `TYPESAFE_API_KEY` på www-site), ikke i nogen container. Rate limits,
  retries og logning er ét sted. `pks typesafe` på runneren er stadig vejen for
  stationer der selv vil spørge — de to udelukker ikke hinanden.
- **`fallback` er obligatorisk.** En typet betingelse uden fallback afvises af
  import-validatoren (`VALID_CONDITIONS` i `assembly-line-import.ts` skal udvides til at
  acceptere objektformen). Linjen skal have et defineret udfald når evaluatoren er nede,
  og det skal være det *sikre* udfald.

## Hvad der skal røres

| Sted | Ændring |
|---|---|
| `external/alp-spec` §06 | Tilføj «Typed Condition» som v1.1-udvidelse ved siden af v2's Agentic Condition; definér `JobCompletion.result`. |
| `src/lib/assembly-line-types.ts` | `TransitionRule.condition: 'success' \| … \| TypedCondition`. |
| `assembly-line-import.ts` | Validér objektformen; kræv `fallback`; eksportér den symmetrisk. |
| `jobs/[jobId]/route.ts` trin 7 + `task-dispatch.ts` mock-sti | Efter udfaldsmatch: hvis regel er typet → kald evaluator → vælg `route[]`-linje → sæt `toColumnId`/`gateId` derfra. Log spørgsmål, svar og valgt linje på jobbet, så et kort kan forklares bagefter. |
| `src/lib/evaluators/typesafe.ts` | Ét modul: `POST /v1/systemone`, 5 s timeout, ingen retries ud over én, `fallback` ved alt andet end 200. |
| Vibecast `stop_broadcast` | `result?: object` sendes med i `PATCH`. |
| UI (transitionsredigering) | Vis den typede regel læsbart; redigering kan vente. |

## Hvad det IKKE er

- Ikke en generel «kør kode i platformen». Evaluatoren er en navngiven, platform-ejet
  integration; `route[]` er sammenligninger, ikke udtryk.
- Ikke en erstatning for gates. En typet betingelse *vælger* om der er en gate; den
  godkender ikke selv.
- Ikke v2's Agentic Condition. Den lader en agent afgøre; det her lader en *model med
  kalibrerede sandsynligheder* afgøre, deterministisk nok til at tærskler kan tunes.

## Hvorfor vente

`alp-pr-review` er den første linje der vil bruge det, og dens tærskler er ikke tunede
endnu. Først når et par uger af kort har vist hvor `needs_human` og `risk` lander på
rigtige PR'er, ved vi om spørgsmålene er de rigtige — og det er billigere at ændre et
spørgsmål i `tools/jev-questions.mjs` end i platformens transitionsmodel. Byg det når
den anden linje melder sig.
