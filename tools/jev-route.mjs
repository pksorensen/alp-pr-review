#!/usr/bin/env node
// Afgør om PR'et må merges uden et menneske. Svarer med exit-koden:
//   0 → AUTO  (stationen melder `success`, kortet går til Merge)
//   1 → HUMAN (stationen melder `failure`, kortet parkeres ved porten «Godkend merge»)
//   2 → værktøjsfejl (manglende filer, ugyldige argumenter) — også et menneske-udfald
//
//   node jev-route.mjs [--context $STATE_DIR/context.json] [--verdict $STATE_DIR/verdict.json] [--dry-run]
//
// Rækkefølgen er vigtig og bevidst:
//   1. Hårde regler i kode. De er ikke til forhandling, og de spørger ikke Jev.
//   2. Jev, over runnerens socket (nøglen bliver på værten). Jev ser KUN strukturerede
//      felter og reviewerens dom — aldrig PR-teksten, aldrig diffen. Det er det der gør
//      at et PR ikke kan tale sig selv til automerge.
//   3. Tærskler fra jev-questions.mjs. Kan Jev ikke nås (403/404/503, netværk): HUMAN.
//      Linjen lukker sikkert, den gætter ikke.
//
// Håndkørsel uden runner: sæt TYPESAFE_API_KEY, så kaldes api.typesafe.ai direkte.

import { join } from 'node:path';
import { arg, die, env, flag, readJson, socketRequest, STATE_DIR, writeJson } from './lib/common.mjs';
import { MODEL, QUESTIONS, THRESHOLDS, VERSION } from './jev-questions.mjs';

const contextPath = arg('context', join(STATE_DIR, 'context.json'));
const verdictPath = arg('verdict', join(STATE_DIR, 'verdict.json'));
const dryRun = flag('dry-run');

let context, verdict;
try { context = await readJson(contextPath); } catch (e) { die(`Kan ikke læse ${contextPath}: ${e.message}. Kør pr-context.mjs først.`, 2); }
try { verdict = await readJson(verdictPath); } catch (e) { die(`Kan ikke læse ${verdictPath}: ${e.message}. Review-stationen skal have skrevet den.`, 2); }

const reasons = [];
const human = (why) => { reasons.push(why); };

// ── 1. Hårde regler ────────────────────────────────────────────────────────────────
if (context.state !== 'open') human(`PR'et er ikke åbent (${context.state}).`);
if (context.superseded) human('Kortet er forældet: der er pushet siden det blev oprettet.');
if (context.draft) human('PR\'et er et udkast.');
if (context.isReleasePr) human('Release-PR (release-please): en release er en menneskelig beslutning.');
if (context.head?.fork) human('PR\'et kommer fra en fork.');
if (verdict.verdict !== 'approve') human(`Revieweren godkendte ikke (${verdict.verdict ?? 'ingen dom'}).`);
if (context.checksState === 'failure') human('Mindst ét check er rødt.');
if (context.checksState === 'none') human('Ingen checks kørte på PR\'et — intet at merge på.');
if ((context.submodulePointers ?? []).length > 0) human(`Flytter submodul-pointer: ${context.submodulePointers.join(', ')}.`);
for (const cat of ['migration', 'auth', 'payments', 'secrets']) {
    if (context.categories?.[cat]) human(`Rører ${cat} (${context.categories[cat]} fil(er)).`);
}
if ((verdict.blocking ?? []).length > 0) human(`Revieweren fandt ${verdict.blocking.length} blokerende fund.`);

const hardStop = reasons.length > 0;

// ── 2. Tilstanden Jev ser ──────────────────────────────────────────────────────────
// Små, strukturerede felter. Ingen fri tekst fra PR'et. Reviewerens egne ord er med,
// for de er det eneste der bærer *hvad* der blev fundet — og de er ikke fremmedes.
const state = {
    review: {
        verdict: verdict.verdict ?? 'none',
        summary: String(verdict.summary ?? '').slice(0, 800),
        concerns: (verdict.concerns ?? []).slice(0, 10).map((c) => String(c).slice(0, 200)),
        uncertain: (verdict.uncertain ?? []).slice(0, 10).map((c) => String(c).slice(0, 200)),
        description_matches_change: verdict.descriptionMatchesChange ?? 'unknown',
        tests_cover_change: verdict.testsCoverChange ?? 'unknown',
    },
    change: {
        files_changed: context.changedFiles,
        lines_added: context.additions,
        lines_deleted: context.deletions,
        commits: context.commits,
        categories: context.categories,
        touches_submodule_pointer: (context.submodulePointers ?? []).length > 0,
        checks: context.checksState,
        mergeable_state: context.mergeableState ?? 'unknown',
        author_is_bot: /bot/i.test(context.authorType ?? '') || /\[bot\]$/.test(context.author ?? ''),
        from_fork: !!context.head?.fork,
    },
};
const request = { state, questions: QUESTIONS, ...(MODEL ? { model: MODEL } : {}) };

