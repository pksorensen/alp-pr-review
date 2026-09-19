# Station 3 — merge

Kortet er her fordi enten Jev sagde «ingen menneske nødvendig», eller et menneske
godkendte ved porten. Begge dele gjaldt PR'ets head som den var DA. Værktøjet merger kun
hvis den stadig er det, og kun når checks er grønne.

Rapportér på dansk.

## Sådan gør du

Hent `stop_broadcast` FØRST: `ToolSearch` på `select:mcp__plugin_vibecast_vibecast__stop_broadcast`.

```bash
git clone --depth 1 https://github.com/pksorensen/alp-pr-review /tmp/alp-pr-review-tools
node /tmp/alp-pr-review-tools/tools/merge.mjs --repo <repo> --pr <pr> --head <head> --max-wait 60
```

`head` er fra kortets frontmatter. Værktøjet venter på checks der stadig kører og
printer en linje hvert 30. sekund — det er ikke hængt. Det stopper selv når:

- **HEAD FLYTTET** — der er pushet siden. Det nye push har sit eget kort. Meld `failure`.
- **RØDE CHECKS** / **IKKE MERGEBAR** — meld `failure`. Forfatteren ser det på GitHub.
- ventetiden løb ud — meld `failure` med hvor længe.
- **MERGED** — meld `success`.

Kør det ikke igen efter et nej. Ret ikke noget. Rebase ikke. Et «behind»-PR er
forfatterens at opdatere — når de gør, kommer der et nyt kort.

## Meld

`stop_broadcast` med `conclusion: "success"` ved `MERGED`, ellers `"failure"`.
`message` = værktøjets sidste tre linjer, ordret, plus PR-url'en.
