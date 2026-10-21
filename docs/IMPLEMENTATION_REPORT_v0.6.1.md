# LEP: Lilith Event Paradox v0.6.1 — implementation report

## 1. Completed work and authoritative baseline

Implemented the attached Polish & Consolidation scope in the current repository
clone, `lep-lilith_event_paradox/`, in the shared workspace. Git baseline:
`main`, commit `18956507132cada0f1c1299c4a639b409b438e93`, initially clean.
The parent workspace and previous `event_paradox/` folder were not Git checkouts.
The previous local release is retained unchanged; the authoritative updated
installation is this repository's `LEP/` directory. Nothing was committed,
pushed or deployed to GitHub or a live adventure.

The baseline GitHub runtime was byte-identical to the previous local v0.6
Library. The published runner could not start: it referenced missing root-level
runtime files and omitted fixtures/import data. After path repairs and restoring
those matching assets, the published suite recorded **210/226 passing, 16 failing**.
Several expectations still referred to old display labels. The six published
JavaScript files passed syntax checking. The newer local matching-runtime suite
was restored to retain all 358 existing regression cases, including 82 scheduler
and integration regressions absent from the published runner.

The LPT main library was inspected for its comment-rich config generator,
comment parsing, exact-sentinel collision checks and preservation of editable
Entries. No LPT runtime or gameplay mechanics were copied.

## 2. File changes and consolidation

Logical renames (Git shows deletes plus new untracked paths until staged):

- `EP/{Library,Input,Context,Output}.js` → `LEP/` with those filenames.
- `docs/EventParadox_Technical_Reference.txt` → `docs/LEP_Technical_Reference.txt`.
- `AuthorToolKit/EventParadox_Events_Creator.txt` → current
  `AuthorToolKit/LEP_Events_Creator.txt`; the stale published v0.4 guide was
  updated using the matching local v0.6 guide before the namespace update.

Removed stale duplicate first-party distributions: EventParadox authoring spec,
workbook, worked examples, Skill Builder guide, and `EP_Builder_Skill.zip`.
The corresponding LEP_* files are the single canonical toolkit.
Historical `docs/RELEASE_NOTES_v0.6.txt` remains byte-for-byte from Git HEAD.

Edited: README, third-party descriptions, canonical toolkit documents,
`docs/events.example.js`, and the test runner. Rebuilt `LEP_Builder_Skill.zip`.

Created/restored: config import JSON, sample Character/Location import JSON,
two test fixtures, inspectable `lep-builder/` skill source with canonical
symlinks, complete pinned Inner Self derivative/license/metadata/patch,
configuration/status Entry examples, v0.6.1 release notes, 23-case manual
checklist, distribution integrity checker, operation-count probe and deterministic
skill packaging tool. No duplicate Library_Missing_Stage_Key runtime was added:
the single Library already includes that sample, and fixtures hold test data.

## 3. Exact current namespace

- Release: `LEP_VERSION = "0.6.1"`.
- Author globals: `LEP_START`, `LEP_CHAPTERS`, `LEP_EVENTS`.
- Controls: `/lep`; all existing 16 commands retained under that prefix.
- First-party helpers/constants/wrappers: `LEP_*`.
- Progress: `state.lep`; transport: `state.lepConsole`;
  automatic cards: `state.lepAutoCards`; adapter: `state.lepInnerSelf`.
- Bounded, separately validated card ledger: `state.lepCards`, schema version 1,
  at most 512 serialized characters; booleans, safe outcome enum and optional
  bounded attempted-write fingerprint. It contains no event variables or prose.
- Config key `__LEP_CONFIG_V1__`, Type `LEP — Configuration`.
- Status key `__LEP_AUTOCARDS_STATUS_V1__`, Type `LEP — Auto-Cards Status`.
- Character memory prefix `__LEP_CHARACTER_V1__`, Type `LEP Character v1`.
- Journal key `__LEP_JOURNAL_V1__`, Type `LEP Journal v1`.
- Sidecar `[LEP_AUTOCARDS_<slot hash>]` ... `[/LEP_AUTOCARDS]`.
- Ownership `[LEP Auto-Cards <token>]` and content-checked
  `[LEP Auto-Cards revision <slot hash> <content hash>]`.