if (dryRun) {
    console.log(JSON.stringify({ version: VERSION, hardStop, reasons, request }, null, 2));
    process.exit(hardStop ? 1 : 0);
}

// ── 3. Spørg Jev ───────────────────────────────────────────────────────────────────
let answer = null, jevError = null;
if (!hardStop) {
    try {
        const body = JSON.stringify(request);
        let status, text;
        if (env('TYPESAFE_API_KEY')) {
            const res = await fetch(`${(env('TYPESAFE_BASE_URL') || 'https://api.typesafe.ai').replace(/\/+$/, '')}/v1/systemone`, {
                method: 'POST',
                headers: { authorization: `Bearer ${env('TYPESAFE_API_KEY')}`, 'content-type': 'application/json' },
                body: JSON.stringify({ model: 'jev-latest', ...request }),
            });
            status = res.status; text = await res.text();
        } else {
            ({ status, body: text } = await socketRequest('/typesafe/systemone', { method: 'POST', body }));
        }
        if (status === 200) answer = JSON.parse(text);
        else jevError = `HTTP ${status}: ${text.slice(0, 300)}`;
    } catch (e) {
        jevError = e.message;
    }
    if (jevError) {
        human(`Jev kunne ikke spørges — linjen lukker sikkert. (${jevError})`);
        if (/HTTP 403/.test(jevError)) reasons.push('403 = repoet er ikke på runnerens allow-list: `pks typesafe allow owner/repo` på runner-værten.');
        if (/HTTP 404/.test(jevError)) reasons.push('404 = ingen nøgle på runner-værten: `pks typesafe init`.');
        if (/HTTP 503/.test(jevError)) reasons.push('503 = runneren er startet uden TypeSafe-servicen (pks-cli før 7.4).');
        if (/ENOENT|ECONNREFUSED/.test(jevError)) reasons.push('Ingen legitimationssocket: kører det her uden for et job, så sæt TYPESAFE_API_KEY.');
    }
}

// ── 4. Tærskler ────────────────────────────────────────────────────────────────────
const scores = {};
if (answer) {
    const nh = answer.answers?.needs_human;
    const rk = answer.answers?.risk;
    scores.needs_human = nh?.noul ?? null;
    scores.risk = rk?.score ?? null;
    scores.risk_confidence = rk?.confidence ?? null;
    scores.risk_probabilities = rk?.probabilities ?? null;
    scores.model = answer.model;
    if (scores.needs_human === null || scores.risk === null) human('Jev svarede uden begge felter — ukendt svarform.');
    else {
        if (scores.needs_human >= THRESHOLDS.needs_human.autoBelow) human(`Jev: P(menneske skal se det) = ${scores.needs_human.toFixed(2)} ≥ ${THRESHOLDS.needs_human.autoBelow}.`);
        if (scores.risk >= THRESHOLDS.risk.humanAtOrAbove) human(`Jev: risiko ${scores.risk.toFixed(2)} ≥ ${THRESHOLDS.risk.humanAtOrAbove} (${rk.legend?.[String(Math.round(scores.risk))] ?? ''}).`);
        if ((scores.risk_confidence ?? 0) < THRESHOLDS.minConfidence) human(`Jev: konfidens på risiko ${scores.risk_confidence?.toFixed(2)} < ${THRESHOLDS.minConfidence}.`);
    }
}

const route = reasons.length === 0 ? 'auto' : 'human';
const result = { version: VERSION, route, hardStop, reasons, scores, thresholds: THRESHOLDS, decidedAt: new Date().toISOString() };
await writeJson(join(STATE_DIR, 'route.json'), result);

console.log(`ROUTE: ${route}`);
console.log(`PR: ${context.repo}#${context.number} ${context.url}`);
if (answer) console.log(`JEV: needs_human=${scores.needs_human?.toFixed(2)} risk=${scores.risk?.toFixed(2)} (konfidens ${scores.risk_confidence?.toFixed(2)}) model=${scores.model} spørgsmål=${VERSION}`);
else if (!hardStop) console.log('JEV: ikke spurgt');
else console.log('JEV: ikke spurgt (hård regel afgjorde det)');
for (const r of reasons) console.log(`- ${r}`);
if (route === 'auto') console.log('- Ingen hård regel ramte, og Jev ligger under tærsklerne.');
process.exit(route === 'auto' ? 0 : 1);
