// ÉT sted for det Jev bliver spurgt om, og hvad svarene skal måle sig mod.
//
// Model, spørgsmål og tærskler versioneres SAMMEN: et svar fra jev-1.13.0 på ét
// spørgsmålssæt siger intet om tærsklen for et andet. Ændrer du én af de tre, så løft
// `version` og kør kalibreringssættet igen (README → «Kalibrering»).
//
// Tærsklerne herunder er IKKE tunede. De er startværdier valgt så linjen lukker sikkert
// (sender til et menneske) indtil nogen har set svarene på rigtige PR'er. Det er en
// egenskab, ikke en mangel: det dyre udfald er et forkert automerge, og det billige er
// en godkendelse et menneske alligevel ville have givet.

export const VERSION = '2026-09-19.1';

// `null` = brug runnerens standard (pks typesafe init --model). Sæt en versioneret id
// når tærsklerne er tunet mod den.
export const MODEL = null;

export const QUESTIONS = {
    needs_human: {
        type: 'noul',
        instructions:
            'A pull request was reviewed by an automated code reviewer. Given the review verdict and ' +
            'the structured facts about the change, should a human look at this pull request before ' +
            'it is merged? Answer yes when the change touches something a mistake would be costly in ' +
            '(authentication, payments, data migrations, deployment, secrets, permissions), when the ' +
            'reviewer found anything it was not certain about, when the change is large or spread ' +
            'across many areas, or when the description does not match what the files say. Answer ' +
            'no when the change is small, self-contained, fully covered by green checks, and the ' +
            'reviewer approved it without reservations.',
    },
    risk: {
        type: 'score',
        instructions:
            'How costly would it be if this pull request were merged and turned out to be wrong?',
        criteria: [
            'Trivial: documentation, comments, formatting, test-only or CI-only changes. A wrong merge is undone in minutes with no user impact.',
            'Low: isolated product code with tests, no schema, auth, payment or deployment surface. A wrong merge shows up in the next test run or in one screen.',
            'Medium: shared code, configuration, dependency updates, or UI that many screens use. A wrong merge could break a feature for users until the next release.',
            'High: authentication, authorization, payments, data migrations, deployment or infrastructure, secrets handling, or a submodule pointer move. A wrong merge could lose data, money or access.',
        ],
    },
};

// `needs_human` er ja/nej-sandsynligheden for «et menneske skal se det». Under `autoBelow`
// merger linjen selv. Alt andet går til porten. `risk` er en ekstra bremse: en score på
// eller over `humanAtOrAbove` sender til et menneske uanset `needs_human`.
export const THRESHOLDS = {
    needs_human: { autoBelow: 0.25 },
    risk: { humanAtOrAbove: 2 },
    // Jev melder selv hvor sikker den er på et choice/score-svar. Under dette: menneske.
    minConfidence: 0.6,
};