- Console, context memory and timeline frames use LEP.

Progress/console/Auto-Cards/Inner Self delivery numeric schemas remain version 1.
Native upstream `state.InnerSelf`, MainSettings lookup of `InnerSelf`, @Name
conventions, upstream repositories, source pins and licenses retain their identities.

## 4. Intentionally breaking installation

Start a NEW adventure. Paste the four LEP/ files; author only the new LEP_*
globals. Use the new configuration identity and `/lep` controls. Keep the old
runtime in real <=v0.6 adventures. Do not mix old cards/state with v0.6.1 and do
not delete old progress to simulate migration. No automatic migration, dual
writers, old command aliases or old author globals are active.

Exact legacy state identities, author globals, old config/journal/mirror machine
cards and old Auto-Cards ownership headers trigger a non-migrating guard before
initialization, console capture or subsystem mutation. It logs a bounded,
actionable warning and Output returns a non-story blocked notice. Tests verify
that legacy progress and cards remain byte-identical and no new cards are added.
Ordinary historical prose containing “Event Paradox” does not trigger it.
Old `/ep` input is ordinary text, so it can still produce an ordinary story turn;
it never executes the named command. Host-invisible state/cards cannot be
perfectly detected. Fresh adventures are required even when detection is limited.

## 5. Actual generated primary configuration Entry

```ini
# LEP: LILITH EVENT PARADOX — CONFIGURATION
# Edit values after =. Lines beginning with # are help comments.
# Do not modify Triggers/Type. Run /lep help with a Do action.

# --- ENGINE ---
# true / false. false pauses LEP without erasing progress; read-only commands remain available.
enabled = true

# --- MEMORY ---
# compact = chapter + authored context; character = relevant character facts too;
# full = extended authored memories and optional journal behavior.
memoryMode = compact
# Approximate Context token allowance: 0..600, not an exact tokenizer.
# 0 suppresses injection without deleting saved memories.
memoryBudget = 120
# true / false. Authored character-memory MIRROR cards, separate from world Auto-Cards.
# Requires character or full memoryMode.
autoCharacterCards = false
# true / false. Bounded authored event journal mirror; requires full memoryMode.
journalEnabled = false

# --- INTEGRATIONS ---
# Auto-Cards originally by LewdLeah.
# true / false. Discover/create/update world cards; creator Character/Location registration works when false.
# Enabling creates an informational STATUS card promptly; world cards require evidence and may be delayed.
autoCardsEnabled = false
# Inner Self originally by LewdLeah.
# true / false. Optional NPC simulation; LEP events work without it.
# Inner Self's own character/NPC settings remain separate.
innerSelfEnabled = false

# --- DIAGNOSTICS ---
# true / false. Bounded scripting-console logs; /lep commands do not require debug.
debug = false
```

The eight defaults and parsing semantics are retained. Commands in the console
do not need debug; deprecated config-card development fields still require the
existing enabled/debug/revision gates. Exact duplicate config sentinels and
wrong Types now block; they are never chosen arbitrarily or overwritten.
Same-namespace edited Entry/comments are not regenerated. Bounded warnings are
available in `/lep status`, including unknown/malformed/duplicate/invalid lines.

## 6. Actual immediate Auto-Cards status Entry

```text
# LEP — AUTO-CARDS STATUS
# Informational only. Settings live in LEP Configuration.
# Auto-Cards originally by LewdLeah; integrated into LEP: Lilith Event Paradox.

Integration: enabled
Activity: Observing; waiting for at least two mentions across distinct successful story outputs.
Tracked candidates: 0
Currently confirmed LEP-owned automatic cards: 0
Last result: No creation attempt yet

How it works:
A likely entity needs at least two mentions across separate successful story outputs before consideration. Candidates, model compliance, cooldown, available Context room and card API readiness can delay or prevent creation/updates. Enabled does not guarantee a generated world card. Counts reflect the current available snapshot.

To change activation: edit autoCardsEnabled in LEP Configuration, NOT this status card. Manual edits here never configure LEP and may be refreshed by the engine.
```

