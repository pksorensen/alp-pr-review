#!/usr/bin/env node
// Henter alt det strukturerede om ét pull request og skriver det som JSON — både til
// stdout og til $STATE_DIR/context.json, som de næste værktøjer læser.
//
//   node pr-context.mjs --repo owner/repo --pr 6 [--head <sha fra kortet>]
//
// Det er DET HER værktøj der afgør «superseded»: er `--head` givet og PR'ets head er en
// anden, er kortet forældet (der kom et nyt push og dermed et nyt kort), og stationen
// skal stoppe uden at reviewe. Det er også her release-please-PR'er genkendes, så
// beslutningen ikke ligger i en prompt.
//
// PR-titel og -beskrivelse er skrevet af hvem som helst med adgang til at åbne et PR.
// De pakkes ind som ⟦untrusted⟧, og de indgår ALDRIG i det Jev ser (jev-route.mjs).

import { join } from 'node:path';
import { arg, die, github, githubAll, parseRepo, STATE_DIR, untrusted, writeJson } from './lib/common.mjs';

const { owner, repo } = parseRepo(arg('repo'));
const number = Number(arg('pr'));
if (!Number.isInteger(number) || number <= 0) die('--pr skal være et PR-nummer');
const cardHead = arg('head', '');

const base = `/repos/${owner}/${repo}`;
const pr = await github(`${base}/pulls/${number}`);
if (pr.status === 404) die(`PR #${number} findes ikke i ${owner}/${repo}, eller tokenet kan ikke se repoet (HTTP 404).`);
if (pr.status !== 200) die(`GitHub svarede HTTP ${pr.status} på PR'et: ${pr.text.slice(0, 300)}`);
const p = pr.json;

const files = await githubAll(`${base}/pulls/${number}/files`);
if (files.status !== 200) die(`Kunne ikke hente filerne (HTTP ${files.status}).`);

// Checks: både check-runs (Actions) og ældre commit-statusser. Begge skal være grønne.
const checkRuns = await github(`${base}/commits/${p.head.sha}/check-runs?per_page=100`);
const statuses = await github(`${base}/commits/${p.head.sha}/status`);
const runs = (checkRuns.json?.check_runs ?? []).map((c) => ({
    name: c.name, status: c.status, conclusion: c.conclusion,
}));
const contexts = (statuses.json?.statuses ?? []).map((s) => ({ name: s.context, status: 'completed', conclusion: s.state }));
const checks = [...runs, ...contexts];
const checksState = checks.length === 0 ? 'none'
    : checks.some((c) => c.status === 'completed' && !['success', 'neutral', 'skipped'].includes(c.conclusion)) ? 'failure'
    : checks.some((c) => c.status !== 'completed') ? 'pending'
    : 'success';

// Klassificering af stier. Bevidst grov: Jev får kategorier, ikke stier.
const classify = (path) => {
    const lower = path.toLowerCase();
    if (/(^|\/)(tests?|__tests__|spec|e2e)\//.test(lower) || /\.(test|spec)\.\w+$/.test(lower)) return 'tests';
    if (/\.(md|mdx|txt|rst)$/.test(lower) || /(^|\/)docs?\//.test(lower)) return 'docs';
    if (/(^|\/)(migrations?|prisma\/migrations|alembic)\//.test(lower) || /\.sql$/.test(lower)) return 'migration';
    if (/(^|\/)(auth|oauth|login|session|keycloak|permissions?|rbac|acl)[^/]*\//.test(lower) || /(^|\/)(auth|oauth|login|session|permissions?)[^/]*\.\w+$/.test(lower)) return 'auth';
    if (/(stripe|payment|billing|checkout|payout|invoice)/.test(lower)) return 'payments';
    if (/(^|\/)\.github\/workflows\//.test(lower) || /(^|\/)(deploy|infra|infrastructure|terraform|k8s|helm|docker-compose|dockerfile)(\/|$|\.)/.test(lower) || /(^|\/)apphost\//.test(lower)) return 'deploy';
    if (/(secret|credential|\.env|vault|token)/.test(lower)) return 'secrets';
    if (/(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|.*\.csproj|directory\.packages\.props|go\.(mod|sum)|requirements.*\.txt)$/.test(lower)) return 'dependencies';
    if (/(^|\/)\.(github|devcontainer|vscode)\//.test(lower) || /(^|\/)(\.editorconfig|\.gitignore|\.prettierrc.*|eslint\.config\.\w+|tsconfig.*\.json)$/.test(lower)) return 'config';
    return 'product';
};

const fileList = files.items.map((f) => ({
    path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions,
    category: classify(f.filename),
    // Et submodul-pointer-skift ser i GitHubs fil-API ud som en 1+/1- patch med «Subproject commit».
    submodulePointer: /Subproject commit/.test(f.patch ?? ''),
}));
const categories = {};
for (const f of fileList) categories[f.category] = (categories[f.category] ?? 0) + 1;
const submodulePointers = fileList.filter((f) => f.submodulePointer).map((f) => f.path);
const headRef = p.head.ref ?? '';
const isReleasePr = /^release-please--/.test(headRef) || /\[bot\]$/.test(p.user?.login ?? '') && /^chore\(main\): release/.test(p.title ?? '');

const context = {
    generatedAt: new Date().toISOString(),
    repo: `${owner}/${repo}`,
    number,
    url: p.html_url,
    state: p.state,
    draft: !!p.draft,
    merged: !!p.merged,
    mergeable: p.mergeable,               // null = GitHub regner stadig
    mergeableState: p.mergeable_state,    // clean | dirty | blocked | behind | unstable | unknown
    author: p.user?.login ?? '',
    authorType: p.user?.type ?? '',
    base: { ref: p.base.ref, sha: p.base.sha },
    head: { ref: headRef, sha: p.head.sha, fork: !!p.head.repo && p.head.repo.full_name !== `${owner}/${repo}` },
    cardHead: cardHead || null,
    superseded: !!cardHead && cardHead !== p.head.sha,
    isReleasePr,
    title: untrusted(p.title, 300),
    body: untrusted(p.body, 4000),
    commits: p.commits,
    changedFiles: p.changed_files,
    additions: p.additions,
    deletions: p.deletions,
    categories,
    submodulePointers,
    files: fileList,
    checks,
    checksState,
    reviews: [],
};
const reviews = await githubAll(`${base}/pulls/${number}/reviews`);
if (reviews.status === 200) {
    context.reviews = reviews.items.map((r) => ({ author: r.user?.login, state: r.state, submittedAt: r.submitted_at }));
}

const out = join(STATE_DIR, 'context.json');
await writeJson(out, context);
console.log(JSON.stringify(context, null, 2));
console.error(`\nSkrevet til ${out}`);
if (context.superseded) console.error(`SUPERSEDED: kortets head ${cardHead} ≠ PR'ets head ${p.head.sha}. Stop uden review.`);
if (context.state !== 'open') console.error(`PR'et er ${context.merged ? 'merget' : 'lukket'}. Stop uden review.`);
