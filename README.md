<p align="center">
  <img src="assets/Neon Study Night_ Lilith Event Paradox.png" alt="LEP: Lilith Event Paradox" width="100%">
</p>

# LEP: Lilith Event Paradox v0.6

> **An event engine for AI Dungeon for people who made the mistake of having a plot.**

![Status](https://img.shields.io/badge/status-public_beta-orange)
![Version](https://img.shields.io/badge/version-0.6-purple)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-AI_Dungeon-black)

**LEP: Lilith Event Paradox** — formerly Event Paradox — is a deterministic event engine for AI Dungeon scenario creators.

I made it because apparently watching the AI acknowledge a carefully planned plot and then wander away from it five turns later was not enough suffering, so naturally I responded by building infrastructure.

LEP lets creators define **important scenes, explicit story state, consequences, branches and chapter transitions** while leaving AI Dungeon free to improvise between them.

You decide **what matters and what makes it eligible**.

The AI handles the messy human-shaped space in between.

That is still the theory.

---

## What's new in v0.6?

v0.6 is the **Event Semantics** release.

Previous versions could already fire deterministic scenes. v0.6 adds stronger ways to describe what those scenes *mean* to the story engine.

### Normal Events

The classic LEP behavior.

A normal event can fire while its conditions are true.

```js
{
  id: "bell_rings",
  chapter: "school",
  text: "The final bell rings."
}
```

### Milestone Events

A Milestone Event represents something that, once it becomes due, the story should not simply drift away from.

Prom. Graduation. A hearing. A festival opening. That kind of thing.

```js
{
  id: "prom_with_maya",
  role: "milestone",
  chapter: "prom",
  exclusiveGroup: "prom_outcome",
  when: {
    path: "relationship.partner",
    op: "eq",
    value: "maya"
  },
  display: "replace",
  text: "Maya waits beneath the lights at the entrance to the gym."
}
```

Once a milestone becomes eligible, LEP can **arm it as pending**. Later state changes do not magically erase the fact that the milestone became due.

The player can influence the outcome.

They just cannot avoid the existence of the milestone by wandering into a completely unrelated subplot for forty turns.

### Silent Events

Silent Events let the world change **without immediately telling the player**.

```js
{
  id: "maya_leaves_town",
  display: "silent",
  when: {
    path: "relationship.maya.status",
    op: "eq",
    value: "ex"
  },
  effects: [
    { path: "maya.leftTown", op: "set", value: true }
  ]
}
```

The event commits its deterministic state change, but its prose is not inserted into the visible story.

A later visible event can reveal what happened.

This is useful for NPCs doing things while the player is somewhere else — which feels healthier than a universe where everyone stands completely still until the protagonist enters the room.

### Chapter End Events

Chapter End Events make chapter resolution and branching explicit.

```js
{
  id: "choose_maya_route",
  role: "chapterEnd",
  chapter: "confession",
  exclusiveGroup: "confession_outcome",
  when: {
    path: "relationship.partner",
    op: "eq",
    value: "maya"
  },
  display: "replace",
  text: "By the time you leave the rooftop, something between you has changed.",
  nextChapter: "maya_route"
}
```

They are first-class chapter finales: visible, once-only, and tied to a specific destination chapter.

Old-style events with `nextChapter` are still supported. v0.6 does not force existing scenarios to rewrite working definitions just because I discovered another abstraction.

### Queued Events

Queued Events represent consequences that have already been set in motion.

```js
{
  id: "later_confrontation",
  queue: true,
  chapter: "school",
  when: {
    path: "maya.confrontationTriggered",
    op: "eq",
    value: true
  },
  text: "Maya finally corners you after class."
}
```

Once triggered, the event stays pending even if the original condition later changes.

Useful for:

- delayed confrontations;
- messages already sent;
- appointments;
- promised meetings;
- consequences that are now somebody else's problem.

### Exclusive Event Groups

Use `exclusiveGroup` when several events represent mutually exclusive outcomes.

```js
exclusiveGroup: "prom_outcome"
```

Once one member successfully commits, the other members of that group are permanently closed for the adventure.

This is an **at-most-one** guarantee.

LEP will stop two incompatible prom outcomes from both becoming canon.

It will not invent a missing third option because you forgot to write one.

---

## One visible event. One background consequence.

v0.6 keeps event execution deliberately bounded.

A normal successful story Output may commit:

- at most **one visible authored event**;
- and at most **one silent/background event**.

That means a visible breakup event can change state and allow one Silent Event to react during the same cycle.

What LEP will *not* do is silently chain ten background events together and rewrite half the cast's lives because one boolean changed.

I would like debugging this project to remain merely questionable, not supernatural.

---

## What LEP actually does

LEP can:

- fire **exact creator-written scenes** when explicit conditions are met;
- organize stories into **chapters** with optional visible titles and openings;
- track creator-defined **variables, choices and consequences**;
- build deterministic **branches** without asking the model to guess what the player meant;
- create **Milestone Events** that remain pending once due;
- run **Silent Events** for off-screen world consequences;
- create **Queued Events** for delayed but persistent consequences;
- define first-class **Chapter End Events**;
- enforce **exclusive outcome groups**;
- keep bounded creator-authored **memories** across chapters;
- use registered **Characters and Locations** as dynamic entities;
- optionally create/update entity Story Cards through LEP's adapted **Auto-Cards** subsystem;
- optionally run an integrated **Inner Self** compatibility build;
- track authored **narrative time** in years, months, weeks, days and hours;
- record important **Time Anchors**;
- perform canonical manual time skips with `/ep timeSkip`;
- inspect state and definitions through `/ep get`, `/ep vars` and `/ep inspect`;
- preview and force events/chapters through the `/ep` console;
- commit event prose, effects, memory, time, group resolution and chapter changes transactionally;
- preserve Retry safety so successful consequences are not supposed to happen twice because AI Dungeon decided to have another go.

And no, LEP still does **not** read the player's mind.

That part remains intentional.

---

## What LEP is *not*

It is not a replacement for AI Dungeon's model.

It is not a visual novel engine pretending to be an LLM.

It is not a semantic oracle that understands:

> "I guess I'll go check backstage."

as:

```text
choice.search = "backstage"
```

If a story decision matters to deterministic logic, LEP expects explicit state.

The AI still writes the ordinary story.

LEP just makes sure some important things are not left entirely to vibes.

---

# Public Beta

**v0.6 is still a public beta.**

The engine has a dependency-free offline Node test suite covering the major event, scheduler, console, entity, timeline, Inner Self, Retry and background-event paths.

That does **not** mean every AI Dungeon lifecycle edge case has been defeated.

Live platform behavior still needs testing, especially around:

- Retry/Undo;
- Story Card timing;
- Inner Self interaction;
- automatic card generation;
- long-running pending events;
- complex exclusive groups;
- multiple scripts modifying Context or Output.

Which is a polite way of saying:

> **Please break it before I do.**

If something behaves strangely, open an Issue with:

- what you expected;
- what actually happened;
- the relevant event definition;
- `/ep status` if possible;
- `/ep inspect = event EVENT_ID` if relevant;
- whether Retry/Undo was involved;
- whether Inner Self or another script was enabled.

---

# Quick Start

## 1. Install LEP

In AI Dungeon's scenario/adventure scripting editor, copy the four files from the `EP/` folder:

```text
EP/Library.js
EP/Input.js
EP/Context.js
EP/Output.js
```

Paste each file into its matching AI Dungeon scripting tab.

Save the scenario and enable scripts.

`Library.js` contains the editable LEP definitions plus the engine itself.

Do **not** paste `docs/events.example.js` into a hook. It is an example/reference file.

The LEP runtime uses no npm packages, browser APIs, external network calls or Node APIs.

Node is used only for the offline test suite.

---

## 2. Start a new adventure when changing EP_START

If you changed `EP_START`, use a **new adventure**.

Existing adventures keep their current state.

Editing starting values is not a magical time machine.

Unfortunately.

---

## 3. Check that LEP is alive

Use a **Do** action:

```text
/ep status
```

Yes, the project is now **LEP: Lilith Event Paradox**.

The command prefix stays `/ep` for backward compatibility.

Useful commands include:

```text
/ep help
/ep status
/ep eventsID
/ep chaptersID
/ep entities
/ep time
/ep get = choice.search
/ep vars
/ep inspect = event EVENT_ID
/ep inspect = chapter CHAPTER_ID
/ep set = {"path":"choice.search","value":"backstage"}
/ep testEvent = EVENT_ID
/ep forceEvent = EVENT_ID
/ep testChapter = CHAPTER_ID
/ep forceChapter = CHAPTER_ID
/ep advanceTime = {"months":3,"hours":6}
/ep timeSkip = 3mo;Three months pass.
```

Read-only tools such as `get`, `vars` and `inspect` are there so creators can look at the machinery without poking it with a stick first.

`testEvent` and `testChapter` preview.

`forceEvent`, `forceChapter`, `set`, `advanceTime` and `timeSkip` mutate real progress.

Use the destructive-looking ones in a disposable test adventure unless continuity errors bring you joy.

---

# Creating Your Own Events

Creators still define three core structures:

```text
EP_START
EP_CHAPTERS
EP_EVENTS
```

The `EP_` names are intentionally preserved for backward compatibility.

- **EP_START** — starting chapter and creator variables.
- **EP_CHAPTERS** — narrative phases, descriptions, visible openings and optional entry-time changes.
- **EP_EVENTS** — exact scenes, conditions, roles, queue behavior, effects, memories, transitions and timing.

For manual authoring, see:

```text
AuthorToolKit/EventParadox_Events_Creator.txt
```

Some repository filenames may retain the older `EventParadox_*` prefix during the branding transition.

That does **not** mean they belong to a different engine.

It means renaming every stable artifact purely for aesthetics seemed like an excellent way to create broken links.

---

# Event semantics at a glance

| Concept | What it means |
|---|---|
| **Normal Event** | May fire while its conditions are true. |
| **Milestone Event** | Once due, it becomes pending and cannot simply be dodged by later state changes. |
| **Silent Event** | Commits background state without inserting event prose into the player's story. |
| **Chapter End Event** | Resolves the current narrative phase and transitions to a destination chapter. |
| **Queued Event** | Latches after its trigger becomes valid and waits until it can be delivered. |
| **Exclusive Group** | At most one event in the group may ever successfully commit. |

These concepts are deliberately **orthogonal**.

`role` describes narrative/scheduler behavior.

`display` describes whether event prose is visible.

`queue` describes whether a normal event latches.

`exclusiveGroup` describes relationships between mutually exclusive events.

This is why LEP does not have one giant `type` field trying to explain the entire universe.

---

# A Tiny v0.6 Example

```js
var EP_START = {
  chapter: "school",
  variables: {
    prom: {
      ready: false
    },
    relationship: {
      partner: "maya"
    }
  }
};

var EP_CHAPTERS = {
  school: "The last weeks of school are passing quickly.",
  prom: "Prom night has arrived.",
  aftermath: "Prom is over. The consequences remain."
};

var EP_EVENTS = [
  {
    id: "prom_becomes_due",
    chapter: "school",
    minChapterTurns: 3,
    effects: [
      { path: "prom.ready", op: "set", value: true }
    ],
    text: "Posters for prom appear across the school."
  },

  {
    id: "prom_with_maya",
    role: "milestone",
    chapter: "school",
    exclusiveGroup: "prom_outcome",
    when: {
      all: [
        { path: "prom.ready", op: "eq", value: true },
        { path: "relationship.partner", op: "eq", value: "maya" }
      ]
    },
    display: "replace",
    text: "Prom night finally arrives. Maya is waiting for you.",
    nextChapter: "prom"
  }
];
```

The first event explicitly changes story state.

The milestone then becomes eligible because of explicit state.

No semantic interpretation.

No guessing.

No ritual sacrifice to the context window.

---

# Inner Self integration

v0.5 introduced an optional integrated build of **Inner Self by LewdLeah**.

Enable it in the LEP configuration with:

```text
innerSelfEnabled = true
```

Inner Self is **not required** for LEP events.

LEP works normally with it disabled.

The integrated version preserves Inner Self's character-simulation features while intentionally removing Inner Self's optional Auto-Cards installation path.

Why?

Because LEP already owns the Auto-Cards/entity layer, and two independent Auto-Cards systems attempting to manage the same adventure sounded like a fascinating experiment I did not want to conduct on users.

So the rule is:

> **LEP owns Auto-Cards. Inner Self is an optional companion.**

No separate Inner Self installation should be necessary when using the bundled integration.

---

# Auto-Cards and dynamic entities

LEP includes an adapted subset of **Auto-Cards by LewdLeah**.

And I want to say this clearly: Auto-Cards is an excellent project and I am a big fan of what LewdLeah built.

LEP uses its adapted Auto-Cards subsystem for bounded entity discovery/card handling while maintaining its own deterministic Entity Registry.

The infrastructure is always bundled.

Automatic card discovery/creation is controlled separately:

```text
autoCardsEnabled = false
```

With automatic creation disabled:

- creator-authored Character and Location Story Cards can still register as entities;
- dynamic entity conditions still work;
- LEP can still use registered Characters/Locations in authored events.

With automatic creation enabled, LEP may also discover and maintain eligible world-reference cards.

Auto-Cards discovers what exists.

**You decide what those entities mean to authored story logic.**

LEP will not decide that two characters are dating because they made eye contact twice.

---

# Narrative time

LEP already tracks deterministic authored narrative time.

Supported units:

```text
years
months
weeks
days
hours
```

Time moves only when explicitly authored through:

- event `timeAdvance`;
- destination chapter `timeAdvance`;
- `/ep advanceTime`;
- `/ep timeSkip`.

The AI writing:

> Three months later...

does not move the LEP timeline by itself.

Because apparently even fictional calendars require paperwork.

## Time Anchors

Important moments can record a `timeAnchor`.

That allows LEP to keep track of how long ago something happened.

In v0.6, **Time Anchor** and **Milestone Event** are different concepts:

- **Time Anchor** = records when something happened.
- **Milestone Event** = an event role that becomes persistent once it is due.

Please do not make me name a third thing "milestone."

## What about timed events?

Not yet.

v0.6 deliberately prepares the scheduler for future **Time Paradox** work, but it does not yet add narrative-time event gates such as:

```text
fire after 3 months
expire after 2 days
available between these dates
```

For now, milestones become due through existing deterministic conditions such as state, chapters and turn gates.

Future Time Paradox releases are intended to answer **when** events become due.

v0.6 focuses on **what LEP does once they are due**.

---

# `/ep timeSkip`

A manual canonical time skip:

```text
/ep timeSkip = 3mo,2d,6h;Three months pass. Things have changed.
```

LEP records the elapsed narrative time and inserts everything after the first semicolon as exact canonical story prose.

It does **not** automatically:

- change creator variables;
- create memories;
- create Time Anchors;
- move chapters;
- infer what happened during the skip.

You write what happened.

LEP owns the clock.

---

# "I do not want to write JavaScript."

Reasonable.

The **LEP Author Toolkit** exists for exactly that.

The intended workflow is:

1. Write the events you want in the Human Author Workbook.
2. Define simple story paths/state where needed.
3. Group finished events into chapters.
4. Choose event roles such as Normal, Milestone or Chapter End.
5. Mark queued/silent/exclusive behavior where needed.
6. Upload the Workbook to an AI together with the AI Authoring Specification — or use **LEP Builder**.
7. Say:

```text
Compile this for LEP.
```

8. Receive complete:

```text
EP_START
EP_CHAPTERS
EP_EVENTS
```

definitions.

The AI gets to deal with the brackets.

You get to make questionable narrative decisions instead.

---

# Q&A Nobody Asked For Yet

### What the hell is LEP?

A deterministic event layer for AI Dungeon.

You write important scenes and their logic in advance. AI Dungeon continues generating the ordinary story, while LEP handles authored events when their deterministic requirements are met.

Basically:

> **The AI improvises; LEP remembers that you had a plot.**

---

### Why "Lilith Event Paradox"?

Branding.

The project originally shipped as **Event Paradox**.

Starting with v0.6, the public name is:

> **LEP: Lilith Event Paradox**

The stable technical namespace is intentionally less dramatic.

`EP_START`, `EP_CHAPTERS`, `EP_EVENTS`, `/ep`, and some internal `EP_*` identifiers remain for backward compatibility.

Renaming every machine-facing identifier would make the logo prettier and existing adventures sadder.

---

### Why not just put the plot in Memory or Author's Note?

You absolutely can.

Sometimes the AI will even respect it.

LEP exists for moments where:

> "please remember this important thing eventually needs to happen"

is not deterministic enough.

If something must happen after explicit conditions, LEP can enforce the logic instead of hoping the model interprets your foreshadowing correctly.

---

### Does LEP replace the AI?

No.

That would defeat the point.

LEP controls authored structure and consequences.

The model still writes ordinary actions, dialogue, descriptions and all the unpredictable nonsense between those moments.

Think of it less as rails and more as strategically placed guardrails.

Some are probably on fire.

---

### Do I need to know JavaScript?

No — although it helps if you want full control.

You can use:

- the manual creator guide;
- the **LEP Author Toolkit**;
- the **LEP Builder** AI Skill/specification;
- plain-language creator Workbooks compiled into valid LEP definitions.

The goal is to design events instead of developing a personal relationship with curly braces.

---

### Can LEP understand player choices directly from story text?

No.

And this remains intentional.

Writing:

> I search backstage.

does not automatically set:

```text
choice.search = "backstage"
```

Important deterministic state changes are explicit.

Use authored effects or `/ep set`.

---

### What is the difference between Milestone and Queued?

A **Milestone Event** is a story/world beat the creator defines as something that must eventually resolve after becoming due.

A **Queued Event** is a normal consequence that became triggered and is now waiting for a safe opportunity to happen.

Prom can be a milestone.

A confrontation caused by something you said yesterday can be queued.

Both can become pending.

They mean different things to the author.

---

### What is a Silent Event for?

Things happening elsewhere.

An NPC moves away.

Someone starts a new relationship.

A letter gets sent.

A faction makes a decision.

The player's action may have caused it, but the player is not automatically granted omniscient knowledge.

Silent Events primarily change explicit LEP state.

Later visible events can reveal that state naturally.

---

### Can events branch?

Yes.

v0.6 supports branching through:

- chapters;
- turn gates;
- explicit variables;
- nested `all` / `any` / `not` conditions;
- priorities;
- dynamic Character/Location checks;
- Chapter End Events;
- Exclusive Event Groups;
- pending Milestone/Queued outcomes;
- normal `nextChapter` transitions.

You can also create an impossible dependency chain and stare at `/ep inspect` for twenty minutes.

I believe in you.

---

### Is LEP stable?

Define "stable."

The core has extensive offline tests.

This is still a **public beta**, and some AI Dungeon host lifecycle behavior can only really be proven by people running it in actual adventures.

So:

- back up scenarios you care about;
- test complicated logic in disposable adventures;
- report weird behavior;
- do not assume I have achieved enlightenment and eliminated bugs.

---

### Will it use more AI credits/tokens?

Normal AI Dungeon generation still happens.

Console commands are handled deterministically by the script, but the host may still perform a generation before Output runs, so LEP cannot promise control actions are free from host generation latency/cost.

Optional Auto-Cards and Inner Self may use additional Context/output room during ordinary generations.

LEP does not secretly call an external model API.

---

### Can I use it with other scripts?

Possibly.

LEP already includes optional Inner Self integration because manually combining multiple large hook-based scripts is not my preferred form of entertainment.

Other scripts that manipulate Input, Context, history, state or final Output ordering may still require integration work.

AI Dungeon Optimized Context compatibility is **not part of v0.6**.

That is separate roadmap work.

---

### Can I build something better on top of this?

Please do.

LEP is released under the **MIT License**.

Fork it. Modify it. Rebuild it. Turn it into something much better and make me mildly jealous.

If your project is based substantially on LEP, a visible mention/link back to the original project would be very appreciated.

The MIT license notice itself must still be preserved where required.

---

### Is this an official AI Dungeon / Latitude project?

No.

LEP is an independent community project built for AI Dungeon's scripting system.

If I somehow break your fictional prom, Latitude did not personally do that.

That one is on me.

---

### Who made this?

**Alex / Lilith6666666**

I started the project because I wanted AI Dungeon scenarios where the model could improvise freely without also being solely responsible for remembering every important plot beat.

Then feature creep happened.

Now there are event roles, background consequences, pending queues, exclusive outcomes, Inner Self, Auto-Cards, entities, authored memory, a console, narrative time, Time Anchors and transactional Retry handling.

This is how software happens, apparently.

---

# Configuration

LEP creates/uses a configuration Story Card.

The visible v0.6 title may be branded as:

```text
LEP: Lilith Event Paradox — Configuration
```

For backward compatibility, legacy machine triggers/type identifiers may still retain the older Event Paradox wording.

Do not "clean them up" unless the engine version you are using explicitly says it is safe.

Default Entry:

```text
enabled = true
memoryMode = compact
memoryBudget = 120
autoCharacterCards = false
journalEnabled = false
autoCardsEnabled = false
innerSelfEnabled = false
debug = false
```

Important distinctions:

- **Entity Registry / adapted Auto-Cards infrastructure** is bundled and available.
- `autoCardsEnabled` controls automatic card discovery/creation/update behavior.
- creator Character/Location Story Cards can still register with `autoCardsEnabled = false`.
- `innerSelfEnabled` controls the optional bundled Inner Self integration.
- Inner Self is not required for LEP events.

---

# Bundled Example — The Missing Stage Key

The repository includes **The Missing Stage Key**, a deliberately small showcase/test scenario.

Its plot is technologically sophisticated:

A key goes missing.

That is basically it.

The interesting part is what happens underneath:

- chapters;
- explicit variables;
- deterministic event eligibility;
- branching search routes;
- creator-authored memories;
- dynamic Character/Location entities;
- visible chapter transitions;
- narrative time;
- Time Anchors;
- debugging commands;
- final free roam.

It exists primarily to demonstrate and regression-test the engine without requiring a forty-page lore bible first.

Which is a very dignified way of saying Maya keeps losing a key so I can test software.

---

# Documentation

This repository separates the approachable material from the document that knows far too much.

## Start here

- `README.md` — you are here. Congratulations.
- `AuthorToolKit/EventParadox_Events_Creator.txt` — practical manual creator guide.

## Deep technical reference

- `docs/EventParadox_Technical_Reference.txt`

The v0.6 technical reference should be treated as the exact source for schema limits, scheduler semantics, pending-state behavior, validation, Retry handling, timeline details and integration rules.

## LEP Author Toolkit

The repository may retain legacy `EventParadox_*` filenames for compatibility during the branding transition.

Look in `AuthorToolKit/` for:

- `EventParadox_AI_Authoring_Spec.txt`
- `EventParadox_Author_Workbook.txt`
- `EventParadox_Author_Toolkit_Examples.txt`
- `EventParadox_Skill_Builder_Guide.txt`
- `EP_Builder_Skill.zip`

Public-facing documentation may refer to these collectively as the **LEP Author Toolkit** and **LEP Builder**.

The AI Authoring Specification remains the source of truth for AI-assisted compilation.

---

# Testing

From the repository root:

```bash
node tests/run-tests.js
```

You can also syntax-check the runtime files with Node:

```bash
node --check EP/Library.js
node --check EP/Input.js
node --check EP/Context.js
node --check EP/Output.js
node --check docs/events.example.js
node --check tests/run-tests.js
```

The test suite is dependency-free.

v0.6 testing should cover both legacy and new behavior, including:

- v0.5-compatible normal events;
- Milestone arming/delivery;
- Silent Event isolation;
- Chapter End branching;
- Queued Events;
- Exclusive Event Groups;
- visible + silent same-cycle transactions;
- Retry safety;
- Inner Self enabled/disabled;
- Auto-Cards ownership;
- configuration migration;
- creator/debugging commands.

Offline mocks are not a substitute for live AI Dungeon testing.

Hence the beta.

Hence you.

---

# Bugs, Weirdness & Contributions

Found a bug?

Excellent.

Open an Issue and include enough information that someone other than your past self could reproduce it.

Useful details:

- LEP version;
- relevant event/chapter definitions;
- what you expected;
- what happened instead;
- `/ep status`;
- `/ep inspect = event EVENT_ID` when relevant;
- whether the event was Normal, Milestone, Silent, Chapter End or Queued;
- whether `exclusiveGroup` was involved;
- whether Retry/Undo was involved;
- whether Auto-Cards was enabled;
- whether Inner Self was enabled;
- whether another script was installed.

Pull requests, experiments, forks and cursed improvements are welcome.

If you are unsure whether something is a bug or your event logic is wrong, open the issue anyway.

Worst case, we both learn something.

---

# Credits

LEP: Lilith Event Paradox is created and maintained by:

**Alex / Lilith6666666**

## Auto-Cards

LEP includes an adapted subset of:

**Auto-Cards by LewdLeah**

I am genuinely a big fan of the project and the work behind it.

LEP uses a focused adaptation for entity discovery/card handling and keeps the required attribution/license notices.

## Inner Self

LEP also includes an optional modified integration of:

**Inner Self by LewdLeah**

The LEP-compatible build intentionally removes Inner Self's optional Auto-Cards installation path so LEP remains the single Auto-Cards/entity provider.

The rest of Inner Self's normal feature/settings behavior is intended to remain preserved.

See:

```text
THIRD_PARTY_NOTICES.txt
```

for pinned upstream revisions, adaptation notes and license attribution.

---

# License

LEP: Lilith Event Paradox is released under the **MIT License**.

Use it.

Modify it.

Fork it.

Build something better.

If you make something cool with it, a visible credit/link back to LEP is appreciated.

Not because I'm going to send a lawyer after you.

Mostly because I'd like to see what you made.

---

# Branding & compatibility note

Starting with v0.6, the public project name is:

> **LEP: Lilith Event Paradox**

The older **Event Paradox** name remains visible in some legacy filenames, state keys and machine-facing identifiers for compatibility.

That is intentional.

In particular, do not assume these are obsolete:

```text
EP_START
EP_CHAPTERS
EP_EVENTS
/ep
```

A rebrand should make the project prettier.

It should not make existing scenarios stop working.

---

# Final note

LEP is still built around one simple idea:

> **Creators decide which story beats matter. The AI is free to improvise between them.**

v0.6 just gives those beats more vocabulary.

Some are ordinary.

Some become unavoidable.

Some wait.

Some happen off-screen.

Some end chapters.

Some exclude each other permanently.

And somewhere in all of that, the AI is still perfectly free to decide that a side character needs a suspiciously detailed sandwich.

Enjoy.