This sample is asserted against actual generated output by the automated suite.
Observed activity covers waiting for evidence, repeated evidence awaiting an
opportunity, pending model response, cooldown, insufficient Context room,
transport storage deferral, unusable/no-confirmed result, disabled/paused and
unavailable card APIs. Last result separately records creation/update confirmation.
Counts show tracked candidates and currently content-confirmed owned world cards.
No general per-turn counter is displayed, so normal unchanged turns do not
force card writes. There is no promise that an eligible candidate will succeed.

## 7. Status lifecycle, failures and Retry/Undo

Ordinary Input synchronizes before optional Inner Self; Context synchronizes
after preparing/defering a card task; Output synchronizes after consuming the
sidecar and observing a successfully committed story output. Any one normal
eligible hook can create it without candidates, a model request or an extra
turn. Console cycles skip maintenance. Disabling/pausing retains and safely
refreshes an existing card; it does not create a new disabled companion.

Every write locates a unique current sentinel/Type identity. Wrong-Type and
duplicate status identities are diagnosed and untouched, without stopping event
play. Missing snapshots/APIs, exceptions and false/unknown returns are isolated.
Unconfirmed adds retain a bounded pending flag rather than retrying potentially
successful external creation. If a host never exposes the resulting card, the
flag intentionally remains closed; resolve host snapshots/APIs rather than
repeatedly guessing. A confirmed companion observed subsequently missing may
be recreated while enabled. Status updates require different Entry content and
a meaningfully different source/desired fingerprint. Identical failed update
attempts are deduplicated. The next safe snapshot is authoritative.

Retained/restored-state Retry and separate Undo-branch tests preserve unique
card identity and story transaction semantics. External cards can survive host
state rollback; LEP does not claim universal atomic external-card Undo.

## 8. Ownership, no configuration and no secret leakage

Only the exact config card is parsed. Status Entry is information, even if users
type `enabled`/`autoCardsEnabled` lines into it. Engine refresh is authoritative.
It is never a Character/Location/Class, registry entity, world-card count source,
candidate, prompt task or Inner Self Brain. Reserved-key/type filtering excludes
it from registry discovery; Context, recent evidence and Inner Self history
strip current status text. Sentinel collisions remain excluded too.

The renderer uses aggregate metadata and safe enums only, never raw error text,
candidate names, hidden relationship variables, private anchors, tokens,
ownership JSON or model sidecars. No second Auto-Cards installer/config engine
was introduced. Only integrated LEP discovery writes world cards.

## 9. Verified bug findings and regressions

- **Published distribution could not run its test suite.** Missing root paths,
  fixtures/import data and vendor provenance were reproduced and restored.
- **Config collision selection was unsafe.** Baseline `EP_loadConfig()` with two
  exact sentinel cards arbitrarily returned the first card's enabled=true value.
  New duplicate/foreign tests require fail-closed behavior without any mutation.
- **World-card updates claimed unobserved writes succeeded.** The baseline set
  confirmed=true after every update call, including false/no-change results.
  The new test checks unchanged ownership/content and an honest outcome.
  Reinstating that exact bug in memory produces **398/399**, failing precisely
  the new false-update regression; the fixed runtime passes **399/399**.
- **Configuration repeated work:** two parses per Context were demonstrated;
  a hook-local parsed-value cache reduces that to one, with no ownership cache.

The scheduler, transaction restoration, silent isolation, exclusive groups,
time/anchors, development commands, Inner Self toggles/exact authored prose and
sole Auto-Cards provider passed their retained regression coverage. No additional
runtime defect was reproduced there; those systems were not broadly rewritten.
Safe path/prototype protections, no eval and bounded progress/candidate/receipt
storage remain covered. New fixtures exercise a 1000-card collection and bounded
status/ledger content. No throughput or universal host-performance claim is made.

## 10. Narrow optimization evidence

`node tests/measure-config-parsing.js` instruments the actual parse site in the
Git v0.6 baseline and current Context: **before 2; after 1**. This is a 50% reduction
in configuration parses for that hook, not a claimed 50% faster hook.
The optional probe requires the original baseline at Git HEAD.
An unchanged status across 20 successive hooks produces **zero additional writes**;
20 repeats after a false update do not repeat the same unconfirmed write.
Ownership lookups still rescan current cards; no stale index/global ownership cache
was introduced. Unproven candidate/scanning rewrites were deliberately left alone.

## 11. Actual final validation

- Initial published suite: could not start (missing root Library.js).
- Repaired baseline path/assets, before runtime changes: **210/226 passing**.
- Retained newer suite after namespace adaptation: **358/358 passing**.
- Final suite: **399/399 passing; 0 failures** (41 additional v0.6.1 tests).
- JavaScript syntax: **10/10** files, including four runtime hooks/library,
  examples, two fixtures, derivative, runner and operation-count probe.
- Python packaging/integrity scripts: **2/2** compile successfully.
- Distribution checker passes; `git diff --check` passes.
- No live AI Dungeon test was run.

Reproduce with `node tests/run-tests.js`, `python3 tools/build-skill.py`,
`python3 tests/check-distribution.py`, and optionally the operation-count probe.
The test harness separately counts informational card writes so existing world
card-write assertions retain their meaning; companion identity/update behavior
has its own explicit coverage. Existing assertions were not discarded.

## 12. Toolkit and ZIP integrity

One canonical AuthorToolKit: specification, workbook, examples, builder guide,
creator guide and inspectable `lep-builder/`. Repository skill references are
symlinks to canonical maintained files; the ZIP contains eight resolved byte-for-
byte snapshots, not broken symlinks. All expected references and current author
APIs are checked. Packaging is deterministic in content and dependency-free.
No skill was installed globally.

The official skill validator could not start because this local Python lacks
PyYAML (`ModuleNotFoundError: yaml`). This is not reported as a pass. Ruby's
standard YAML library successfully parsed/validated SKILL frontmatter and UI
metadata; filesystem references, package bytes, runtime examples and namespace
contracts were validated independently.

## 13. Third-party licensing and provenance

Auto-Cards: LewdLeah, MIT copyright 2025; pinned
`c8a4e4d6e1ef03b3177fa35c8c332afe1f914aa3`.
Inner Self: LewdLeah, v1.0.2, pinned
`297a1a04c0e11b41f69e3e57a607b47eee34334b`.

Original license bytes are unchanged and embedded in the runtime, derivative and
notices. Inner Self license SHA-256:
`9fa7a26504726dfd0c9d933a3542ee443726c9b11508e6d4b9e850d26da0a14f`.
Original source SHA-256 remains
`3e79ed8b6f404e9619d1f0a0f6250897d4521ed84e905fa2d74b00db66240abe`.
The current LEP-integration.patch was regenerated against that verified pinned
original and applied to reconstruct the derivative byte-for-byte. No upstream
identifier/license/URL/hash was mechanically rebranded. Metadata records the
first-party wrapper rename separately from the historical v0.6 branding change.

## 14. Live gaps and host constraints

`docs/MANUAL_TEST_CHECKLIST_v0.6.1.txt` contains all 23 requested human checks,
explicitly marked NOT RUN LIVE. Host card snapshot timing, model compliance,
actual API returns, visual card title/Notes behavior, Retry/Undo rollback and
other-script composition still require live verification. Deterministic mock
results are not evidence of platform rollback guarantees. Status creation cannot
be promised when APIs/snapshots are missing; pending unconfirmed writes fail
closed. Host summaries or reformatted/truncated historical card text may evade
exact current-entry context cleanup; the runtime cannot control external
summarizers or detect every stale installation without host data.

## 15. Deliberately excluded

No automatic old-adventure migration, old command/definition aliases, dual state
writers, new event fields/roles/conditions, Time Paradox, deadlines, Optimized
Context, unrelated integrations, second Auto-Cards engine, runtime dependencies,
network requests, eval, async timer workflow, global skill installation or live
publishing. The release is **v0.6.1**, intentionally breaking at the namespace
boundary while preserving v0.6 gameplay semantics.
