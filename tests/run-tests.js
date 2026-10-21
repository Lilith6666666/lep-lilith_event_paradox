"use strict";
// Offline contract mock, NOT a claim about live AI Dungeon history/Undo behavior.
// Every hook gets a NEW VM and JSON-round-tripped state/cards/history.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const library = fs.readFileSync(path.join(root, "LEP/Library.js"), "utf8");
const hooks = Object.fromEntries(["Input", "Context", "Output"].map(name => [name, fs.readFileSync(path.join(root, "LEP", name + ".js"), "utf8")]));
const clone = value => JSON.parse(JSON.stringify(value));
const STATUS_KEY = "__LEP_AUTOCARDS_STATUS_V1__";
const worldCards = cards => cards.filter(card => card.keys !== STATUS_KEY);
const CONFIG = "__LEP_CONFIG_V1__";
const CONFIG_TYPE = "LEP — Configuration";
const CHAR_TYPE = "LEP Character v1";
const JOURNAL = "__LEP_JOURNAL_V1__";
const blockPattern = /\/\/ BEGIN EVENT DEFINITIONS[\s\S]*?\/\/ END EVENT DEFINITIONS/;
const fixtureSource = fs.readFileSync(path.join(__dirname, "fixtures/missing-stage-key.js"), "utf8");
const fixture = clone(new vm.Script(fixtureSource + "\n({start:LEP_START,chapters:LEP_CHAPTERS,events:LEP_EVENTS})").runInNewContext({}, { timeout: 500 }));
const fixtureEvent = id => fixture.events.find(item => item.id === id);
const fixtureAdventure = options => new Adventure([], { example: true, ...options });
const setCommand = (path, value) => "/lep set = " + JSON.stringify({ path, value });
const baseStart = { chapter: "start", variables: { score: 0, flags: { ready: false }, tags: [] } };
const baseChapters = { start: "At the start.", next: "A new chapter.", finish: "The ending." };
function source(events, start = baseStart, chapters = baseChapters) {
  return library.replace(blockPattern, () => "var LEP_START = " + JSON.stringify(start) + ";\nvar LEP_CHAPTERS = " + JSON.stringify(chapters) + ";\nvar LEP_EVENTS = " + JSON.stringify(events) + ";");
}
function event(id, extra = {}) { return { id, text: "Authored " + id + ".", ...extra }; }
// These two fields record delivery, not story progress. Previews may only
// change them; all other persistent LEP fields must remain byte-for-byte equal.
function progress(ep) {
  const value = clone(ep);
  delete value.checkpoints;
  delete value.lastCommandRevision;
  return value;
}
function storyState(adventure) {
  const value = clone(adventure.state);
  delete value.lepConsole;
  return value;
}
class Adventure {
  constructor(events = [], options = {}) {
    this.source = options.example ? library : source(events, options.start, options.chapters);
    this.state = clone(options.state || { memory: { context: "USER MEMORY", authorsNote: "USER NOTE" }, otherScript: { keep: true } });
    this.cards = clone(options.cards || []);
    this.history = [{ type: "start", text: "The school courtyard waits." }];
    this.options = options;
    this.nextId = 100;
    this.calls = { add: 0, update: 0, duplicate: 0 };
    this.statusCalls = { add: 0, update: 0 };
    this.logs = [];
    this.savedSlots = [];
  }
  hook(name, text, overrides = {}) {
    const stagedCards = [];
    const sandbox = {
      text, state: clone(this.state), storyCards: clone(this.cards), history: clone(this.history),
      info: { actionCount: this.history.length, maxChars: 10000, memoryLength: 4, ...overrides },
      log: message => this.logs.push(String(message))
    };
    sandbox.addStoryCard = (keys, entry, type) => {
      if (keys === STATUS_KEY) this.statusCalls.add++; else this.calls.add++;
      if (this.options.failAdd) throw new Error("Card writes unavailable");
      if (sandbox.storyCards.concat(stagedCards).some(card => card.keys === keys)) { this.calls.duplicate++; return false; }
      const card = { id: this.nextId++, keys, entry, type };
      const index = sandbox.storyCards.length;
      if (this.options.delayCards) stagedCards.push(card);
      else sandbox.storyCards.push(card);
      if (this.options.returnType === "false") return false;
      if (this.options.returnType === "string") return String(index);
      if (this.options.returnType === "object") return { index };
      if (this.options.returnType === "undefined") return undefined;
      return index;
    };
    sandbox.updateStoryCard = (index, keys, entry, type) => {
      if (keys === STATUS_KEY) this.statusCalls.update++; else this.calls.update++;
      if (this.options.failUpdate) throw new Error("Update failed");
      if (this.options.noUpdateWrite || this.options.noWorldUpdateWrite && keys !== STATUS_KEY) return false;
      if (!Number.isInteger(index) || !sandbox.storyCards[index]) throw new Error("Invalid index");
      Object.assign(sandbox.storyCards[index], { keys, entry, type });
    };
    if (this.options.noAPIs) { delete sandbox.addStoryCard; delete sandbox.updateStoryCard; }
    if (this.options.noStoryCards) delete sandbox.storyCards;
    if (this.options.noHistory) delete sandbox.history;
    if (overrides.noInfo) delete sandbox.info;
    const result = new vm.Script(this.source + "\n" + hooks[name], { filename: name + ".js" }).runInNewContext(sandbox, { timeout: 500 });
    assert.equal(typeof result.text, "string", "hook must return a text string");
    assert.ok(result.text.length, "hook must not return an empty string");
    assert.deepEqual(Object.keys(result), ["text"], "no stop or undocumented return values");
    this.state = clone(sandbox.state);
    if (sandbox.storyCards) this.cards = clone(sandbox.storyCards.concat(stagedCards));
    return result.text;
  }
  configure(settings) {
    if (!this.cards.some(card => card.keys === CONFIG)) this.hook("Input", "hello");
    const card = this.cards.find(card => card.keys === CONFIG);
    assert.ok(card, "test requires a writable config card");
    card.entry = typeof settings === "string" ? settings : Object.entries(settings).map(([key, value]) => key + " = " + (typeof value === "object" ? JSON.stringify(value) : String(value))).join("\n");
  }
  turn(input = "I look around.", output = "The ordinary scene continues.", overrides = {}) {
    const modified = this.hook("Input", input, overrides);
    this.history.push({ type: overrides.actionType || "story", text: this.options.rawInputHistory ? input : modified });
    const context = this.hook("Context", "MEM\n" + this.history.map(action => action.text).join("\n"), overrides);
    const slot = { history: clone(this.history), before: clone(this.state) };
    const visible = this.hook("Output", typeof output === "function" ? output(this.state, context) : output, overrides);
    this.history.push({ type: "continue", text: visible });
    slot.after = clone(this.state);
    this.savedSlots.push(slot);
    return { visible, context, modified };
  }
  control(command, overrides = {}) {
    return this.turn(command, "UNRELATED MODEL PROSE FOR CONTROL", { actionType: "do", ...overrides });
  }
  retry(output = "A different model response.", rollback = false) {
    const slot = this.savedSlots[this.savedSlots.length - 1];
    this.history = clone(slot.history);
    if (rollback) this.state = clone(slot.before);
    const visible = this.hook("Output", output);
    this.history.push({ type: "continue", text: visible });
    return visible;
  }
  get ep() { return this.state.lep; }
}
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("fresh install: defaults enabled, single config, missing Notes/title supported", () => {
  const a = new Adventure();
  a.hook("Input", "hello");
  a.hook("Context", "MEM\nhello");
  a.hook("Output", "Hello.");
  assert.equal(a.cards.length, 1);
  assert.equal(a.calls.add, 1);
  assert.equal(a.cards[0].keys, CONFIG);
  assert.equal(a.cards[0].type, CONFIG_TYPE);
  assert.ok(a.cards[0].entry.includes("enabled = true"));
  assert.equal(a.ep.enabledTurns, 1);
  assert.equal(a.cards[0].title, undefined);
});
test("creation return index 0, false, string, object, undefined and delayed snapshots", () => {
  for (const returnType of ["index", "false", "string", "object", "undefined"]) {
    for (const delayCards of [false, true]) {
      const a = new Adventure([], { returnType, delayCards });
      for (let i = 0; i < 3; i++) a.turn();
      assert.equal(a.cards.length, 1);
      assert.equal(a.calls.add, 1);
    }
  }
});
test("pause is a byte-for-byte state freeze; re-enable resumes without disabled turns", () => {
  const a = new Adventure([event("later", { minTurns: 2 })]);
  a.turn();
  a.configure({ enabled: false, memoryMode: "full", autoCharacterCards: true, journalEnabled: true,
    manualSet: { revision: 1, path: "score", value: 30 } });
  const snapshot = JSON.stringify(a.state), calls = clone(a.calls), cards = clone(a.cards);
  for (let i = 0; i < 3; i++) {
    const result = a.turn();
    assert.ok(!result.context.includes("[LEP memory]"));
    assert.equal(result.visible, "The ordinary scene continues.");
  }
  assert.equal(JSON.stringify(a.state), snapshot);
  assert.deepEqual(a.calls, calls);
  assert.deepEqual(worldCards(a.cards), worldCards(cards));
  a.configure({ enabled: true });
  assert.ok(a.turn().visible.includes("Authored later."));
  assert.equal(a.ep.enabledTurns, 2);
  assert.equal(a.ep.variables.score, 0);
});
test("disabled on first hook does not initialize LEP state", () => {
  const a = new Adventure([], { cards: [{ id: 9, keys: CONFIG, entry: "enabled=false", type: CONFIG_TYPE }] });
  const before = clone(a.state);
  a.turn();
  assert.deepEqual(a.state, before);
  assert.equal(a.calls.add, 0);
});
test("config edit between Input, Context, Output is reread immediately", () => {
  const a = new Adventure([event("never")]);
  a.hook("Input", "go");
  a.configure({ enabled: false });
  assert.equal(a.hook("Context", "MEM\nplayer"), "MEM\nplayer");
  assert.equal(a.hook("Output", "ordinary"), "ordinary");
  assert.equal(a.ep.enabledTurns, 0);
});
test("no eligible event leaves whitespace and model prose untouched", () => {
  const a = new Adventure([event("no", { when: { path: "flags.ready", op: "eq", value: true } })]);
  const prose = "\n  He says, ‘Maybe.’\n\nNothing else.  ";
  assert.equal(a.turn("look", prose).visible, prose);
  assert.deepEqual(a.ep.completedEvents, []);
});
test("highest priority, stable definition order, exactly one event, completion permanence", () => {
  const a = new Adventure([event("low", { priority: -1 }), event("tie_first", { priority: 7 }), event("tie_second", { priority: 7 })]);
  assert.equal(a.turn().visible, "The ordinary scene continues.\n\nAuthored tie_first.");
  assert.ok(a.turn().visible.endsWith("Authored tie_second."));
  assert.ok(a.turn().visible.endsWith("Authored low."));
  assert.equal(a.turn().visible, "The ordinary scene continues.");
  assert.deepEqual(a.ep.completedEvents, ["tie_first", "tie_second", "low"]);
});
test("nested all/any/not combine; empty and omitted groups impose no restriction", () => {
  const gates = { all: [{ any: [{ path: "score", op: "eq", value: 0 }, { path: "flags.ready", op: "eq", value: true }] }],
    any: [], not: [{ all: [{ path: "flags.ready", op: "eq", value: true }] }] };
  const a = new Adventure([event("nested", { when: gates }), event("empty", { when: { all: [], any: [], not: [] } }), event("object", { when: {} })]);
  for (const id of ["nested", "empty", "object"]) assert.ok(a.turn().visible.endsWith("Authored " + id + "."));
  const b = new Adventure([event("blocked", { when: { all: [], any: [{ path: "score", op: "eq", value: 1 }], not: [] } })]);
  assert.equal(b.turn().visible, "The ordinary scene continues.");
});
test("strict comparisons, missing paths, null, exists and array includes", () => {
  const cases = [
    ["score", "eq", "0", false], ["score", "eq", 0, true], ["score", "ne", 1, true],
    ["score", "gt", 0, false], ["score", "gte", 0, true], ["score", "lt", 1, true], ["score", "lte", -1, false],
    ["missing", "ne", false, false], ["missing", "eq", null, false], ["missing", "exists", false, true],
    ["nullable", "exists", true, true], ["nullable", "eq", null, true], ["stringNumber", "gte", 0, false],
    ["tags", "includes", "key", true], ["tags", "includes", 1, false]
  ];
  for (const [path, op, value, expected] of cases) {
    const a = new Adventure([event("check", { when: { path, op, value } })], { start: { chapter: "start", variables: { score: 0, nullable: null, stringNumber: "2", tags: ["key", "1"] } } });
    a.turn();
    assert.equal(a.ep.completedEvents.length === 1, expected, JSON.stringify([path, op, value]));
  }
});
test("chapter transition resets to zero; next event waits for a later output", () => {
  const a = new Adventure([
    event("first", { chapter: "start", nextChapter: "next" }),
    event("second", { chapter: "next", minChapterTurns: 2, priority: 999, nextChapter: "finish" })
  ]);
  a.turn();
  assert.equal(a.ep.chapter, "next");
  assert.equal(a.ep.chapterTurns, 0);
  assert.equal(a.turn().visible, "The ordinary scene continues.");
  assert.equal(a.ep.chapterTurns, 1);
  assert.ok(a.turn().visible.endsWith("Authored second."));
  assert.equal(a.ep.chapterTurns, 0);
  assert.equal(a.ep.enabledTurns, 3);
});
test("same nextChapter does not reset elapsed chapter turns", () => {
  const a = new Adventure([event("same", { nextChapter: "start" })]);
  a.turn();
  assert.equal(a.ep.chapterTurns, 1);
});
test("repeat cooldown counts enabled outputs; unsafe repeats are skipped", () => {
  const a = new Adventure([event("unsafe", { once: false, priority: 10 }), event("repeat", { once: false, cooldownTurns: 3 })]);
  const seen = [];
  for (let i = 0; i < 7; i++) if (a.turn().visible.includes("Authored")) seen.push(i + 1);
  assert.deepEqual(seen, [1, 4, 7]);
  assert.deepEqual(a.ep.completedEvents, []);
  assert.equal(a.ep.eventLog.length, 3);
});
test("append and replace preserve exact punctuation, multiline whitespace and literal placeholders", () => {
  const prose = "  Three weeks pass...\n\nJulia: \"Can we talk?\"\n\t‘Yes’ — ${player.name} {{score}}  ";
  for (const display of ["append", "replace"]) {
    const a = new Adventure([event("exact", { text: prose, display })]);
    assert.equal(a.turn("wait", "MODEL\n").visible, display === "replace" ? prose : "MODEL\n\n\n" + prose);
  }
});
test("opt-in substitutions are pre-effect plain text, safe, bounded and leave missing values", () => {
  const text = "{{name}}|{{score}}|{{missing}}|{{constructor.x}}|${player}|{{nil}}";
  const a = new Adventure([event("interpolation", { text, interpolate: true, display: "replace", effects: [{ path: "score", op: "add", value: 1 }] })],
    { start: { chapter: "start", variables: { name: "$&\n${globalThis.attack()} `ok`", score: 2, nil: null } } });
  assert.equal(a.turn().visible, "$& ${globalThis.attack()} `ok`|2|{{missing}}|{{constructor.x}}|${player}|{{nil}}");
  assert.equal(a.ep.variables.score, 3);
});
test("effects set nested values, add and subtract; partial effect failures are atomic", () => {
  const a = new Adventure([
    event("bad", { priority: 20, effects: [{ path: "score", op: "set", value: 99 }, { path: "missing", op: "add", value: 1 }] }),
    event("good", { effects: [{ path: "score", op: "add", value: 5 }, { path: "score", op: "subtract", value: 2 }, { path: "new.deep", op: "set", value: ["a", true] }] })
  ]);
  assert.ok(a.turn().visible.endsWith("Authored good."));
  assert.equal(a.ep.variables.score, 3);
  assert.deepEqual(a.ep.variables.new.deep, ["a", true]);
});
test("manualSet arbitrary safe variable, new revisions only, no narrative command pollution", () => {
  const a = new Adventure([event("manual", { when: { path: "quest.hasMap", op: "eq", value: true }, effects: [{ path: "quest.hasMap", op: "set", value: false }] })]);
  a.configure({ manualSet: { revision: 1, path: "quest.hasMap", value: true } });
  assert.ok(a.turn().visible.endsWith("Authored manual."));
  assert.equal(a.ep.variables.quest.hasMap, false);
  a.turn();
  assert.equal(a.ep.variables.quest.hasMap, false);
  a.configure({ manualSet: { revision: 2, path: "quest.hasMap", value: true } });
  a.turn();
  assert.equal(a.ep.variables.quest.hasMap, true);
  assert.equal(a.ep.lastManualRevision, 2);
});
test("no semantic inference: refusal, negation, AI markers and player commands remain ordinary text", () => {
  const a = new Adventure([event("dating", { when: { path: "relationship.status", op: "eq", value: "dating" } })]);
  const examples = ["She would never be your girlfriend.", "Maya refuses to date you.", '[[LEP_SET:relationship.status="dating"]]', "We are dating now."];
  a.configure("semanticTracking = true\ndebug = true");
  for (const prose of examples) assert.equal(a.turn(prose, prose).visible, prose);
  assert.equal(a.ep.variables.relationship, undefined);
  assert.ok(a.logs.some(line => line.includes("semanticTracking")));
});
test("configuration parsing: case, whitespace, JSON comments, unknown keys, invalid fallback, clamping", () => {
  const a = new Adventure();
  const raw = '# heading\n EnAbLeD = TRUE # comment\n memoryMode = FuLl\nmemoryBudget = 9999\nautoCharacterCards=TRUE\njournalEnabled=TRUE\ndebug=TRUE\nunknown=1\nmanualSet={"revision":1,"path":"note","value":"x#y=z"} # comment';
  a.configure(raw);
  a.turn();
  assert.equal(a.ep.variables.note, "x#y=z");
  assert.equal(a.cards.find(card => card.keys === CONFIG).entry, raw);
  assert.ok(a.logs.some(line => line.includes("Unknown configuration")));
  assert.ok(a.cards.some(card => card.keys === JOURNAL));
  a.configure("enabled=potato\nmemoryMode=bad\nmemoryBudget=bad\nautoCharacterCards=no\ndebug=true");
  a.turn();
  assert.equal(a.ep.enabledTurns, 2);
  assert.ok(a.logs.some(line => line.includes("Invalid boolean")));
  a.configure({ memoryBudget: -1 });
  assert.equal(a.hook("Context", "MEM\nhello", { actionCount: 100 }), "MEM\nhello");
});
test("duplicate config keys: last wins; invalid last falls back to default", () => {
  const a = new Adventure();
  a.configure("enabled=false\nenabled=true\ndebug=true");
  a.turn();
  assert.equal(a.ep.enabledTurns, 1);
  assert.ok(a.logs.some(line => line.includes("Duplicate setting")));
});
test("invalid and duplicate events cannot block a valid later definition", () => {
  const bad = [null, event("dupe"), event("dupe"), event("white", { text: " " }),
    event("unknownChapter", { chapter: "missing" }), event("target", { nextChapter: "missing" }),
    event("priority", { priority: "high" }), event("cond", { when: { all: "oops" } }),
    event("typo", { minChapterTurn: 3 }), event("badId", { id: "constructor" }),
    event("type", { when: { path: "score", op: "gte", value: "0" } }),
    event("effect", { effects: [{ path: "score", op: "multiply", value: 2 }] }),
    event("gate", { chapter: [] }), event("memory", { memory: { summary: "" } }),
    event("good")];
  const a = new Adventure(bad);
  a.configure({ debug: true });
  assert.ok(a.turn().visible.endsWith("Authored good."));
  assert.deepEqual(a.ep.completedEvents, ["good"]);
  assert.ok(a.logs.filter(line => line.includes("Skipping definition")).length >= 14);
});
test("unsafe paths and prototype keys in effects/config are rejected", () => {
  for (const unsafe of ["__proto__.polluted", "constructor.prototype.polluted", "flags.prototype.x", "score.0"]) {
    const a = new Adventure([event("unsafe", { effects: [{ path: unsafe, op: "set", value: true }] }), event("fine")]);
    a.configure({ manualSet: { revision: 1, path: unsafe, value: true } });
    assert.ok(a.turn().visible.endsWith("Authored fine."));
    assert.deepEqual(a.ep.variables, baseStart.variables);
  }
  const a = new Adventure();
  a.configure('manualSet={"revision":1,"path":"safe","value":{"__proto__":{"polluted":true}}}');
  a.turn();
  assert.equal(a.ep.variables.safe, undefined);
  assert.equal({}.polluted, undefined);
});
test("deep conditions and oversized variable writes are bounded and skipped", () => {
  let when = { path: "score", op: "eq", value: 0 };
  for (let i = 0; i < 10; i++) when = { all: [when] };
  const large = Object.fromEntries(Array.from({ length: 8 }, (_, i) => ["key" + i, "x".repeat(2000)]));
  const a = new Adventure([event("deep", { when }), event("large", { effects: [{ path: "large", op: "set", value: large }] }), event("fine")]);
  assert.ok(a.turn().visible.endsWith("Authored fine."));
  assert.equal(a.ep.variables.large, undefined);
});
test("deep manual/effect paths cannot commit a tree that becomes invalid on the next hook", () => {
  const deepPath = "a.b.c.d.e.f.g.h";
  const a = new Adventure([event("tooDeep", { effects: [{ path: deepPath, op: "set", value: { nested: { value: true } } }] }), event("fine")]);
  a.configure({ debug: true, manualSet: { revision: 1, path: deepPath, value: { nested: true } } });
  assert.ok(a.turn().visible.endsWith("Authored fine."));
  assert.equal(a.ep.variables.a, undefined);
  a.turn();
  assert.equal(a.ep.enabledTurns, 2);
  assert.ok(a.logs.some(line => line.includes("depth or key limits")));
});
test("compact memory: no character cards, bounded addendum, UI memory and latest action preserved", () => {
  const a = new Adventure([event("memory", { memory: { summary: "Maya accepted the invitation.", character: "Maya" } })]);
  a.turn();
  const original = "MEM\nMaya approaches.\nLATEST PLAYER ACTION";
  const context = a.hook("Context", original, { actionCount: 10 });
  assert.ok(context.startsWith("MEM\n"));
  assert.ok(context.endsWith("LATEST PLAYER ACTION"));
  assert.ok(context.includes("Maya accepted the invitation."));
  assert.ok(context.length - original.length <= 120 * 3);
  assert.equal(context.replace(/\n\[LEP memory\][\s\S]*?\[\/LEP memory\]\n/, ""), original);
  assert.equal(a.cards.length, 1);
  assert.deepEqual(a.state.memory, { context: "USER MEMORY", authorsNote: "USER NOTE" });
});
test("no safe context space or metadata: omit LEP instead of truncating any host text", () => {
  const a = new Adventure();
  a.hook("Input", "go");
  const text = "MEM\nLATEST";
  for (const overrides of [{ maxChars: text.length }, { maxChars: text.length + 10 }, { maxChars: undefined },
    { memoryLength: undefined }, { memoryLength: 100 }, { memoryLength: -1 }, { noInfo: true }]) {
    assert.equal(a.hook("Context", text, overrides), text);
  }
  a.configure({ memoryBudget: 0 });
  assert.equal(a.hook("Context", text), text);
});
test("context additions are idempotent and do not include event prose", () => {
  const a = new Adventure([event("secret", { text: "UNSEEN AUTHOR PROSE" })]);
  const result = a.hook("Context", "MEM\nready");
  assert.ok(!result.includes("UNSEEN AUTHOR PROSE"));
  assert.equal(a.hook("Context", result), result);
});
test("chapter memories expire; story slots replace old consequences", () => {
  const a = new Adventure([
    event("old", { memory: { slot: "status", scope: "story", summary: "They are friends." } }),
    event("temp", { memory: { summary: "The old classroom is cold." } }),
    event("new", { nextChapter: "next", memory: { slot: "status", scope: "story", summary: "They are dating." } })
  ]);
  a.turn(); a.turn(); a.turn();
  assert.equal(a.ep.memories.length, 1);
  const result = a.hook("Context", "MEM\nready", { actionCount: 30 });
  assert.ok(result.includes("They are dating."));
  assert.ok(!result.includes("friends") && !result.includes("cold"));
});
test("character mode relevance and same-character card updates use separate owned sentinel cards", () => {
  const ownCard = { id: 7, keys: "Maya", entry: "Creator's character card.", type: "character" };
  const a = new Adventure([
    event("maya1", { memory: { summary: "Maya kept the ticket.", character: "Maya" } }),
    event("maya2", { nextChapter: "next", memory: { summary: "Maya returned the ticket.", character: "Maya" } }),
    event("move", { nextChapter: "finish" })
  ], { cards: [ownCard] });
  a.configure({ memoryMode: "character", autoCharacterCards: true });
  a.turn();
  const firstId = a.cards.find(card => card.type === CHAR_TYPE).id;
  a.cards.reverse(); // Array indices are not permanent IDs.
  a.turn(); a.turn();
  const card = a.cards.find(card => card.type === CHAR_TYPE);
  assert.equal(card.id, firstId);
  assert.ok(card.entry.includes("returned") && !card.entry.includes("kept"));
  assert.ok(!card.keys.split(",").includes("Maya"));
  assert.deepEqual(a.cards.find(card => card.id === 7), ownCard);
  a.history = [{ type: "story", text: "A deserted field." }];
  assert.ok(!a.hook("Context", "MEM\nMayapple trees.", { actionCount: 30 }).includes("returned the ticket"));
  assert.ok(a.hook("Context", "MEM\nMaya arrives.", { actionCount: 30 }).includes("returned the ticket"));
});
test("character/full mode cards and journal both require explicit opt-in", () => {
  for (const mode of ["compact", "character", "full"]) {
    const a = new Adventure([event("m", { memory: { summary: "A factual event.", character: "Maya" } })]);
    a.configure({ memoryMode: mode });
    a.turn();
    assert.equal(a.cards.length, 1);
  }
});
test("full journal is bounded, sentinel-only and absent from ordinary Context", () => {
  const a = new Adventure([event("loop", { once: false, cooldownTurns: 2, memory: { summary: "LEDGER UNIQUE FACT " + "x".repeat(500) } })]);
  a.configure({ memoryMode: "full", journalEnabled: true, memoryBudget: 0 });
  for (let i = 0; i < 70; i++) a.turn();
  const journal = a.cards.find(card => card.keys === JOURNAL);
  assert.ok(journal && journal.entry.length <= 8000);
  assert.equal(a.cards.filter(card => card.keys === JOURNAL).length, 1);
  assert.equal(a.ep.eventLog.length, 32);
  assert.equal(a.ep.checkpoints.length, 6);
  assert.ok(!a.hook("Context", "MEM\nplain", { actionCount: 200 }).includes("LEDGER"));
  assert.ok(JSON.stringify(a.state).length < 250000, "bounded serialized state for repeated events");
});
test("character count stays bounded across many unique characters", () => {
  const events = Array.from({ length: 20 }, (_, i) => event("char" + i, { memory: { summary: "A fact for person " + i, character: "Person " + i } }));
  const a = new Adventure(events);
  a.configure({ memoryMode: "character", autoCharacterCards: true });
  for (let i = 0; i < 20; i++) a.turn();
  assert.equal(a.ep.characters.length, 16);
  assert.equal(a.cards.filter(card => card.type === CHAR_TYPE).length, 16);
  assert.equal(a.ep.memories.length, 8);
});
test("disabled with existing mirrors stops writes and context without deleting cards", () => {
  const a = new Adventure([event("m", { memory: { summary: "Maya knows the plan.", character: "Maya" } })]);
  a.configure({ memoryMode: "full", journalEnabled: true, autoCharacterCards: true });
  a.turn();
  a.configure({ enabled: false });
  const cards = clone(a.cards), state = clone(a.state), calls = clone(a.calls);
  const result = a.turn("Maya waits.");
  assert.deepEqual(worldCards(a.cards), worldCards(cards));
  assert.deepEqual(a.state, state);
  assert.deepEqual(a.calls, calls);
  assert.ok(!result.context.includes("[LEP memory]"));
});
test("failed/missing card APIs do not prevent authored prose or state persistence", () => {
  for (const options of [{ failAdd: true }, { noAPIs: true }, { noAPIs: true, noStoryCards: true }]) {
    const a = new Adventure([event("works")], options);
    assert.ok(a.turn().visible.endsWith("Authored works."));
    assert.deepEqual(a.ep.completedEvents, ["works"]);
    assert.equal(a.turn().visible, "The ordinary scene continues.");
  }
});
test("update failures and unusual Unicode character names cannot suppress committed event output", () => {
  const a = new Adventure([
    event("one", { memory: { summary: "First fact.", character: "Maya" } }),
    event("two", { memory: { summary: "Second fact.", character: "Maya" } }),
    event("three", { memory: { summary: "Third fact.", character: "\ud800" } })
  ]);
  a.configure({ memoryMode: "full", autoCharacterCards: true, journalEnabled: true });
  a.turn();
  a.options.failUpdate = true;
  assert.ok(a.turn().visible.endsWith("Authored two."));
  assert.ok(a.turn().visible.endsWith("Authored three."));
  assert.deepEqual(a.ep.completedEvents, ["one", "two", "three"]);
});
test("third-party state/cards survive; sentinel collisions are not overwritten", () => {
  const outsider = { id: 3, keys: "__LEP_CHARACTER_V1__Maya", entry: "Unrelated text", type: "Inner Self" };
  const a = new Adventure([event("m", { memory: { summary: "A new fact.", character: "Maya" } })], { cards: [outsider] });
  a.configure({ memoryMode: "character", autoCharacterCards: true });
  a.turn();
  assert.deepEqual(a.cards.find(card => card.id === 3), outsider);
  assert.deepEqual(a.state.otherScript, { keep: true });
  assert.deepEqual(a.state.memory, { context: "USER MEMORY", authorsNote: "USER NOTE" });
});
test("retry with retained state reuses prose but does not repeat effects, counters or log", () => {
  const a = new Adventure([event("once", { effects: [{ path: "score", op: "add", value: 1 }] })]);
  a.turn();
  const core = clone(a.ep);
  assert.equal(a.retry("RETRY"), "RETRY\n\nAuthored once.");
  assert.deepEqual(a.ep, core);
  assert.equal(a.retry("RETRY\n\nAuthored once."), "RETRY\n\nAuthored once.");
  assert.deepEqual(a.ep, core);
});
test("retry with platform state rollback deterministically recreates a single committed event", () => {
  const a = new Adventure([event("once", { effects: [{ path: "score", op: "add", value: 1 }] })]);
  a.turn();
  a.retry("RETRY", true);
  assert.equal(a.ep.variables.score, 1);
  assert.equal(a.ep.enabledTurns, 1);
  assert.equal(a.ep.eventLog.length, 1);
});
test("a no-event receipt prevents a newly eligible second event on Retry", () => {
  const a = new Adventure([event("later", { minTurns: 2 })]);
  a.turn();
  assert.equal(a.retry(), "A different model response.");
  assert.equal(a.ep.enabledTurns, 1);
  assert.ok(a.turn().visible.endsWith("Authored later."));
});
test("Continue without Input uses changed history as a new output", () => {
  const a = new Adventure([event("later", { minTurns: 2 })]);
  a.turn();
  assert.ok(a.hook("Output", "Continued.").endsWith("Authored later."));
  assert.equal(a.ep.enabledTurns, 2);
});
test("Undo within checkpoint window restores effects, chapter, completion and manual revision", () => {
  const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }] }), event("two", { nextChapter: "next", effects: [{ path: "score", op: "add", value: 10 }] })]);
  a.turn(); a.turn();
  const firstSlot = clone(a.savedSlots[0]);
  a.history = firstSlot.history;
  assert.equal(a.hook("Output", "RETRY FIRST"), "RETRY FIRST\n\nAuthored one.");
  assert.equal(a.ep.enabledTurns, 1);
  assert.equal(a.ep.variables.score, 1);
  assert.equal(a.ep.chapter, "start");
  assert.deepEqual(a.ep.completedEvents, ["one"]);
});
test("edited input at the same action count rolls back that slot before selecting a branch", () => {
  const a = new Adventure([event("branch", { effects: [{ path: "score", op: "add", value: 1 }] })]);
  a.turn();
  a.history = clone(a.savedSlots[0].history);
  a.history[a.history.length - 1].text = "A different choice.";
  a.hook("Output", "BRANCH");
  assert.equal(a.ep.enabledTurns, 1);
  assert.equal(a.ep.variables.score, 1);
});
test("Undo beyond retained checkpoints pauses LEP without breaking story output", () => {
  const a = new Adventure([event("repeat", { once: false, cooldownTurns: 2 })]);
  for (let i = 0; i < 10; i++) a.turn();
  const before = a.ep.enabledTurns;
  a.history = clone(a.savedSlots[0].history);
  assert.equal(a.hook("Output", "Still playable."), "Still playable.");
  assert.equal(a.ep.recoveryRequired, true);
  assert.equal(a.ep.enabledTurns, before);
  assert.equal(a.hook("Context", "MEM\nplayer"), "MEM\nplayer");
});
test("missing actionCount uses history heuristic; missing both skips processing", () => {
  const a = new Adventure([event("one")]);
  a.turn("go", "OK", { actionCount: undefined });
  assert.equal(a.ep.enabledTurns, 1);
  const b = new Adventure([event("one")], { noHistory: true });
  assert.equal(b.hook("Output", "OK", { actionCount: undefined }), "OK");
  assert.equal(b.ep.enabledTurns, 0);
});
test("empty, whitespace, invalid generation do not advance progress; output errors preserve text", () => {
  const a = new Adventure([event("one")]);
  for (const value of ["", " ", null, undefined, "stop"]) a.hook("Output", value);
  assert.ok(!a.ep || a.ep.enabledTurns === 0);
  const broken = new Adventure();
  broken.state.lep = { version: 999, canon: "keep" };
  const before = clone(broken.state);
  assert.equal(broken.hook("Output", "KEEP ME"), "KEEP ME");
  assert.deepEqual(broken.state, before);
});
test("Library example and reference block are exactly synchronized", () => {
  const sample = fs.readFileSync(path.join(root, "docs/events.example.js"), "utf8");
  assert.equal(library.match(blockPattern)[0], sample.match(blockPattern)[0]);
});
test("bundled Library and example definitions match the supplied Missing Stage Key fixture byte for byte", () => {
  const exact = fixtureSource.match(blockPattern)[0];
  assert.equal(library.match(blockPattern)[0], exact);
  assert.equal(fs.readFileSync(path.join(root, "docs/events.example.js"), "utf8").match(blockPattern)[0], exact);
  assert.deepEqual(fixture.events.map(item => item.id), [
    "prep_checklist", "key_goes_missing", "search_team_forms", "first_clue",
    "dynamic_helper_spots_clue", "find_key_backstage", "find_key_office", "find_key_dynamic_location",
    "key_returns_to_stage", "stage_safety_check", "festival_opens", "first_guests_arrive",
    "festival_rush_passes", "festival_aftermath"
  ]);
  assert.deepEqual(Object.keys(fixture.chapters), ["preparation", "search", "recovery", "opening", "festival", "aftermath", "free_roam"]);
});
function fixtureStep(a, id, chapter, chapterTurns, substitutions = {}) {
  const authored = id ? fixtureEvent(id) : null;
  let rendered = authored ? authored.text : "";
  for (const [token, value] of Object.entries(substitutions)) rendered = rendered.replaceAll(token, value);
  const ordinary = "The ordinary scene continues.";
  const destination = authored && authored.nextChapter && fixture.chapters[authored.nextChapter];
  if (destination && destination.announce && authored.nextChapter !== (a.ep && a.ep.chapter)) {
    rendered += "\n\n────────────────────\n" + (destination.title || authored.nextChapter) + "\n────────────────────" + (destination.opening ? "\n\n" + destination.opening : "");
  }
  const expected = !authored ? ordinary : authored.display === "append" ? ordinary + "\n\n" + rendered : rendered;
  const previousTurns = a.ep ? a.ep.enabledTurns : 0;
  assert.equal(a.turn().visible, expected, id || "ordinary output");
  assert.equal(a.ep.enabledTurns, previousTurns + 1);
  assert.equal(a.ep.chapter, chapter);
  assert.equal(a.ep.chapterTurns, chapterTurns);
  return expected;
}
function fixtureThroughClue(a) {
  fixtureStep(a, "prep_checklist", "preparation", 1);
  assert.deepEqual(a.ep.variables, fixture.start.variables);
  fixtureStep(a, "key_goes_missing", "preparation", 2);
  assert.equal(a.ep.variables.key.missing, true);
  fixtureStep(a, "search_team_forms", "search", 0);
  assert.ok(!a.ep.memories.some(item => item.slot === "festival_preparation"));
  fixtureStep(a, "first_clue", "search", 1);
  assert.equal(a.ep.variables.clue.firstFound, true);
}
function fixtureThroughFinale(a) {
  fixtureStep(a, "key_returns_to_stage", "recovery", 1);
  assert.equal(a.ep.variables.stage.keyReturned, true);
  assert.equal(a.ep.memories.find(item => item.slot === "stage_status").scope, "chapter");
  fixtureStep(a, "stage_safety_check", "opening", 0);
  assert.equal(a.ep.variables.stage.ready, true);
  assert.equal(a.ep.memories.find(item => item.slot === "stage_status").scope, "story");
  fixtureStep(a, "festival_opens", "festival", 0);
  assert.equal(a.ep.variables.festival.started, true);
  fixtureStep(a, "first_guests_arrive", "festival", 1);
  assert.equal(a.ep.variables.festival.guestsArrived, true);
  fixtureStep(a, null, "festival", 2);
  fixtureStep(a, "festival_rush_passes", "aftermath", 0);
  assert.equal(a.ep.variables.festival.mainRushOver, true);
  assert.equal(a.ep.memories.find(item => item.slot === "festival_progress").scope, "story");
  fixtureStep(a, null, "aftermath", 1);
  fixtureStep(a, "festival_aftermath", "free_roam", 0);
  assert.equal(a.ep.memories.find(item => item.slot === "festival_finale").summary, fixtureEvent("festival_aftermath").memory.summary);
}
for (const [route, finder] of [["backstage", "Maya"], ["office", "Julia"], ["dynamic", "dynamic"]]) {
  test("Missing Stage Key exact " + route + " route through all seven chapters and free roam", () => {
    const location = {id:12,keys:"Moonlight Cafe",type:"Location",entry:"A cafe beside the theater."};
    const a = fixtureAdventure({cards:route === "dynamic" ? [location] : []});
    fixtureThroughClue(a);
    if (route === "dynamic") a.control(setCommand("v03.searchLocation", "entity_c12"));
    const before = clone(a.ep), cards = clone(a.cards), calls = clone(a.calls);
    assert.equal(a.control(setCommand("choice.search", route)).visible,
      '[LEP Console]\nSet choice.search = "' + route + '"\n[/LEP Console]');
    const expected = clone(before);
    expected.variables.choice.search = route;
    expected.checkpoints = clone(a.ep.checkpoints); // Delivery checkpoint only.
    assert.deepEqual(a.ep, expected);
    assert.deepEqual(worldCards(a.cards), worldCards(cards));
    assert.deepEqual(a.calls, calls);
    const id = "find_key_" + (route === "dynamic" ? "dynamic_location" : route);
    const visible = fixtureStep(a, id, "recovery", 0, {"{{entity:v03.searchLocation}}":"Moonlight Cafe"});
    assert.equal(a.ep.variables.key.found, true);
    assert.equal(a.ep.variables.key.finder, finder);
    assert.equal(a.ep.memories.find(item => item.slot === "stage_key").summary, fixtureEvent(id).memory.summary);
    const afterDiscovery = clone(a.state);
    for (const rollback of [false, true]) {
      assert.equal(a.retry("Different prose on Retry.", rollback), visible);
      assert.deepEqual(a.state, afterDiscovery);
    }
    fixtureThroughFinale(a);
    assert.deepEqual(a.ep.completedEvents, ["prep_checklist", "key_goes_missing", "search_team_forms", "first_clue", id,
      "key_returns_to_stage", "stage_safety_check", "festival_opens", "first_guests_arrive", "festival_rush_passes", "festival_aftermath"]);
    assert.equal(a.ep.enabledTurns, 13);
    const completed = clone(a.ep.completedEvents), memories = clone(a.ep.memories), variables = clone(a.ep.variables);
    for (let i = 1; i <= 3; i++) fixtureStep(a, null, "free_roam", i);
    assert.deepEqual(a.ep.completedEvents, completed);
    assert.deepEqual(a.ep.memories, memories);
    assert.deepEqual(a.ep.variables, variables);
    assert.equal(a.state.lepAutoCards, undefined);
    if (route === "dynamic") assert.deepEqual(a.cards.find(card => card.id === 12), location);
  });
}
test("Missing Stage Key registered helper takes priority, interpolates, and targets character memory", () => {
  const character = {id:11,keys:"Chloe Parker,Chloe",type:"Character",entry:"Chloe helps at the festival."};
  const a = fixtureAdventure({cards:[character]});
  a.configure({memoryMode:"full",autoCharacterCards:true,journalEnabled:true});
  fixtureThroughClue(a);
  a.control(setCommand("v03.helper", "entity_c11"));
  a.control(setCommand("choice.search", "backstage"));
  const visible = fixtureStep(a, "dynamic_helper_spots_clue", "search", 2, {"{{entity:v03.helper}}":"Chloe Parker"});
  assert.equal(a.ep.variables.v03.helperUsed, true);
  assert.equal(a.ep.variables.key.found, false);
  const memory = fixtureEvent("dynamic_helper_spots_clue").memory.summary;
  assert.equal(a.ep.memories.find(item => item.slot === "dynamic_helper").summary, memory);
  assert.ok(a.ep.characters.some(item => item.entityId === "entity_c11" && item.name === "Chloe Parker" && item.summary === memory));
  assert.ok(a.cards.some(card => card.type === CHAR_TYPE && card.entry.includes(memory)));
  assert.deepEqual(a.cards.find(card => card.id === 11), character);
  const before = clone(a.state), calls = clone(a.calls);
  assert.equal(a.retry(), visible);
  assert.deepEqual(a.state, before);
  assert.deepEqual(a.calls, calls);
  fixtureStep(a, "find_key_backstage", "recovery", 0);
  assert.ok(!a.ep.memories.some(item => item.slot === "dynamic_helper"));
  fixtureThroughFinale(a);
  assert.equal(a.ep.enabledTurns, 14);
  assert.equal(a.ep.completedEvents.filter(id => id === "dynamic_helper_spots_clue").length, 1);
});
test("Missing Stage Key search waits for an explicit choice and correctly typed registered entities", () => {
  const a = fixtureAdventure({cards:[chloeCard(), cafeCard()]});
  fixtureThroughClue(a);
  assert.equal(a.turn("I search backstage.").visible, "The ordinary scene continues.");
  assert.equal(a.ep.variables.choice.search, "undecided");
  for (const [helper, location] of [["unknown", "unknown"], ["entity_c12", "entity_c11"]]) {
    a.control(setCommand("v03.helper", helper));
    a.control(setCommand("v03.searchLocation", location));
    a.control(setCommand("choice.search", "dynamic"));
    assert.equal(a.turn().visible, "The ordinary scene continues.");
    assert.equal(a.ep.variables.key.found, false);
    assert.equal(a.ep.variables.v03.helperUsed, false);
    assert.equal(a.ep.chapter, "search");
  }
  a.control(setCommand("v03.searchLocation", "entity_c12"));
  fixtureStep(a, "find_key_dynamic_location", "recovery", 0, {"{{entity:v03.searchLocation}}":"Moonlight Cafe"});
});
test("Missing Stage Key companion cards register all five creator entities without duplicate configuration", () => {
  const imported = JSON.parse(fs.readFileSync(path.join(root, "docs/LEP_Test_Story_Cards.json"), "utf8"));
  const cards = imported.map((card, index) => ({...card, id:index + 1, entry:card.value}));
  const a = fixtureAdventure({cards});
  fixtureStep(a, "prep_checklist", "preparation", 1);
  assert.deepEqual(a.ep.entities.items.filter(item => item.active).map(item => [item.name.toLowerCase(), item.type]), [
    ["maya", "Character"], ["julia", "Character"], ["school hall", "Location"],
    ["school office", "Location"], ["backstage area", "Location"]
  ]);
  const before = storyState(a);
  const inventory = a.control("/lep entities").visible;
  assert.ok(inventory.includes("creation: enabled"));
  for (const entity of a.ep.entities.items) assert.ok(inventory.includes(entity.id));
  assert.deepEqual(storyState(a), before);
  assert.deepEqual(worldCards(a.cards), worldCards(cards));
  assert.equal(a.calls.add, 0);
  assert.equal(a.calls.update, 0);
  assert.equal(a.cards.filter(card => card.keys === CONFIG).length, 1);
});
test("README runnable scenario matches the supplied fixture and validates against the engine", () => {
  const readme = fs.readFileSync(path.join(root, "docs/LEP_Technical_Reference.txt"), "utf8");
  const block = readme.match(/BEGIN RUNNABLE EXAMPLE: MISSING STAGE KEY\n([\s\S]*?)\nEND RUNNABLE EXAMPLE/)[1];
  assert.equal(block, fixtureSource.match(blockPattern)[0]);
  new vm.Script(library + "\nLEP_EVENTS.forEach(LEP_validateEvent);").runInNewContext({}, { timeout: 500 });
  assert.ok(readme.includes('/lep set = {"path":"choice.search","value":"backstage"}'));
  assert.ok(readme.includes("LEGACY CONFIGURATION-CARD DEVELOPMENT COMMANDS"));
});
test("optional import card has the exact canonical runtime identity and defaults", () => {
  const cards = JSON.parse(fs.readFileSync(path.join(root, "docs/configuration.story-cards.json"), "utf8"));
  const runtimeDefaults = new vm.Script(library + "\nLEP_DEFAULT_ENTRY").runInNewContext({}, { timeout: 500 });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].keys, CONFIG);
  assert.equal(cards[0].type, CONFIG_TYPE);
  assert.equal(cards[0].title, "LEP: Lilith Event Paradox — Configuration");
  assert.equal(cards[0].value, runtimeDefaults);
  const a = new Adventure([event("imported")], { cards: [{ id: 73, ...cards[0], entry: cards[0].value }] });
  assert.ok(a.turn().visible.endsWith("Authored imported."));
  assert.equal(a.calls.add, 0);
});

test("testEvent bypasses every eligibility gate/completion without changing progress, cards or manualSet", () => {
  const a = new Adventure([event("preview", {
    enabled: false, chapter: "next", minTurns: 999, minChapterTurns: 999,
    when: { path: "flags.ready", op: "eq", value: true },
    effects: [{ path: "score", op: "add", value: 10 }], nextChapter: "finish",
    memory: { summary: "Maya accepted the invitation.", character: "Maya", scope: "story" }
  }), event("automatic", { priority: 1000 })]);
  a.configure({ debug: true, testEvent: "preview", commandRevision: 1, memoryMode: "full",
    autoCharacterCards: true, journalEnabled: true, manualSet: { revision: 1, path: "score", value: 100 } });
  a.ep.completedEvents.push("preview");
  const before = progress(a.ep), cards = clone(a.cards), calls = clone(a.calls);
  assert.equal(a.turn().visible, "The ordinary scene continues.\n\nAuthored preview.");
  assert.deepEqual(progress(a.ep), before);
  assert.deepEqual(worldCards(a.cards), worldCards(cards));
  assert.deepEqual(a.calls, calls);
  assert.equal(a.ep.lastCommandRevision, 1);
  assert.equal(a.ep.checkpoints.length, 1);
  assert.ok(a.logs.some(line => line.includes("preview only; story progress unchanged")));
});
test("testEvent allows repeated previews only with a newer shared revision", () => {
  const a = new Adventure([event("preview", { enabled: false })]);
  a.configure({ debug: true, testEvent: "preview", commandRevision: 1 });
  assert.ok(a.turn().visible.endsWith("Authored preview."));
  assert.equal(a.turn().visible, "The ordinary scene continues.");
  assert.equal(a.ep.enabledTurns, 1, "only the ordinary output counted");
  const before = progress(a.ep);
  a.configure({ debug: true, testEvent: "preview", commandRevision: 2 });
  assert.ok(a.turn().visible.endsWith("Authored preview."));
  assert.deepEqual(progress(a.ep), before);
  a.configure({ debug: true, testEvent: "preview", commandRevision: 1 });
  assert.equal(a.turn().visible, "The ordinary scene continues.");
  assert.equal(a.ep.lastCommandRevision, 2);
});
test("forceEvent bypasses gates/completion and commits complete lifecycle once, including mirrors", () => {
  const a = new Adventure([event("forced", {
    enabled: false, chapter: "next", minTurns: 999, minChapterTurns: 999,
    when: { path: "flags.ready", op: "eq", value: true },
    effects: [{ path: "score", op: "add", value: 10 }], nextChapter: "finish",
    memory: { summary: "Maya accepted the invitation.", character: "Maya", scope: "story" }
  }), event("automatic", { priority: 999, enabled: false })]);
  a.configure({ debug: true, forceEvent: "forced", commandRevision: 1, memoryMode: "full",
    autoCharacterCards: true, journalEnabled: true, manualSet: { revision: 1, path: "score", value: 100 } });
  a.ep.completedEvents.push("forced");
  assert.ok(a.turn().visible.endsWith("Authored forced."));
  assert.equal(a.ep.enabledTurns, 1);
  assert.equal(a.ep.chapterTurns, 0);
  assert.equal(a.ep.chapter, "finish");
  assert.equal(a.ep.variables.score, 10);
  assert.equal(a.ep.lastManualRevision, 0, "development commands do not consume unrelated manualSet");
  assert.deepEqual(a.ep.completedEvents, ["forced"], "completion IDs stay unique");
  assert.equal(a.ep.eventLog.length, 1);
  assert.equal(a.ep.memories[0].summary, "Maya accepted the invitation.");
  assert.equal(a.ep.characters[0].name, "Maya");
  assert.ok(a.cards.some(card => card.type === CHAR_TYPE));
  assert.ok(a.cards.some(card => card.keys === JOURNAL && card.entry.includes("forced")));
  assert.ok(a.logs.some(line => line.includes("full event executed")));
  a.configure({ debug: true, forceEvent: "forced", commandRevision: 1 });
  assert.equal(a.turn().visible, "The ordinary scene continues.");
  assert.equal(a.ep.variables.score, 10);
  a.configure({ debug: true, forceEvent: "forced", commandRevision: 2 });
  assert.ok(a.turn().visible.endsWith("Authored forced."));
  assert.equal(a.ep.variables.score, 20);
  assert.equal(a.ep.eventLog.length, 2);
  assert.deepEqual(a.ep.completedEvents, ["forced"]);
});
test("forceEvent marks a new one-shot completed; later ordinary play cannot fire it again", () => {
  const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }] })]);
  a.configure({ debug: true, forceEvent: "one", commandRevision: 1 });
  a.turn();
  assert.deepEqual(a.ep.completedEvents, ["one"]);
  a.configure({ debug: false });
  assert.equal(a.turn().visible, "The ordinary scene continues.");
  assert.equal(a.ep.variables.score, 1);
});
test("forceEvent bypasses repeating cooldown while retaining the event's repeat policy", () => {
  const a = new Adventure([event("repeat", { once: false, cooldownTurns: 100, effects: [{ path: "score", op: "add", value: 1 }] })]);
  for (let revision = 1; revision <= 2; revision++) {
    a.configure({ debug: true, forceEvent: "repeat", commandRevision: revision });
    assert.ok(a.turn().visible.endsWith("Authored repeat."));
  }
  assert.equal(a.ep.variables.score, 2);
  assert.equal(a.ep.repeatTurns.repeat, 2);
  assert.deepEqual(a.ep.completedEvents, []);
  assert.equal(a.turn().visible, "The ordinary scene continues.");
});
test("both development commands preserve exact append/replace text and supported interpolation", () => {
  const prose = "  Maya: \"Wait...\"\n\n‘Tomorrow’ — ${player} {{score}}  ";
  for (const kind of ["testEvent", "forceEvent"]) {
    for (const display of ["append", "replace"]) {
      const a = new Adventure([event("exact", { enabled: false, text: prose, display })]);
      a.configure({ debug: true, [kind]: "exact", commandRevision: 1 });
      assert.equal(a.turn("go", "MODEL\n").visible, display === "replace" ? prose : "MODEL\n\n\n" + prose);
    }
    const a = new Adventure([event("interpolate", { enabled: false, text: "Score: {{score}}", display: "replace", interpolate: true,
      effects: [{ path: "score", op: "add", value: 1 }] })]);
    a.configure({ debug: true, [kind]: "interpolate", commandRevision: 1 });
    assert.equal(a.turn().visible, "Score: 0");
    assert.equal(a.ep.variables.score, kind === "testEvent" ? 0 : 1);
  }
});
test("testEvent takes precedence; clearing it cannot activate forceEvent with the same revision", () => {
  const a = new Adventure([event("preview", { enabled: false }), event("forced", { enabled: false,
    effects: [{ path: "score", op: "add", value: 10 }] })]);
  a.configure({ debug: true, testEvent: "preview", forceEvent: "forced", commandRevision: 1 });
  const before = progress(a.ep);
  assert.ok(a.turn().visible.endsWith("Authored preview."));
  assert.deepEqual(progress(a.ep), before);
  assert.ok(a.logs.some(line => line.includes("testEvent takes precedence")));
  a.configure({ debug: true, forceEvent: "forced", commandRevision: 1 });
  assert.equal(a.turn().visible, "The ordinary scene continues.");
  assert.equal(a.ep.variables.score, 0);
  a.configure({ debug: true, forceEvent: "forced", commandRevision: 2 });
  assert.ok(a.turn().visible.endsWith("Authored forced."));
  assert.equal(a.ep.variables.score, 10);
});
test("unknown/invalid command IDs reserve only their attempt and never fall through to another event", () => {
  for (const kind of ["testEvent", "forceEvent"]) {
    for (const id of ["missing", "MISSING", "bad id", "__proto__", '"valid"']) {
      const a = new Adventure([event("valid", { effects: [{ path: "score", op: "add", value: 1 }] })]);
      a.configure({ debug: true, [kind]: id, commandRevision: 1 });
      const before = progress(a.ep);
      assert.equal(a.turn().visible, "The ordinary scene continues.");
      assert.deepEqual(progress(a.ep), before);
      assert.equal(a.ep.lastCommandRevision, 1);
      assert.ok(a.logs.some(line => line.includes(": rejected;")));
      assert.equal(a.retry("RETRY"), "RETRY");
      assert.deepEqual(progress(a.ep), before);
      a.configure({ debug: true, [kind]: "valid", commandRevision: 2 });
      assert.ok(a.turn().visible.endsWith("Authored valid."));
    }
  }
  const a = new Adventure([event("forced", { enabled: false })]);
  a.configure({ debug: true, testEvent: "bad id", forceEvent: "forced", commandRevision: 1 });
  assert.equal(a.turn().visible, "The ordinary scene continues.");
  assert.equal(a.ep.enabledTurns, 0);
});
test("development commands retain full definition validation, including duplicates and unsafe paths", () => {
  const badLists = [
    [event("invalid", { text: " " })],
    [event("invalid"), event("invalid")],
    [event("invalid", { nextChapter: "unknown" })],
    [event("invalid", { when: { path: "score", op: "gte", value: "0" } })],
    [event("invalid", { effects: [{ path: "constructor.prototype.bad", op: "set", value: true }] })],
    [event("invalid", { once: false })]
  ];
  for (const kind of ["testEvent", "forceEvent"]) {
    for (const events of badLists) {
      const a = new Adventure(events);
      a.configure({ debug: true, [kind]: "invalid", commandRevision: 1 });
      const before = progress(a.ep);
      assert.equal(a.turn().visible, "The ordinary scene continues.");
      assert.deepEqual(progress(a.ep), before);
      assert.ok(a.logs.some(line => line.includes("Skipping definition")));
    }
  }
});
test("failed force effects roll back all progress and consume only the attempted revision", () => {
  const a = new Adventure([event("broken", { enabled: false,
    effects: [{ path: "score", op: "add", value: 10 }, { path: "missing", op: "add", value: 1 }],
    nextChapter: "next", memory: { summary: "Must not be saved.", character: "Maya" } })]);
  a.configure({ debug: true, forceEvent: "broken", commandRevision: 1, memoryMode: "full", autoCharacterCards: true, journalEnabled: true });
  const before = progress(a.ep), calls = clone(a.calls);
  assert.equal(a.turn().visible, "The ordinary scene continues.");
  assert.deepEqual(progress(a.ep), before);
  assert.deepEqual(a.calls, calls);
  assert.equal(a.ep.lastCommandRevision, 1);
  // Preview validates the schema but intentionally never tries to run effects.
  a.configure({ debug: true, testEvent: "broken", commandRevision: 2 });
  assert.ok(a.turn().visible.endsWith("Authored broken."));
  assert.deepEqual(progress(a.ep), before);
});
test("development commands never run or consume revisions when LEP is disabled", () => {
  for (const kind of ["testEvent", "forceEvent"]) {
    const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }] })]);
    a.configure({ enabled: false, debug: true, [kind]: "one", commandRevision: 1 });
    const before = clone(a.state), calls = clone(a.calls);
    for (let i = 0; i < 2; i++) assert.equal(a.turn().visible, "The ordinary scene continues.");
    assert.deepEqual(a.state, before);
    assert.deepEqual(a.calls, calls);
    a.configure({ enabled: true, debug: true, [kind]: "one", commandRevision: 1 });
    assert.ok(a.turn().visible.endsWith("Authored one."));
    assert.equal(a.ep.lastCommandRevision, 1);
  }
});
test("debug=false ignores commands and preserves ordinary processing; pending command can later run", () => {
  for (const kind of ["testEvent", "forceEvent"]) {
    const a = new Adventure([event("one", { enabled: false, effects: [{ path: "score", op: "add", value: 1 }] }), event("ordinary")]);
    a.configure({ debug: false, [kind]: "one", commandRevision: 1 });
    assert.ok(a.turn().visible.endsWith("Authored ordinary."));
    assert.equal(a.ep.lastCommandRevision, 0);
    assert.equal(a.ep.variables.score, 0);
    a.configure({ debug: true, [kind]: "one", commandRevision: 1 });
    assert.ok(a.turn().visible.endsWith("Authored one."));
    assert.equal(a.ep.lastCommandRevision, 1);
  }
});
test("Retry replays either command without duplicate effects, counters, manual changes or card writes", () => {
  for (const kind of ["testEvent", "forceEvent"]) {
    const a = new Adventure([event("one", { enabled: false, effects: [{ path: "score", op: "add", value: 1 }],
      memory: { summary: "Maya knows.", character: "Maya" } })]);
    a.configure({ debug: true, [kind]: "one", commandRevision: 1, memoryMode: "full", autoCharacterCards: true, journalEnabled: true });
    a.turn();
    const before = clone(a.ep), cards = clone(a.cards), calls = clone(a.calls);
    for (let i = 0; i < 3; i++) assert.equal(a.retry("RETRY"), "RETRY\n\nAuthored one.");
    assert.deepEqual(a.ep, before);
    assert.deepEqual(worldCards(a.cards), worldCards(cards));
    assert.deepEqual(a.calls, calls);
    assert.equal(a.retry("RETRY\n\nAuthored one."), "RETRY\n\nAuthored one.");
    assert.ok(a.logs.some(line => line.includes("no command effects repeated")));
  }
});
test("Retry with platform state rollback recreates one command outcome without cumulative effects", () => {
  for (const kind of ["testEvent", "forceEvent"]) {
    const a = new Adventure([event("one", { enabled: false, effects: [{ path: "score", op: "add", value: 1 }] })]);
    a.configure({ debug: true, [kind]: "one", commandRevision: 1 });
    a.turn();
    for (let i = 0; i < 2; i++) assert.equal(a.retry("RETRY", true), "RETRY\n\nAuthored one.");
    assert.equal(a.ep.variables.score, kind === "testEvent" ? 0 : 1);
    assert.equal(a.ep.enabledTurns, kind === "testEvent" ? 0 : 1);
    assert.equal(a.ep.eventLog.length, kind === "testEvent" ? 0 : 1);
    assert.equal(a.ep.lastCommandRevision, 1);
  }
});
test("new command revisions wait for a new output, even if edited during a normal or command Retry", () => {
  const a = new Adventure([event("one", { enabled: false }), event("two", { enabled: false })]);
  a.turn();
  a.configure({ debug: true, testEvent: "one", commandRevision: 1 });
  assert.equal(a.retry("RETRY"), "RETRY");
  assert.equal(a.ep.lastCommandRevision, 0);
  assert.ok(a.turn().visible.endsWith("Authored one."));
  a.configure({ debug: true, forceEvent: "two", commandRevision: 2 });
  assert.equal(a.retry("RETRY"), "RETRY\n\nAuthored one.");
  assert.equal(a.ep.lastCommandRevision, 1);
  assert.ok(a.turn().visible.endsWith("Authored two."));
  assert.equal(a.ep.lastCommandRevision, 2);
});
test("debug/enabled switches also prevent development receipt replay", () => {
  for (const kind of ["testEvent", "forceEvent"]) {
    for (const disabledSetting of [{ debug: false }, { enabled: false, debug: true }]) {
      const a = new Adventure([event("one", { enabled: false })]);
      a.configure({ debug: true, [kind]: "one", commandRevision: 1 });
      a.turn();
      const before = clone(a.ep), calls = clone(a.calls);
      a.configure({ [kind]: "one", commandRevision: 1, ...disabledSetting });
      assert.equal(a.retry("RETRY"), "RETRY");
      assert.deepEqual(a.ep, before);
      assert.deepEqual(a.calls, calls);
    }
  }
});
test("missing/invalid revision never arms a development command; config casing/comments work", () => {
  for (const revision of [undefined, "", 0, -1, 1.5, "bad", "1e2", "9007199254740992"]) {
    const a = new Adventure([event("one", { enabled: false })]);
    const config = { debug: true, testEvent: "one" };
    if (revision !== undefined) config.commandRevision = revision;
    a.configure(config);
    assert.equal(a.turn().visible, "The ordinary scene continues.");
    assert.equal(a.ep.lastCommandRevision, 0);
    assert.ok(a.logs.some(line => line.includes("not armed")));
  }
  const a = new Adventure([event("CaseSensitive", { enabled: false })]);
  a.configure("EnAbLeD=TRUE\nDEBUG=TRUE\n TestEvent = CaseSensitive # comment\n CommandRevision = 1");
  assert.ok(a.turn().visible.endsWith("Authored CaseSensitive."));
});
test("same-namespace v1 optional fields retain compatibility without rewriting progress", () => {
  const a = new Adventure([event("one", { enabled: false })]);
  a.configure("enabled=true\ndebug=false\nmanualSet=");
  delete a.ep.lastCommandRevision;
  const oldConfig = a.cards[0].entry;
  a.turn();
  assert.equal(a.ep.enabledTurns, 1);
  assert.equal(a.cards[0].entry, oldConfig);
  assert.equal(a.ep.lastCommandRevision, undefined, "no migration writes just to read an old state");
  a.configure({ debug: true, testEvent: "one", commandRevision: 1 });
  const before = progress(a.ep);
  assert.ok(a.turn().visible.endsWith("Authored one."));
  assert.deepEqual(progress(a.ep), before);
  assert.equal(a.ep.lastCommandRevision, 1);
});
test("failed/blank model outputs do not consume commands and Continue needs no Input hook", () => {
  const a = new Adventure([event("one", { enabled: false })]);
  a.configure({ debug: true, testEvent: "one", commandRevision: 1 });
  for (const text of ["", " ", null, "stop"]) a.hook("Output", text);
  assert.equal(a.ep.lastCommandRevision, 0);
  assert.equal(a.hook("Output", "CONTINUE"), "CONTINUE\n\nAuthored one.");
  assert.equal(a.ep.lastCommandRevision, 1);
  assert.equal(a.ep.enabledTurns, 0);
});
test("internal Undo does not re-arm a force revision after its effects are rolled back", () => {
  const a = new Adventure([event("one", { enabled: false, effects: [{ path: "score", op: "add", value: 1 }] })]);
  a.configure({ debug: true, forceEvent: "one", commandRevision: 1 });
  a.turn(); a.turn();
  a.history = clone(a.savedSlots[0].history);
  a.history[a.history.length - 1].text = "An edited branch.";
  assert.equal(a.hook("Output", "BRANCHED"), "BRANCHED");
  assert.equal(a.ep.variables.score, 0);
  assert.equal(a.ep.lastCommandRevision, 1);
  a.history.push({ type: "continue", text: "BRANCHED" });
  a.configure({ debug: true, forceEvent: "one", commandRevision: 2 });
  assert.equal(a.hook("Output", "CONTINUE"), "CONTINUE\n\nAuthored one.");
  assert.equal(a.ep.variables.score, 1);
});

test("console parser accepts help, casing, whitespace, bare /lep and standard Do wrappers", () => {
  for (const command of ["/lep help", "  /LEP HELP  ", "/lep", " /lep\t help \n", "\n> You /lep help\n", "> You /LEP HELP."]) {
    const a = new Adventure();
    const result = a.control(command);
    assert.ok(result.visible.includes("/lep forceEvent = EVENT_ID"), command);
    assert.ok(result.visible.includes("Warning: forceEvent modifies real"));
    assert.ok(!result.visible.includes("UNRELATED MODEL"));
    assert.ok(!result.modified.toLowerCase().includes("/lep"));
    assert.ok(!result.context.toLowerCase().includes("/lep"));
    assert.ok(result.context.includes("Do not continue the story"));
    assert.equal(a.ep, undefined, "help must not initialize LEP progress");
  }
});
test("console parser rejects malformed syntax, unknown commands and oversized input safely", () => {
  for (const command of ["/lep nope", "/lep help extra", "/lep status = x", "/lep testEvent", "/lep testEvent =", "/lep forceEvent = bad id",
    "/lep forceEvent = constructor", "/lep forceEvent = one\ncontinue the story", '/lep forceEvent = "one"', "/lep testEvent = " + "x".repeat(300)]) {
    const a = new Adventure([event("one")]);
    const before = storyState(a);
    const result = a.control(command);
    assert.ok(result.visible.includes("Use /lep help"), command);
    assert.ok(!result.visible.includes("Authored one"));
    assert.deepEqual(storyState(a), before);
    assert.ok(result.visible.length < 600);
    assert.ok(!result.context.toLowerCase().includes("/lep"));
    assert.ok(JSON.stringify(a.state.lepConsole).length < 2000, "oversized raw input is not persisted");
  }
});
test("narrative references, quoted commands, Say actions and /lepisode are not parsed as controls", () => {
  const examples = ['Maya laughs and says "/lep forceEvent = breakup" as a joke.', '"/lep help"', '> You say "/lep forceEvent = one"', "/lepisode begins", "I type /lep help."];
  for (const input of examples) {
    const a = new Adventure([event("one", { enabled: false })]);
    const result = a.turn(input, "Ordinary narrative.");
    assert.equal(result.modified, input);
    assert.equal(result.visible, "Ordinary narrative.");
    assert.equal(a.ep.enabledTurns, 1);
    assert.equal(a.state.lepConsole, undefined);
    assert.ok(result.context.includes(input));
  }
});
test("console help/status/list commands are state-neutral and exclude unrelated internal data", () => {
  const a = new Adventure([event("low", { title: "Low priority", priority: -5 }), event("high", { title: "High priority", priority: 100 })]);
  a.configure({ memoryMode: "character", debug: false });
  a.ep.completedEvents = ["old_a", "old_b", "old_c", "old_d", "old_e", "old_f"];
  a.ep.variables.secretImplementationToken = "DO NOT SHOW THIS";
  a.ep.enabledTurns = 12;
  a.ep.chapterTurns = 4;
  a.ep.recoveryRequired = true;
  const before = storyState(a), calls = clone(a.calls), cards = clone(a.cards);
  const status = a.control("/lep status").visible;
  for (const expected of ["Version: 0.6", "Engine: enabled", "Chapter: start", "At the start.", "enabledTurns: 12", "chapterTurns: 4", "one-shot events (visible + silent): 6", "old_f", "recoveryRequired: true", "Memory mode: character"]) assert.ok(status.includes(expected), expected);
  assert.ok(!status.includes("old_a") && !status.includes("DO NOT SHOW THIS"));
  for (const command of ["/lep help", "/lep eventsID", "/lep chaptersID"]) a.control(command);
  assert.deepEqual(storyState(a), before);
  assert.deepEqual(a.calls, calls);
  assert.deepEqual(worldCards(a.cards), worldCards(cards));
  assert.equal(a.logs.length, 0, "console does not require technical debug logs");
});
test("console eventsID includes disabled valid definitions, labels completion, excludes invalid/duplicate IDs", () => {
  const a = new Adventure([event("first", { title: "First Title", priority: -2 }), event("second", { enabled: false, title: "Second Title", priority: 999 }),
    event("bad", { text: "" }), event("duplicate"), event("duplicate"), event("unknownChapter", { chapter: "not_known" })]);
  a.configure({ debug: false });
  a.ep.completedEvents.push("first");
  const before = storyState(a);
  const result = a.control("/lep EVENTSId").visible;
  assert.ok(result.includes("first — First Title [completed]"));
  assert.ok(result.includes("second — Second Title"));
  assert.ok(result.indexOf("first") < result.indexOf("second"), "definition order, not priority order");
  for (const invalid of ["bad", "duplicate", "unknownChapter"]) assert.ok(!result.includes(invalid));
  assert.deepEqual(storyState(a), before);
});
test("console event/chapter listings are bounded and clearly show truncation", () => {
  const many = Array.from({ length: 270 }, (_, i) => event("event_" + i, { title: "Title " + i }));
  const a = new Adventure(many);
  const result = a.control("/lep eventsID").visible;
  assert.ok(result.length < 6500);
  assert.ok(result.includes("Showing 40 of 256"));
  assert.ok(result.includes("first 256 entries"));
  assert.ok(!result.includes("event_269"));
  const chapters = Object.fromEntries(Array.from({ length: 64 }, (_, i) => ["chapter_" + i, "Description " + i]));
  chapters.constructor = "Unsafe ID";
  chapters.wrongType = 17;
  chapters.tooLong = "x".repeat(241);
  const b = new Adventure([], { chapters });
  const listing = b.control("/lep chaptersID").visible;
  assert.ok(listing.includes("chapter_0 — Description 0"));
  assert.ok(listing.includes("Showing 40 of 64"));
  assert.ok(!listing.includes("Unsafe ID") && !listing.includes("wrongType") && !listing.includes("tooLong"));
  assert.equal(b.ep, undefined);
});
test("console remains useful with corrupt progress and empty definition lists", () => {
  const a = new Adventure([]);
  a.state.lep = { version: 999, chapter: "lost", recoveryRequired: true, preserve: "CANON" };
  const before = storyState(a);
  assert.ok(a.control("/lep help").visible.includes("Show this help"));
  assert.ok(a.control("/lep status").visible.includes("Chapter: lost"));
  assert.ok(a.control("/lep eventsID").visible.includes("None available"));
  assert.deepEqual(storyState(a), before);
});
test("console previews bypass all requirements/completion and preserve entire LEP namespace and cards", () => {
  const a = new Adventure([event("PreviewCase", { enabled: false, chapter: "next", minTurns: 999, minChapterTurns: 999,
    when: { all: [{ path: "flags.ready", op: "eq", value: true }] }, display: "replace",
    text: "  Maya says, \"Tomorrow.\"\n\nScore {{score}} — ${player}  ", interpolate: true,
    effects: [{ path: "score", op: "add", value: 5 }], nextChapter: "finish",
    memory: { summary: "Maya made a promise.", character: "Maya", scope: "story" }
  }), event("eligible", { priority: 5000 })]);
  a.configure({ debug: false, memoryMode: "full", autoCharacterCards: true, journalEnabled: true,
    manualSet: { revision: 1, path: "score", value: 100 }, testEvent: "eligible", commandRevision: 1 });
  a.ep.completedEvents.push("PreviewCase");
  const before = storyState(a), calls = clone(a.calls), cards = clone(a.cards);
  const preview = a.control(" /LEP   TESTEVENT =  PreviewCase  ").visible;
  assert.ok(preview.includes('  Maya says, "Tomorrow."\n\nScore 0 — ${player}  '));
  assert.ok(preview.includes("Preview: PreviewCase — LEP progress unchanged"));
  assert.ok(!preview.includes("Authored eligible") && !preview.includes("UNRELATED MODEL"));
  assert.deepEqual(storyState(a), before);
  assert.deepEqual(worldCards(a.cards), worldCards(cards));
  assert.deepEqual(a.calls, calls);
});
test("console previews repeat without revisions, do not advance eligibility, and Retry is state-neutral", () => {
  const a = new Adventure([event("preview", { enabled: false }), event("automatic", { minTurns: 1 })]);
  a.configure({ debug: false });
  const before = storyState(a);
  for (let i = 0; i < 4; i++) assert.ok(a.control("/lep testEvent = preview").visible.includes("Authored preview."));
  assert.deepEqual(storyState(a), before);
  assert.equal(a.state.lepConsole.sequence, 4);
  const result = a.retry("DIFFERENT MODEL");
  assert.ok(result.includes("Authored preview.") && !result.includes("DIFFERENT MODEL"));
  assert.deepEqual(storyState(a), before);
  assert.ok(a.turn().visible.endsWith("Authored automatic."));
  assert.equal(a.ep.enabledTurns, 1);
});
test("console preview can inspect repeat events during cooldown without changing repeat bookkeeping", () => {
  const a = new Adventure([event("repeat", { once: false, cooldownTurns: 100 })]);
  a.turn();
  const before = storyState(a);
  a.control("/lep testEvent = repeat");
  assert.deepEqual(storyState(a), before);
});
test("console unknown IDs and invalid definitions return helpful errors without ordinary-event fallback", () => {
  for (const command of ["/lep testEvent = missing", "/lep forceEvent = missing", "/lep testEvent = bad", "/lep forceEvent = bad"]) {
    const a = new Adventure([event("eligible"), event("bad", { effects: [{ path: "__proto__.bad", op: "set", value: true }] })]);
    const before = storyState(a);
    const result = a.control(command);
    assert.ok(result.visible.includes("not found among valid definitions"));
    assert.ok(result.visible.includes("/lep eventsID"));
    assert.ok(!result.visible.includes("Authored eligible"));
    assert.deepEqual(storyState(a), before);
  }
});
test("console force uses real event pipeline, bypasses completed/wrong-chapter gates and suppresses other events", () => {
  const a = new Adventure([event("forced", { enabled: false, chapter: "next", minTurns: 999, minChapterTurns: 999,
    when: { path: "score", op: "gt", value: 100 }, text: "Score before: {{score}}\n\nA real scene.", interpolate: true,
    effects: [{ path: "score", op: "add", value: 10 }, { path: "flags.ready", op: "set", value: true }],
    nextChapter: "finish", memory: { summary: "Maya knows the secret.", character: "Maya", scope: "story" }
  }), event("eligible", { priority: 9999 })]);
  a.configure({ debug: false, memoryMode: "full", autoCharacterCards: true, journalEnabled: true,
    manualSet: { revision: 1, path: "score", value: 100 } });
  a.ep.completedEvents.push("forced");
  assert.equal(a.control("/lep forceEvent = forced").visible, "Score before: 0\n\nA real scene.");
  assert.equal(a.ep.variables.score, 10);
  assert.equal(a.ep.variables.flags.ready, true);
  assert.equal(a.ep.chapter, "finish");
  assert.equal(a.ep.chapterTurns, 0);
  assert.equal(a.ep.enabledTurns, 1);
  assert.deepEqual(a.ep.completedEvents, ["forced"]);
  assert.equal(a.ep.lastManualRevision, 0);
  assert.equal(a.ep.eventLog.length, 1);
  assert.equal(a.ep.memories[0].summary, "Maya knows the secret.");
  assert.equal(a.ep.characters[0].name, "Maya");
  assert.ok(a.cards.some(card => card.type === CHAR_TYPE));
  assert.ok(a.cards.some(card => card.keys === JOURNAL && card.entry.includes("forced")));
});
test("console force preserves exact authored bytes for both displays with a clean empty canvas", () => {
  const text = " \n‘Listen,’ says Maya.\n\n\"Yes?\"  ";
  for (const display of ["append", "replace"]) {
    const a = new Adventure([event("exact", { text, display })]);
    assert.equal(a.control("/lep forceEvent = exact").visible, text);
  }
});
test("separate force actions deliberately reapply effects but never duplicate completion IDs", () => {
  const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }] })]);
  for (let i = 0; i < 3; i++) assert.equal(a.control("/lep forceEvent = one").visible, "Authored one.");
  assert.equal(a.ep.variables.score, 3);
  assert.equal(a.ep.enabledTurns, 3);
  assert.equal(a.ep.eventLog.length, 3);
  assert.deepEqual(a.ep.completedEvents, ["one"]);
  assert.equal(a.ep.lastCommandRevision, 0);
});
test("console forcing a repeat bypasses cooldown but retains normal repeat bookkeeping", () => {
  const a = new Adventure([event("repeat", { once: false, cooldownTurns: 100, effects: [{ path: "score", op: "add", value: 1 }] })]);
  a.control("/lep forceEvent = repeat");
  a.control("/lep forceEvent = repeat");
  assert.equal(a.ep.variables.score, 2);
  assert.equal(a.ep.repeatTurns.repeat, 2);
  assert.deepEqual(a.ep.completedEvents, []);
  assert.equal(a.turn().visible, "The ordinary scene continues.");
});
test("console force transaction failure leaves existing or absent progress untouched and returns an error", () => {
  for (const initialize of [false, true]) {
    const a = new Adventure([event("bad", { effects: [{ path: "score", op: "add", value: 10 }, { path: "missing", op: "add", value: 1 }],
      nextChapter: "next", memory: { summary: "Do not commit.", character: "Maya" } }), event("eligible")]);
    if (initialize) a.configure({ memoryMode: "full", autoCharacterCards: true, journalEnabled: true });
    const before = storyState(a);
    const result = a.control("/lep forceEvent = bad").visible;
    assert.ok(result.includes("Arithmetic needs an existing numeric variable"));
    assert.ok(result.includes("No event was committed"));
    assert.deepEqual(storyState(a), before);
    assert.ok(!a.cards.some(card => card.type === CHAR_TYPE || card.keys === JOURNAL));
    assert.ok(a.retry().includes("No event was committed"));
    assert.deepEqual(storyState(a), before);
  }
});
test("console force Retry is idempotent with raw/modified history and either platform rollback profile", () => {
  for (const rawInputHistory of [false, true]) {
    for (const rollback of [false, true]) {
      const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }], nextChapter: "next",
        memory: { summary: "Maya knows.", character: "Maya" } })], { rawInputHistory });
      a.configure({ memoryMode: "full", autoCharacterCards: true, journalEnabled: true, debug: false });
      a.control("\n> You /lep forceEvent = one\n");
      const before = storyState(a), cards = clone(a.cards), calls = clone(a.calls);
      for (let i = 0; i < 3; i++) assert.equal(a.retry("DIFFERENT MODEL", rollback), "Authored one.");
      assert.deepEqual(storyState(a), before);
      assert.deepEqual(worldCards(a.cards), worldCards(cards));
      assert.deepEqual(a.calls, calls);
      assert.equal(a.ep.variables.score, 1);
      assert.equal(a.ep.eventLog.length, 1);
    }
  }
});
test("Retry that reruns Input cannot re-commit a forced command", () => {
  const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }] })], { rawInputHistory: true });
  a.control("/lep forceEvent = one");
  a.history = clone(a.savedSlots[0].history);
  a.hook("Input", "/lep forceEvent = one");
  assert.equal(a.hook("Output", "RETRIED"), "Authored one.");
  assert.equal(a.ep.variables.score, 1);
  assert.equal(a.ep.eventLog.length, 1);
});
test("disabled console allows help/status/lists/preview without progress; force is blocked", () => {
  const card = { id: 7, keys: CONFIG, type: CONFIG_TYPE, entry: "enabled=false\ndebug=false" };
  const a = new Adventure([event("one")], { cards: [card] });
  const before = storyState(a), cards = clone(a.cards), calls = clone(a.calls);
  for (const command of ["/lep help", "/lep status", "/lep eventsID", "/lep chaptersID", "/lep testEvent = one"]) {
    const result = a.control(command).visible;
    assert.ok(result.includes("LEP") && !result.includes("No event was committed"));
  }
  const blocked = a.control("/lep forceEvent = one").visible;
  assert.ok(blocked.includes("paused (enabled=false)"));
  assert.ok(blocked.includes("Enable it"));
  assert.deepEqual(storyState(a), before);
  assert.deepEqual(worldCards(a.cards), worldCards(cards));
  assert.deepEqual(a.calls, calls);
  a.configure({ enabled: true, debug: false });
  assert.equal(a.control("/lep forceEvent = one").visible, "Authored one.");
});
test("paused force Retry does not replay or change canon; readonly commands remain available during recovery", () => {
  const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }] })]);
  a.control("/lep forceEvent = one");
  a.configure({ enabled: false });
  const before = storyState(a);
  assert.ok(a.retry().includes("paused"));
  assert.deepEqual(storyState(a), before);
  a.configure({ enabled: true });
  a.ep.recoveryRequired = true;
  const recovery = storyState(a);
  assert.ok(a.control("/lep status").visible.includes("recoveryRequired: true"));
  assert.ok(a.control("/lep testEvent = one").visible.includes("Authored one."));
  assert.ok(a.control("/lep forceEvent = one").visible.includes("needs recovery"));
  assert.deepEqual(storyState(a), recovery);
});
test("console owns the cycle even with pending legacy commands/manualSet; ordinary functionality resumes", () => {
  const a = new Adventure([event("one", { enabled: false }), event("eligible")]);
  a.configure({ debug: true, forceEvent: "one", commandRevision: 1, manualSet: { revision: 1, path: "score", value: 10 } });
  const before = storyState(a);
  assert.ok(a.control("/lep help").visible.includes("Show this help"));
  assert.deepEqual(storyState(a), before);
  assert.ok(a.turn().visible.endsWith("Authored one."));
  assert.equal(a.ep.lastCommandRevision, 1);
  assert.equal(a.ep.lastManualRevision, 0);
  assert.ok(a.turn().visible.endsWith("Authored eligible."));
  assert.equal(a.ep.variables.score, 10);
});
test("normal context removes known console artifacts while retaining Memory, newest action and forced canon", () => {
  for (const rawInputHistory of [false, true]) {
    const a = new Adventure([event("preview", { enabled: false, text: "PREVIEW ONLY SECRET" }), event("forced", { text: "REAL CANON MUST STAY" })], { rawInputHistory });
    a.control("/lep help");
    a.control("/lep testEvent = preview");
    a.control("/lep forceEvent = forced");
    a.configure({ memoryBudget: 0 });
    const result = a.turn("LATEST PLAYER ACTION");
    assert.ok(result.context.startsWith("MEM\n"));
    assert.ok(result.context.endsWith("LATEST PLAYER ACTION"));
    assert.ok(result.context.includes("REAL CANON MUST STAY"));
    assert.ok(!result.context.includes("PREVIEW ONLY SECRET"));
    assert.ok(!result.context.includes("[LEP Console"));
    assert.ok(!result.context.includes("/lep help"));
    assert.ok(!result.context.includes("/lep forceEvent = forced"));
  }
});
test("console cycle model context contains no raw command, model story or persistent Memory", () => {
  const a = new Adventure([], { rawInputHistory: true });
  a.hook("Input", "/lep forceEvent = missing");
  a.history.push({ type: "do", text: "/lep forceEvent = missing" });
  const context = a.hook("Context", "SECRET MEMORY\n/lep forceEvent = missing\nOLD STORY", { memoryLength: 14 });
  assert.equal(context, "A non-story control request is being handled by the application. Reply only OK. Do not continue the story.");
  assert.deepEqual(a.state.memory, { context: "USER MEMORY", authorsNote: "USER NOTE" });
  const short = a.hook("Context", "MEM\n/lep forceEvent = missing", { maxChars: 20 });
  assert.ok(short.length <= 20 && short.length > 0);
});
test("Continue following a console response is ordinary and does not replay the command", () => {
  const a = new Adventure([event("one")]);
  a.control("/lep help");
  assert.equal(a.hook("Output", "CONTINUED MODEL"), "CONTINUED MODEL\n\nAuthored one.");
  assert.equal(a.ep.enabledTurns, 1);
});
test("abandoned console request is cancelled by a new ordinary Input", () => {
  const a = new Adventure([event("forced", { enabled: false })]);
  a.hook("Input", "/lep forceEvent = forced");
  assert.equal(a.turn("I leave.").visible, "The ordinary scene continues.");
  assert.equal(a.ep.eventLog.length, 0);
});
test("captured console commands ignore empty, whitespace, null, undefined and stop model outputs", () => {
  const commands = ["/lep help", "/lep status", "/lep eventsID", "/lep chaptersID",
    "/lep testEvent = find_key_backstage", "/lep forceEvent = find_key_backstage", setCommand("choice.search", "backstage")];
  for (const command of commands) for (const output of ["", " \n\t", null, undefined, "stop"]) {
    const a = fixtureAdventure();
    const marker = a.hook("Input", command);
    a.history.push({ type: "do", text: marker });
    assert.ok(a.hook("Context", "MEM\nRAW COMMAND").includes("Do not continue the story"));
    const visible = a.hook("Output", output);
    assert.ok(!visible.includes("No successful model output"));
    assert.equal(a.state.lepConsole.pending, null);
    if (command.includes("forceEvent")) {
      assert.equal(visible, fixtureEvent("find_key_backstage").text);
      assert.equal(a.ep.variables.key.finder, "Maya");
      assert.equal(a.ep.enabledTurns, 1);
    } else if (command.startsWith("/lep set")) {
      assert.ok(visible.includes('Set choice.search = "backstage"'));
      assert.equal(a.ep.variables.choice.search, "backstage");
      assert.equal(a.ep.enabledTurns, 0);
    } else {
      assert.equal(a.ep, undefined);
      assert.ok(visible.startsWith("[LEP Console]"));
      if (command.includes("testEvent")) assert.ok(visible.includes(fixtureEvent("find_key_backstage").text));
      if (command.includes("status")) assert.ok(visible.includes("Version: 0.6"));
      if (command.includes("eventsID")) assert.ok(visible.includes("key_goes_missing"));
      if (command.includes("chaptersID")) assert.ok(visible.includes("preparation"));
      if (command.includes("help")) assert.ok(visible.includes("/lep set ="));
    }
    const after = clone(a.state);
    assert.equal(a.hook("Output", output), visible);
    assert.deepEqual(a.state, after);
  }
});
test("missing identity/orphaned command fails closed for force instead of firing a normal event", () => {
  const a = new Adventure([event("one")], { noHistory: true });
  a.hook("Input", "/lep forceEvent = one", { actionCount: undefined });
  assert.ok(a.hook("Output", "MODEL", { actionCount: undefined }).includes("Cannot safely identify"));
  assert.equal(a.ep, undefined);
  const b = new Adventure([event("one")]);
  b.history.push({ type: "do", text: "/lep forceEvent = one" });
  assert.ok(b.hook("Output", "MODEL").includes("no recoverable receipt"));
  assert.equal(b.ep, undefined);
});
test("console bookkeeping is bounded and does not displace real-event checkpoints", () => {
  const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }] })]);
  a.control("/lep forceEvent = one");
  const checkpoint = clone(a.ep.checkpoints);
  for (let i = 0; i < 20; i++) a.control("/lep help");
  assert.equal(a.state.lepConsole.receipts.length, 16);
  assert.deepEqual(a.ep.checkpoints, checkpoint);
  assert.equal(a.ep.enabledTurns, 1);
  a.history = clone(a.savedSlots[0].history);
  assert.equal(a.hook("Output", "RETRY"), "Authored one.");
  assert.equal(a.ep.variables.score, 1);
  assert.ok(JSON.stringify(a.state.lepConsole).length < 30000);
});
test("Undo to a forced output preserves bounded engine reconciliation without reapplying effects", () => {
  const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }] }),
    event("two", { effects: [{ path: "score", op: "add", value: 10 }], nextChapter: "next" })]);
  a.control("/lep forceEvent = one");
  a.turn();
  assert.equal(a.ep.variables.score, 11);
  a.history = clone(a.savedSlots[0].history);
  assert.equal(a.hook("Output", "RETRY"), "Authored one.");
  assert.equal(a.ep.variables.score, 1);
  assert.equal(a.ep.chapter, "start");
  assert.deepEqual(a.ep.completedEvents, ["one"]);
});
test("console force still succeeds if optional Story Card writes fail", () => {
  const a = new Adventure([event("one", { memory: { summary: "Maya knows.", character: "Maya" } })]);
  a.configure({ memoryMode: "full", autoCharacterCards: true, journalEnabled: true });
  a.options.failAdd = true;
  assert.equal(a.control("/lep forceEvent = one").visible, "Authored one.");
  assert.deepEqual(a.ep.completedEvents, ["one"]);
  assert.equal(a.ep.eventLog.length, 1);
});
test("Retry cannot convert a console preview into force even if Input is changed", () => {
  const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }] })], { rawInputHistory: true });
  a.configure({ debug: false });
  const before = storyState(a);
  const preview = a.control("/lep testEvent = one").visible;
  a.history = clone(a.savedSlots[0].history);
  a.hook("Input", "/lep forceEvent = one");
  assert.equal(a.hook("Output", "RETRY"), preview);
  assert.deepEqual(storyState(a), before);
});
test("console preview on a restored Retry does not create progress or touch existing mirrors", () => {
  const a = new Adventure([event("one", { effects: [{ path: "score", op: "add", value: 1 }], memory: { summary: "Maya knows.", character: "Maya" } })]);
  a.configure({ memoryMode: "full", autoCharacterCards: true, journalEnabled: true, debug: false });
  const before = storyState(a), cards = clone(a.cards);
  const preview = a.control("/lep testEvent = one").visible;
  for (let i = 0; i < 3; i++) assert.equal(a.retry("RETRY", true), preview);
  assert.deepEqual(storyState(a), before);
  assert.deepEqual(worldCards(a.cards), worldCards(cards));
});
test("console works with original v1 progress missing newer development metadata", () => {
  const a = new Adventure([event("one")]);
  a.configure("enabled=true\ndebug=false");
  delete a.ep.lastCommandRevision;
  const before = storyState(a);
  a.control("/lep testEvent = one");
  assert.deepEqual(storyState(a), before);
  assert.equal(a.control("/lep forceEvent = one").visible, "Authored one.");
  assert.equal(a.ep.version, 1);
  assert.equal(a.ep.lastCommandRevision, undefined);
  assert.deepEqual(a.ep.completedEvents, ["one"]);
});


test("ordinary failed outputs keep all existing Missing Stage Key progress unchanged", () => {
  for (const output of ["", " ", null, undefined, "stop"]) {
    const a = fixtureAdventure();
    a.turn();
    const before = storyState(a);
    a.hook("Input", "Keep looking.");
    a.history.push({ type: "story", text: "Keep looking." });
    a.hook("Output", output);
    assert.deepEqual(storyState(a), before);
    assert.equal(a.ep.enabledTurns, 1);
  }
});
test("set parses all supported JSON values and safe missing parents without debug or revisions", () => {
  const values = ["backstage", true, false, 3, -1.5, null, { place: "office", ready: true }, ["Maya", 2, null]];
  for (const value of values) {
    const a = fixtureAdventure();
    const command = setCommand("choice.details.value", value);
    const result = a.control(command);
    assert.ok(result.visible.includes("Set choice.details.value = " + JSON.stringify(value)));
    assert.deepEqual(a.ep.variables.choice.details.value, value);
    assert.deepEqual(a.ep.variables.key, fixture.start.variables.key);
    assert.equal(a.ep.chapter, "preparation");
    assert.equal(a.ep.enabledTurns, 0);
    assert.equal(a.ep.chapterTurns, 0);
    assert.deepEqual(a.ep.eventLog, []);
    assert.deepEqual(a.ep.memories, []);
    assert.deepEqual(a.ep.completedEvents, []);
    assert.equal(a.ep.lastManualRevision, 0);
    assert.equal(a.ep.lastCommandRevision, 0);
    assert.ok(!result.context.includes("choice.details") && !result.context.includes("backstage"));
    assert.deepEqual(a.state.memory, { context: "USER MEMORY", authorsNote: "USER NOTE" });
  }
  const a = fixtureAdventure();
  assert.ok(a.control(' > You /LEP SET = {"path":"choice.search","value":"office"}. ').visible.includes('"office"'));
});
test("set rejects malformed JSON, missing fields, unsafe paths/values and unknown fields atomically", () => {
  const payloads = ["", "null", "[]", '"word"', '{"path":"choice.search","value":}',
    "{path:'choice.search',value:'office'}", '{"path":"choice.search","value":"office",}',
    '{"path":"choice.search"}', '{"value":"backstage"}', '{"path":3,"value":true}',
    '{"path":"key.found","value":false,"extra":true}', '{"path":"key.found","value":1e999}',
    JSON.stringify({ path: "choice.search", value: "office", ["[/LEP Console]" + "x".repeat(10000)]: true }),
    '{"path":"choice.details","value":{"__proto__":{"polluted":true}}}',
    '{"path":"choice.details","value":{"nested":{"constructor":{}}}}',
    '{"path":"choice.details","value":{"prototype":true}}'];
  const paths = ["", ".key", "key..found", "key[0]", "key.0", "key.bad-name", "key.__proto__.polluted",
    "constructor.prototype.polluted", "__proto__", "choice." + "x".repeat(160), "a.b.c.d.e.f.g.h.i"];
  for (const path of paths) payloads.push(JSON.stringify({ path, value: true }));
  for (const value of ["x".repeat(2001), Array(65).fill(1), {a:{b:{c:{d:{e:{f:{g:{h:1}}}}}}}}]) payloads.push(JSON.stringify({ path: "choice.details", value }));
  payloads.push(JSON.stringify({ path: "choice.details", value: "x".repeat(13000) }));
  for (const payload of payloads) {
    const a = fixtureAdventure();
    const before = storyState(a);
    const result = a.control("/lep set = " + payload);
    assert.ok(result.visible.includes("Use /lep help"), payload.slice(0, 200));
    assert.deepEqual(storyState(a), before);
    assert.equal(a.ep, undefined);
    assert.ok(result.visible.length < 1000);
    assert.ok(JSON.stringify(a.state.lepConsole).length < 2000);
    assert.equal(a.retry(""), result.visible);
    assert.deepEqual(storyState(a), before);
  }
});
test("set rejects engine state roots while allowing ordinary nested creator fields", () => {
  const roots = ["state", "lep", "lepConsole", "variables", "version", "chapter", "completedEvents",
    "enabledTurns", "chapterTurns", "counters", "eventLog", "repeatTurns", "memories", "characters",
    "lastManualRevision", "lastCommandRevision", "checkpoints", "recoveryRequired"];
  for (const root of roots) {
    const a = fixtureAdventure();
    a.turn();
    const before = storyState(a);
    assert.ok(a.control(setCommand(root + (root === "state" ? ".lep.chapter" : ""), "ready")).visible.includes("Reserved engine path"));
    assert.deepEqual(storyState(a), before);
  }
  const a = fixtureAdventure();
  a.control(setCommand("choice.chapter", "a creator label"));
  assert.equal(a.ep.variables.choice.chapter, "a creator label");
  assert.equal(a.ep.chapter, "preparation");
});
test("set enforces the final tree's storage, depth and key limits and rejects scalar/array traversal", () => {
  const a = fixtureAdventure();
  a.control(setCommand("choice.details", [1, 2]));
  for (const path of ["key.found.child", "choice.details.child"]) {
    const before = storyState(a);
    assert.ok(a.control(setCommand(path, true)).visible.includes("Path crosses a scalar or array"));
    assert.deepEqual(storyState(a), before);
  }
  a.control(setCommand("choice.details", { a: "x".repeat(2000), b: "x".repeat(2000), c: "x".repeat(2000), d: "x".repeat(1800) }));
  assert.equal(a.ep.variables.choice.details.a.length, 2000);
  let before = storyState(a);
  assert.ok(a.control(setCommand("choice.overflow", "x".repeat(600))).visible.includes("Variables exceed 8192"));
  assert.deepEqual(storyState(a), before);
  assert.ok(a.control(setCommand("choice.overflow", Array(5).fill("x".repeat(1800)))).visible.includes("storage limits"));
  assert.deepEqual(storyState(a), before);
  const b = fixtureAdventure();
  before = storyState(b);
  assert.ok(b.control(setCommand("choice.a.b.c.d.e.f", { child: {} })).visible.includes("depth or key limits"));
  assert.deepEqual(storyState(b), before);
  b.control(setCommand("choice.details", Object.fromEntries(Array.from({length:64}, (_, i) => ["key" + i, false]))));
  before = storyState(b);
  assert.ok(b.control(setCommand("choice.details.extra", false)).visible.includes("depth or key limits"));
  assert.deepEqual(storyState(b), before);
});
test("set uses literal values and bounded JSON confirmations", () => {
  const a = fixtureAdventure();
  const value = { text: '"$& ${globalThis.polluted=true} `code` \\ \n# = ' + "x".repeat(1100) };
  const result = a.control(setCommand("choice.details", value));
  assert.deepEqual(a.ep.variables.choice.details, value);
  assert.ok(result.visible.includes("display truncated; full value saved"));
  assert.ok(result.visible.length < 1300);
});
test("set survives retained-state and restored-state Retry with raw or modified history", () => {
  for (const rawInputHistory of [false, true]) for (const rollback of [false, true]) {
    const a = fixtureAdventure({ rawInputHistory });
    a.turn(); a.turn();
    const visible = a.control(setCommand("choice.search", "backstage")).visible;
    const before = storyState(a), cards = clone(a.cards), calls = clone(a.calls);
    const sequence = a.state.lepConsole.sequence;
    for (let i = 0; i < 3; i++) assert.equal(a.retry("", rollback), visible);
    assert.deepEqual(storyState(a), before);
    assert.deepEqual(worldCards(a.cards), worldCards(cards));
    assert.deepEqual(a.calls, calls);
    assert.equal(a.state.lepConsole.sequence, sequence);
    assert.equal(a.ep.enabledTurns, 2);
  }
});
test("set Retry does not rewrite an already committed value or repurpose the original request", () => {
  const a = fixtureAdventure({ rawInputHistory: true });
  const command = setCommand("choice.search", "backstage");
  const visible = a.control(command).visible;
  a.ep.variables.choice.search = "office"; // Simulate another script's later write.
  assert.equal(a.retry("stop"), visible);
  assert.equal(a.ep.variables.choice.search, "office");
  a.history = clone(a.savedSlots[0].history);
  a.hook("Input", setCommand("choice.search", "undecided"));
  assert.equal(a.hook("Output", ""), visible);
  assert.equal(a.ep.variables.choice.search, "office");
  assert.equal(a.ep.checkpoints.length, 1);
});
test("set Retry can rerun Input with restored or retained before-Input state", () => {
  for (const rollback of [false, true]) {
    const a = fixtureAdventure();
    const beforeState = clone(a.state), beforeHistory = clone(a.history);
    const command = setCommand("choice.search", "backstage");
    const first = a.control(command).visible;
    const after = clone(a.state);
    a.history = beforeHistory;
    if (rollback) a.state = beforeState;
    assert.equal(a.control(command).visible, first);
    assert.deepEqual(a.state, after);
    assert.equal(a.ep.checkpoints.length, 1);
  }
});
test("new set actions need no revisions and a later Continue evaluates their stored values", () => {
  const a = fixtureAdventure();
  fixtureThroughClue(a);
  a.control(setCommand("choice.search", "backstage"));
  a.control(setCommand("choice.search", "backstage"));
  a.control(setCommand("choice.search", "office"));
  assert.equal(a.state.lepConsole.sequence, 3);
  assert.equal(a.ep.enabledTurns, 4);
  assert.equal(a.ep.eventLog.length, 4);
  assert.equal(a.hook("Output", "CONTINUED"), fixtureEvent("find_key_office").text);
  assert.equal(a.ep.variables.key.finder, "Julia");
});
test("set checkpoints survive console receipt rotation and reconcile a later ordinary event Undo", () => {
  const a = fixtureAdventure();
  fixtureThroughClue(a);
  const visible = a.control(setCommand("choice.search", "backstage")).visible;
  const setSlot = clone(a.savedSlots[4]);
  for (let i = 0; i < 20; i++) a.control("/lep help");
  a.history = clone(setSlot.history);
  assert.equal(a.hook("Output", ""), visible);
  assert.equal(a.ep.variables.choice.search, "backstage");
  a.history.push({ type: "continue", text: visible });
  assert.equal(a.turn().visible, fixtureEvent("find_key_backstage").text);
  a.history = clone(setSlot.history);
  assert.equal(a.hook("Output", ""), visible);
  assert.equal(a.ep.chapter, "search");
  assert.equal(a.ep.variables.key.found, false);
  assert.equal(a.ep.variables.choice.search, "backstage");
  assert.equal(a.ep.enabledTurns, 4);
});
test("set blocked while paused, including Retry; re-enabling requires a new blocked command action", () => {
  const card = {id:1,keys:CONFIG,type:CONFIG_TYPE,entry:"enabled=false"};
  const a = fixtureAdventure({cards:[card]});
  const before = storyState(a), cards = clone(a.cards);
  const command = setCommand("choice.search", "backstage");
  const paused = a.control(command).visible;
  assert.ok(paused.includes("paused (enabled=false)") && paused.includes("Enable it"));
  assert.deepEqual(storyState(a), before);
  assert.deepEqual(worldCards(a.cards), worldCards(cards));
  a.configure({enabled:true});
  assert.equal(a.retry(""), paused);
  assert.deepEqual(storyState(a), before);
  a.control(command);
  assert.equal(a.ep.variables.choice.search, "backstage");
  a.configure({enabled:false});
  const saved = storyState(a);
  assert.ok(a.retry("").includes("paused"));
  assert.deepEqual(storyState(a), saved);
});
test("set cannot initialize/change progress without identity, with corrupt state, or during recovery", () => {
  const a = fixtureAdventure({noHistory:true});
  a.hook("Input", setCommand("choice.search", "backstage"), {actionCount:undefined});
  assert.ok(a.hook("Output", "", {actionCount:undefined}).includes("Cannot safely identify"));
  assert.equal(a.ep, undefined);
  for (const corrupt of [false, true]) {
    const b = fixtureAdventure(); b.turn();
    if (corrupt) b.ep.variables = null;
    else b.ep.recoveryRequired = true;
    const before = storyState(b);
    const visible = b.control(setCommand("choice.search", "backstage")).visible;
    assert.ok(visible.includes(corrupt ? "Incompatible LEP state" : "needs recovery"));
    assert.deepEqual(storyState(b), before);
  }
});
test("set does not consume legacy commands or revisions, sync mirrors, or change v0.2 progress schema", () => {
  const a = fixtureAdventure();
  a.configure({debug:true,memoryMode:"full",autoCharacterCards:true,journalEnabled:true,
    manualSet:{revision:11,path:"choice.search",value:"office"},commandRevision:12,forceEvent:"key_goes_missing"});
  a.ep.lastManualRevision = 7; a.ep.lastCommandRevision = 8;
  const before = clone(a.ep), cards = clone(a.cards), calls = clone(a.calls);
  a.control(setCommand("choice.search", "backstage"));
  before.variables.choice.search = "backstage"; before.checkpoints = clone(a.ep.checkpoints);
  assert.deepEqual(a.ep, before);
  assert.deepEqual(worldCards(a.cards), worldCards(cards)); assert.deepEqual(a.calls, calls);
  assert.ok(a.logs.some(line => line.includes("variable changed; no events evaluated or turns advanced")));
  assert.ok(a.turn().visible.endsWith(fixtureEvent("key_goes_missing").text));
  assert.equal(a.ep.lastCommandRevision, 12);
  assert.equal(a.ep.lastManualRevision, 7);
  fixtureStep(a, "prep_checklist", "preparation", 2);
  assert.equal(a.ep.lastManualRevision, 11);
  fixtureStep(a, "search_team_forms", "search", 0);
  fixtureStep(a, "first_clue", "search", 1);
  assert.equal(a.turn().visible, fixtureEvent("find_key_office").text);
  assert.equal(a.ep.lastManualRevision, 11);
  assert.equal(a.ep.version, 1);
});
test("clean generated/imported defaults contain only eight settings and never rewrite old cards", () => {
  const a = fixtureAdventure(); a.control("/lep help");
  const lines = a.cards[0].entry.split("\n").filter(line => line && !line.startsWith("#"));
  assert.deepEqual(lines, ["enabled = true", "memoryMode = compact", "memoryBudget = 120", "autoCharacterCards = false", "journalEnabled = false", "autoCardsEnabled = false", "innerSelfEnabled = false", "debug = false"]);
  const legacy = 'enabled=true\ndebug=true\nmanualSet=\ncommandRevision=4\ntestEvent=find_key_backstage\nforceEvent=festival_opens';
  a.configure(legacy);
  const before = storyState(a);
  assert.equal(a.turn().visible, fixtureEvent("find_key_backstage").text);
  assert.equal(a.ep.lastCommandRevision, 4);
  assert.equal(a.ep.enabledTurns, 0);
  assert.deepEqual(a.ep.variables, fixture.start.variables);
  assert.equal(a.cards[0].entry, legacy);
  assert.equal(before.lep, undefined);
});
test("supplied backstage preview preserves every progress field while bypassing wrong chapter and completion", () => {
  const a = fixtureAdventure();
  a.configure({debug:false,memoryMode:"full",autoCharacterCards:true,journalEnabled:true});
  a.ep.completedEvents.push("find_key_backstage");
  const before = storyState(a), cards = clone(a.cards), calls = clone(a.calls);
  for (let i = 0; i < 3; i++) {
    const visible = a.control("/lep testEvent = find_key_backstage").visible;
    assert.equal(visible, "[LEP Console]\nPreview: find_key_backstage — LEP progress unchanged\n\n" + fixtureEvent("find_key_backstage").text + "\n[/LEP Console]");
  }
  assert.deepEqual(storyState(a), before);
  assert.deepEqual(worldCards(a.cards), worldCards(cards)); assert.deepEqual(a.calls, calls);
});
test("supplied forced backstage event commits exact prose/effects/memory and bypasses completion on reissue", () => {
  for (const rollback of [false,true]) {
    const a = fixtureAdventure();
    a.configure({debug:false,memoryMode:"full",autoCharacterCards:true,journalEnabled:true});
    a.ep.completedEvents.push("find_key_backstage");
    assert.equal(a.control("/lep forceEvent = find_key_backstage").visible, fixtureEvent("find_key_backstage").text);
    assert.equal(a.ep.variables.key.found,true);
    assert.equal(a.ep.variables.key.finder,"Maya");
    assert.equal(a.ep.variables.key.missing,false); // Forcing does not invent earlier effects.
    assert.equal(a.ep.variables.choice.search,"undecided");
    assert.equal(a.ep.chapter,"recovery");
    assert.equal(a.ep.chapterTurns,0);
    assert.equal(a.ep.memories[0].summary,fixtureEvent("find_key_backstage").memory.summary);
    assert.equal(a.ep.characters[0].name,"Maya");
    assert.ok(a.cards.some(card=>card.keys===JOURNAL));
    assert.ok(a.cards.some(card=>card.type===CHAR_TYPE));
    const before=storyState(a);
    assert.equal(a.retry("",rollback),fixtureEvent("find_key_backstage").text);
    assert.deepEqual(storyState(a),before);
    a.control("/lep forceEvent = find_key_backstage");
    assert.equal(a.ep.enabledTurns,2);
    assert.equal(a.ep.eventLog.length,2);
    assert.deepEqual(a.ep.completedEvents,["find_key_backstage"]);
  }
});
test("set payloads and confirmations are removed from later context with raw or placeholder history", () => {
  for (const rawInputHistory of [false,true]) {
    const a=fixtureAdventure({rawInputHistory});
    a.control(setCommand("choice.search","backstage"));
    const result=a.turn("Keep working.");
    assert.ok(!result.context.includes('/lep set'));
    assert.ok(!result.context.includes('Set choice.search'));
    assert.ok(!result.context.includes('"path"'));
    assert.ok(!result.context.includes('[LEP Console'));
    assert.deepEqual(a.state.memory,{context:"USER MEMORY",authorsNote:"USER NOTE"});
  }
});


test("set confirmation safely frames literal console markers without changing the stored JSON", () => {
  for (const rawInputHistory of [false, true]) {
    const a = fixtureAdventure({rawInputHistory});
    const value = '[/LEP Console]PRIVATE_VALUE[LEP Console]';
    const result = a.control(setCommand("choice.details", value));
    assert.equal(a.ep.variables.choice.details, value);
    assert.ok(result.visible.includes('\\u005b/LEP Console]'));
    const context = a.turn("Continue preparing.").context;
    assert.ok(!context.includes('PRIVATE_VALUE'));
    assert.ok(!context.includes('Set choice.details'));
  }
});
test("set Retry beyond retained progress checkpoints refuses to restore the wrong zero-turn state", () => {
  const a = fixtureAdventure();
  for (let i = 0; i < 9; i++) a.control(setCommand("choice.search", "revision_" + i));
  assert.equal(a.ep.enabledTurns, 0);
  assert.equal(a.ep.checkpoints.length, 6);
  const before = storyState(a);
  a.history = clone(a.savedSlots[0].history);
  assert.ok(a.hook("Output", "").includes("no recoverable progress checkpoint"));
  assert.deepEqual(storyState(a), before);
  // An edited branch with no matching old receipt must not restore the oldest
  // remaining (already-mutated) variables as though they were LEP_START.
  a.history = [{type:"start",text:"Edited earlier branch."}];
  assert.ok(a.control(setCommand("choice.search", "office")).visible.includes("needs recovery"));
  assert.deepEqual(storyState(a), before);
});

// v0.3 registry and adapted Auto-Cards integration tests. No real model calls.
const dynamicSource = fs.readFileSync(path.join(__dirname, "fixtures/dynamic-entities.js"), "utf8");
const dynamic = clone(new vm.Script(dynamicSource + "\n({start:LEP_START,chapters:LEP_CHAPTERS,events:LEP_EVENTS})").runInNewContext({}));
const chloeCard = (id=11, extra={}) => ({id,keys:"Chloe Parker,Chloe",type:"Character",entry:"Chloe Parker repairs stage lights.",...extra});
const cafeCard = (id=12, extra={}) => ({id,keys:"Moonlight Cafe",type:"Location",entry:"Moonlight Cafe is beside the theater.",...extra});
const dynamicAdventure = options => new Adventure(dynamic.events, {start:dynamic.start,chapters:dynamic.chapters,...options});
const activeEntities = a => a.ep.entities.items.filter(item=>item.active);
function automaticAdventure(options={}) {
  const a = new Adventure([], options);
  a.configure({autoCardsEnabled:true,debug:true,...options.config});
  if (options.fast) a.source += "\nLEP_AC_LIMITS.cooldown=1; LEP_AC_LIMITS.updateCooldown=2;";
  return a;
}
function seedCandidate(a, name="Chloe Parker") {
  a.turn("Go on.", "You meet " + name + " near the entrance.");
  a.turn("Go on.", "You notice " + name + " beside the stage.");
}
function cardOutput(a, type="Character", extra={}, narrative="The ordinary scene continues.") {
  return () => {
    const task=a.state.lepAutoCards.pending;
    assert.ok(task, "Context should have scheduled a card task");
    return narrative + (narrative ? "\n" : "") + task.marker + JSON.stringify({name:task.name,type,keys:[task.name],entry:task.name+" is established in the recent story.",...extra}) + "[/LEP_AUTOCARDS]";
  };
}
function startTask(a) {
  a.hook("Input","Look around.");
  a.history.push({type:"story",text:"Look around."});
  const context=a.hook("Context","MEM\n"+a.history.map(item=>item.text).join("\n"));
  assert.ok(a.state.lepAutoCards.pending);
  return context;
}

test("v0.3 defaults opt out of Auto-Cards and include the exact debugging comment",()=>{
  const a=dynamicAdventure({cards:[chloeCard(),cafeCard()]});
  a.turn(); a.turn(); a.turn();
  assert.equal(a.state.lepAutoCards,undefined);
  assert.equal(a.calls.add,1); assert.equal(a.calls.update,0);
  assert.equal(activeEntities(a).length,2);
  assert.equal(a.ep.variables.relationship.status,"single");
  assert.equal(a.ep.variables.relationship.partner,null);
  const config=a.cards.find(card=>card.keys===CONFIG);
  assert.ok(config.entry.includes("autoCardsEnabled = false"));
  assert.ok(config.entry.includes("# true / false. Bounded scripting-console logs; /lep commands do not require debug."));
  a.configure("enabled=true\nautoCardsEnabled=yes\ndebug=true");
  a.turn(); assert.equal(a.state.lepAutoCards,undefined);
  assert.ok(a.logs.some(line=>line.includes("Invalid boolean: autoCardsEnabled")));
});
test("registry recognizes case-insensitive creator types without rewriting cards or using Notes/title",()=>{
  const cards=[chloeCard(1,{type:"cHaRaCtEr",title:"WRONG UI NAME",description:"Ignored"}),cafeCard(2,{type:"location"}),
    chloeCard(3,{keys:"Guild",type:"Faction"}),chloeCard(4,{keys:"Thing",type:"Class"}),
    chloeCard(5,{keys:"__LEP_CHARACTER_V1__Maya"}),chloeCard(6,{keys:"Notes name,unrelated alias"}),
    chloeCard(7,{keys:"",title:"Name only"})];
  const a=dynamicAdventure({cards}); a.turn();
  assert.deepEqual(activeEntities(a).map(item=>[item.name,item.type,item.source]),[["Chloe Parker","Character","creator"],["Moonlight Cafe","Location","creator"]]);
  assert.deepEqual(a.cards.slice(0,cards.length),cards); assert.equal(a.calls.update,0);
  assert.ok(!JSON.stringify(a.ep.entities).includes("repairs stage lights"));
  assert.ok(!a.turn().context.includes("entity_c1"));
});
test("registry IDs stay stable on numeric card reorder/rename and duplicate names remain separate",()=>{
  const a=dynamicAdventure({cards:[chloeCard(1,{keys:"Alex"}),chloeCard(2,{keys:"Alex"})]}); a.turn();
  assert.deepEqual(activeEntities(a).map(item=>item.id),["entity_c1","entity_c2"]);
  a.cards.reverse(); a.cards.find(card=>card.id===1).keys="Alex Rivera,Alex";
  a.turn();
  assert.equal(activeEntities(a).find(item=>item.cardId===1).id,"entity_c1");
  assert.equal(activeEntities(a).find(item=>item.cardId===1).name,"Alex Rivera");
  assert.equal(activeEntities(a).length,2);
  a.control(setCommand("relationship.partner","Alex"));
  a.control(setCommand("relationship.status","dating"));
  assert.equal(a.turn().visible,"The ordinary scene continues.");
  a.control(setCommand("relationship.partner","entity_c1"));
  assert.ok(a.turn().visible.includes("dating Alex Rivera"));
});
test("ambiguous missing-ID cards are skipped; a unique trigger fingerprint survives reorder",()=>{
  const a=dynamicAdventure({cards:[chloeCard(undefined,{id:undefined}),cafeCard(undefined,{id:undefined})]});
  a.turn(); const first=activeEntities(a).map(item=>[item.name,item.id]);
  a.cards.reverse(); a.turn();
  assert.deepEqual(activeEntities(a).map(item=>[item.name,item.id]).sort(),first.sort());
  assert.ok(first.every(item=>item[1].startsWith("entity_k")));
  a.cards.push(chloeCard(undefined,{id:undefined})); a.turn();
  assert.ok(!activeEntities(a).some(item=>item.name==="Chloe Parker"));
});
test("registry migration is additive; old v1 progress and old checkpoints do not reset",()=>{
  const a=fixtureAdventure({cards:[chloeCard()]}); a.turn();
  delete a.ep.entities;
  const before=clone(a.ep); a.hook("Input","Inspect.");
  const migrated=clone(a.ep); delete migrated.entities;
  assert.deepEqual(migrated,before);
  assert.equal(a.ep.version,1); assert.equal(a.ep.entities.version,1);
  assert.equal(activeEntities(a)[0].id,"entity_c11");
  assert.ok(a.turn().visible.endsWith(fixtureEvent("key_goes_missing").text));
});
test("entity console is read-only, paused-friendly, bounded, and supports blank/stop output",()=>{
  for (const output of ["", " ", null, undefined,"stop"]) {
    const a=dynamicAdventure({cards:[chloeCard(),cafeCard(),{id:9,keys:CONFIG,type:CONFIG_TYPE,entry:"enabled=false\nautoCardsEnabled=true"}]});
    const before=storyState(a),cards=clone(a.cards),calls=clone(a.calls);
    const marker=a.hook("Input","/lep entities");a.history.push({type:"do",text:marker});
    const visible=a.hook("Output",output);
    assert.ok(visible.includes("entity_c11 — Chloe Parker")); assert.ok(visible.includes("entity_c12 — Moonlight Cafe"));
    assert.ok(visible.includes("Entity count: 2"));assert.ok(visible.includes("creation: enabled (engine paused)"));
    assert.ok(!visible.includes(chloeCard().entry));
    assert.deepEqual(storyState(a),before);assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.deepEqual(a.calls,calls);
  }
  const a=dynamicAdventure();
  assert.ok(a.control("/lep entities").visible.includes("None registered"));
  assert.ok(a.control("/lep help").visible.includes("/lep entities"));
});
test("deleted entity fails lookup without changing its creator reference or recreating the card",()=>{
  const a=dynamicAdventure({cards:[chloeCard()]});a.turn();
  a.control(setCommand("relationship.partner","entity_c11"));a.control(setCommand("relationship.status","dating"));
  a.cards=a.cards.filter(card=>card.id!==11);
  assert.equal(a.turn().visible,"The ordinary scene continues.");
  assert.equal(a.ep.variables.relationship.partner,"entity_c11");
  assert.equal(a.ep.entities.items[0].active,false);
  assert.equal(a.calls.add,1);
});
test("registry bounds cap count/serialized size and unknown registry versions fail without reset",()=>{
  const cards=Array.from({length:100},(_,i)=>chloeCard(i+1,{keys:"Person "+i}));
  const a=new Adventure([],{cards});a.turn();
  assert.ok(a.ep.entities.items.length<=64);assert.ok(JSON.stringify(a.ep.entities).length<=16384);
  const listing=a.control("/lep entities").visible;
  assert.ok(listing.length<6500);assert.ok(listing.includes("not every item is shown"));
  const prior=clone(a.ep);a.ep.entities.version=99;
  assert.equal(a.turn().visible,"The ordinary scene continues.");
  assert.equal(a.ep.enabledTurns,prior.enabledTurns);
  assert.equal(a.ep.entities.version,99);
  assert.ok(a.control("/lep entities").visible.includes("Incompatible"));
});
test("registeredEntity accepts exact IDs/unambiguous aliases/types and rejects unresolved or wrong types",()=>{
  for (const [reference,type,expected] of [["entity_c11","Character",true],["chloe parker","character",true],["Chloe","Character",true],
    ["entity_c11","Location",false],["entity_c12","LOCATION",true],["Moonlight Cafe","Location",true],
    ["unknown","Character",false],[null,"Character",false],[11,"Character",false]]) {
    const a=new Adventure([event("check",{when:{path:"reference",op:"registeredEntity",value:type}})],{cards:[chloeCard(),cafeCard()]});
    if(reference!==null)a.control(setCommand("reference",reference));
    a.turn();assert.equal(a.ep.completedEvents.includes("check"),expected,JSON.stringify([reference,type]));
  }
  const a=new Adventure([event("invalid_type",{when:{path:"reference",op:"registeredEntity",value:"Faction"}})],{cards:[chloeCard()]});
  assert.ok(!a.control("/lep eventsID").visible.includes("invalid_type"));
  const b=dynamicAdventure({cards:[chloeCard(),cafeCard(12,{keys:"Chloe"})]});
  b.control(setCommand("relationship.partner","Chloe"));b.control(setCommand("relationship.status","dating"));
  assert.equal(b.turn().visible,"The ordinary scene continues.");
});
test("entity interpolation is prefix-opt-in; ordinary interpolation retains its prior opt-in semantics",()=>{
  const text="{{entity:partner}} at {{entity:place}}; literal {{partner}}; unknown {{entity:missing}}.";
  const a=new Adventure([event("line",{text,display:"replace"})],{cards:[chloeCard(),cafeCard()]});
  a.control(setCommand("partner","entity_c11"));a.control(setCommand("place","entity_c12"));
  assert.equal(a.turn().visible,"Chloe Parker at Moonlight Cafe; literal {{partner}}; unknown {{entity:missing}}.");
  const b=new Adventure([event("line",{text,display:"replace",interpolate:true})],{cards:[chloeCard(),cafeCard()]});
  b.control(setCommand("partner","entity_c11"));b.control(setCommand("place","entity_c12"));
  assert.equal(b.turn().visible,"Chloe Parker at Moonlight Cafe; literal entity_c11; unknown {{entity:missing}}.");
  const c=new Adventure([event("line",{text:"{{entity:partner}}",display:"replace"})],{cards:[chloeCard(11,{keys:"Bad\nName"})]});
  c.control(setCommand("partner","entity_c11"));
  assert.ok(!c.turn().visible.includes("\n"));
});
test("dynamic memory uses explicit Character target, retains ordinary summary if unresolved, and rejects both target fields",()=>{
  const a=dynamicAdventure({cards:[chloeCard()]});
  a.control(setCommand("relationship.partner","entity_c11"));a.control(setCommand("relationship.status","dating"));
  const result=a.turn();
  assert.equal(result.visible,"Three weeks have passed since you started dating Chloe Parker. Status: dating.");
  assert.equal(a.ep.characters[0].entityId,"entity_c11");assert.equal(a.ep.characters[0].name,"Chloe Parker");
  assert.ok(!a.cards.some(card=>card.type===CHAR_TYPE));
  for (const reference of ["unknown","entity_c12"]) {
    const b=new Adventure([event("memory",{memory:{summary:"Retain this authored fact.",characterPath:"partner"},effects:[{path:"flags.ready",op:"set",value:true}]})],{cards:[cafeCard()]});
    b.control(setCommand("partner",reference));b.turn();
    assert.equal(b.ep.characters.length,0);assert.equal(b.ep.memories[0].summary,"Retain this authored fact.");assert.equal(b.ep.variables.flags.ready,true);
  }
  const bad=new Adventure([event("bad",{memory:{summary:"Nope.",character:"Maya",characterPath:"partner"}})]);
  assert.ok(!bad.control("/lep eventsID").visible.includes("bad —"));
  assert.equal(bad.turn().visible,"The ordinary scene continues.");
});
test("dynamic mirrors use entity IDs so two identically named Characters cannot overwrite each other",()=>{
  const a=new Adventure([event("memory",{once:false,cooldownTurns:2,memory:{summary:"An authored milestone.",characterPath:"partner"}})],
    {cards:[chloeCard(1,{keys:"Alex"}),chloeCard(2,{keys:"Alex"})]});
  a.configure({memoryMode:"character",autoCharacterCards:true});
  const creators=clone(a.cards.slice(0,2));
  a.control(setCommand("partner","entity_c1"));a.control("/lep forceEvent = memory");
  a.control(setCommand("partner","entity_c2"));a.control("/lep forceEvent = memory");
  assert.equal(a.ep.characters.length,2);
  assert.equal(a.cards.filter(card=>card.type===CHAR_TYPE).length,2);
  assert.deepEqual(a.cards.slice(0,2),creators);
  assert.ok(a.cards.some(card=>card.keys.endsWith("ENTITY_entity_c1")));
  assert.ok(a.cards.some(card=>card.keys.endsWith("ENTITY_entity_c2")));
});
test("set cannot access the new registry or automatic transport namespaces",()=>{
  const a=dynamicAdventure();a.turn();const before=storyState(a);
  for(const path of ["entities", "lepAutoCards", "lepInternalTask", "entities.items"])
    assert.ok(a.control(setCommand(path,{})).visible.includes("Reserved engine path"));
  assert.deepEqual(storyState(a),before);
});

for (const [name,type,expected] of [["Chloe Parker","Character","Character"],["Moonlight Cafe","location","Location"],
  ["Moonlight Token","Other","Class"],["Moonlight Token","uncertain","Class"],["Moonlight Token",{evil:true},"Class"]]) {
  test("Auto-Cards same-task classification: "+JSON.stringify(type)+" -> "+expected,()=>{
    const a=automaticAdventure();seedCandidate(a,name);
    const before=a.ep.enabledTurns;
    const result=a.turn("Go on.",cardOutput(a,type));
    assert.equal(result.visible,"The ordinary scene continues.");assert.ok(!result.visible.includes("LEP_AUTOCARDS"));
    const card=a.cards.find(card=>card.keys===name);assert.ok(card);assert.equal(card.type,expected);
    assert.equal(a.ep.enabledTurns,before+1,"only the ordinary narrative counts");
    assert.equal(a.state.lepAutoCards.pending,null);
    assert.equal(a.ep.eventLog.length,0);
    assert.equal(a.cards.filter(card=>card.keys===CONFIG).length,1);
    assert.ok(!a.cards.some(card=>/Configure Auto-Cards/i.test(card.entry)));
    if(expected==="Class")assert.equal(activeEntities(a).length,0);
    else{assert.equal(activeEntities(a).length,1);assert.equal(activeEntities(a)[0].name,name);assert.equal(activeEntities(a)[0].source,"autocards");assert.equal(activeEntities(a)[0].cardId,card.id);}
    assert.ok(a.logs.some(line=>line.includes("maintenance begin")));
    assert.ok(a.logs.some(line=>line.includes("maintenance end")));
  });
}
test("Auto-Cards classifies during generation and never guesses types from existing generic card prose",()=>{
  const a=automaticAdventure({cards:[chloeCard(11,{type:"Class"})]});seedCandidate(a);
  a.turn();assert.equal(a.state.lepAutoCards.pending,null);
  assert.equal(activeEntities(a).length,0);assert.equal(a.cards.find(card=>card.id===11).type,"Class");
});
test("pure card maintenance output does not advance turns, events, legacy commands or journals",()=>{
  const a=automaticAdventure();seedCandidate(a);
  // Introduce pending legacy work only after Context has prepared its card task.
  startTask(a);const before=clone(a.ep);
  a.configure({autoCardsEnabled:true,debug:true,manualSet:{revision:1,path:"score",value:99},forceEvent:"missing",commandRevision:1,memoryMode:"full",journalEnabled:true});
  const raw=cardOutput(a,"Character",{},"")();
  const response=a.hook("Output",raw);
  assert.ok(response.includes("story progress is unchanged"));
  const after=clone(a.ep);delete after.entities;delete before.entities;
  assert.deepEqual(after,before);assert.equal(a.ep.variables.score,0);assert.equal(a.ep.lastCommandRevision,0);
  assert.equal(activeEntities(a).length,1);assert.ok(!a.cards.some(card=>card.keys===JOURNAL));
  assert.equal(a.state.lepAutoCards.pending,null);
});
test("maintenance-only responses never fire an eligible authored event; normal combined responses fire at most one",()=>{
  const a=automaticAdventure();seedCandidate(a);
  a.source=source([event("due",{minTurns:3})]);
  const result=a.turn("Go on.",cardOutput(a,"Character",{},""));
  assert.ok(result.visible.includes("story progress is unchanged"));assert.equal(a.ep.enabledTurns,2);assert.deepEqual(a.ep.completedEvents,[]);
  assert.ok(a.turn().visible.endsWith("Authored due."));assert.equal(a.ep.enabledTurns,3);
  const b=automaticAdventure();seedCandidate(b);b.source=source([event("due",{minTurns:3,display:"replace"})]);
  assert.equal(b.turn("Go on.",cardOutput(b)).visible,"Authored due.");
  assert.equal(b.ep.eventLog.length,1);assert.equal(activeEntities(b).length,1);
});
test("auto toggle stops tasks without deleting cards/entities and resumes without duplicate creations",()=>{
  const a=automaticAdventure();seedCandidate(a);a.turn("Go on.",cardOutput(a));
  const cards=clone(a.cards.filter(card=>card.keys!==CONFIG&&card.keys!==STATUS_KEY)),ids=activeEntities(a).map(item=>item.id);
  a.configure({autoCardsEnabled:false});
  for(let i=0;i<3;i++)a.turn("Continue.","You meet Chloe Parker again.");
  assert.equal(a.state.lepAutoCards.pending,null);
  assert.deepEqual(a.cards.filter(card=>card.keys!==CONFIG&&card.keys!==STATUS_KEY),cards);assert.deepEqual(activeEntities(a).map(item=>item.id),ids);
  a.configure({autoCardsEnabled:true});a.turn();
  assert.deepEqual(activeEntities(a).map(item=>item.id),ids);assert.equal(a.cards.filter(card=>card.keys==="Chloe Parker").length,1);
});
test("disabling the engine or Auto-Cards between Context and Output cancels an outstanding write",()=>{
  for(const settings of [{enabled:false,autoCardsEnabled:true},{enabled:true,autoCardsEnabled:false}]) {
    const a=automaticAdventure();seedCandidate(a);startTask(a);const raw=cardOutput(a,"Character",{},"")();const before=clone(a.ep);
    a.configure(settings);a.hook("Output",raw);
    assert.deepEqual(a.ep,before);assert.equal(worldCards(a.cards).length,1);assert.equal(a.state.lepAutoCards.pending,null);
  }
});
test("console capture takes precedence over automatic work and a set is never consumed as story or card text",()=>{
  const a=automaticAdventure();seedCandidate(a);startTask(a);
  const result=a.control(setCommand("flags.ready",true));
  assert.ok(result.visible.includes("Set flags.ready = true"));assert.ok(!result.context.includes("background card task"));
  assert.equal(a.ep.enabledTurns,2);assert.equal(a.ep.variables.flags.ready,true);assert.equal(worldCards(a.cards).length,1);assert.equal(a.state.lepAutoCards.pending,null);
  assert.ok(a.control("/lep entities").visible.includes("creation: enabled"));
  assert.equal(a.ep.enabledTurns,2);
});
test("Auto-Cards honors context headroom and never truncates player Memory or story to fit a task",()=>{
  const a=automaticAdventure();seedCandidate(a);
  a.hook("Input","Go on.");a.history.push({type:"story",text:"Go on."});
  const text="MEM\n"+"x".repeat(500);
  assert.equal(a.hook("Context",text,{maxChars:text.length}),text);
  assert.equal(a.state.lepAutoCards.pending,null);
  assert.deepEqual(a.state.memory,{context:"USER MEMORY",authorsNote:"USER NOTE"});
});
test("owned card updates keep canonical type/stable registry ID and never create duplicate cards",()=>{
  const a=automaticAdventure({fast:true});seedCandidate(a);a.turn("Go on.",cardOutput(a));
  const id=activeEntities(a)[0].id,cardId=activeEntities(a)[0].cardId;
  a.turn("Go on.","You see Chloe Parker working.");
  a.turn("Go on.",cardOutput(a,"Location",{keys:["Chloe Parker","Chloe"],entry:"Chloe Parker now manages the stage lighting."}));
  const card=a.cards.find(card=>card.id===cardId);
  assert.equal(card.type,"Character");assert.ok(card.entry.endsWith("manages the stage lighting."));
  assert.equal(activeEntities(a).length,1);assert.equal(activeEntities(a)[0].id,id);
  assert.ok(activeEntities(a)[0].aliases.includes("Chloe"));assert.equal(a.calls.update,1);
});
test("creator cards and manually edited owned cards are never overwritten/adopted implicitly",()=>{
  const a=automaticAdventure({cards:[chloeCard()]});seedCandidate(a);a.turn();assert.equal(a.calls.update,0);assert.equal(worldCards(a.cards).length,2);
  const b=automaticAdventure({fast:true});seedCandidate(b);b.turn("Go on.",cardOutput(b));
  const card=b.cards.find(card=>card.keys==="Chloe Parker");card.entry+="\nCreator correction.";
  b.turn();b.turn();assert.equal(b.calls.update,0);assert.ok(card.entry.endsWith("Creator correction."));
});
test("Auto-Cards card creation handles documented index semantics, odd returns and delayed snapshots",()=>{
  for(const returnType of ["index","false","string","object","undefined"])for(const delayCards of [false,true]){
    const a=automaticAdventure({returnType,delayCards});seedCandidate(a);
    a.turn("Go on.",cardOutput(a));
    assert.equal(a.cards.filter(card=>card.keys==="Chloe Parker").length,1);
    if(!delayCards||returnType==="index")assert.equal(activeEntities(a).length,1,"immediate registration on confirmable write");
    const turns=a.ep.enabledTurns;
    a.turn();assert.equal(activeEntities(a).length,1);
    assert.equal(a.ep.enabledTurns,turns+1);
    assert.equal(new Set(a.ep.entities.items.map(item=>item.id)).size,a.ep.entities.items.length);
    if(!delayCards||returnType==="index")assert.equal(a.state.lepAutoCards.owned[0].cardId,a.cards.find(card=>card.keys==="Chloe Parker").id);
    // An unconfirmable write may safely register as creator on a later rescan,
    // but never guesses an ID/ownership from an undocumented return shape.
  }
});
test("Auto-Cards Retry reuses a card/registry record under retained/restored state profiles",()=>{
  for(const rollback of [false,true])for(const rawInputHistory of [false,true]){
    const a=automaticAdventure({rawInputHistory});seedCandidate(a);
    let raw;a.turn("Go on.",()=>raw=cardOutput(a)());
    const before=clone(a.state),cards=clone(a.cards),calls=clone(a.calls);
    for(let i=0;i<3;i++)assert.equal(a.retry(raw,rollback),"The ordinary scene continues.");
    assert.deepEqual(a.state,before);assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.deepEqual(a.calls,calls);
    assert.equal(activeEntities(a).length,1);assert.equal(a.ep.enabledTurns,3);
  }
});
test("a stale/Undo automatic task releases its phase and never locks future story or controls",()=>{
  const a=automaticAdventure();seedCandidate(a);startTask(a);
  a.history=[{type:"start",text:"A changed older branch."}];
  a.hook("Output","Ordinary branch text.");assert.equal(a.state.lepAutoCards.pending,null);
  assert.ok(a.control("/lep help").visible.includes("/lep entities"));
  assert.equal(worldCards(a.cards).length,1);
});
test("malformed model card output is bounded, never evaluates code, and releases maintenance reliably",()=>{
  const payloads=["{",'null','{"name":"Chloe Parker","type":"Character","keys":["Chloe Parker"],"entry":"ok","state":{"polluted":true}}',
    '{"name":"Chloe Parker","type":"Character","keys":["__proto__"],"entry":"bad"}',
    JSON.stringify({name:"Different Person",type:"Character",keys:["Different Person"],entry:"Wrong identity."}),
    JSON.stringify({name:"Chloe Parker",type:"Character",keys:["Chloe Parker"],entry:"x".repeat(1001)}),
    "x".repeat(7000)];
  for(const payload of payloads){
    const a=automaticAdventure();seedCandidate(a);startTask(a);const before=clone(a.ep);
    const marker=a.state.lepAutoCards.pending.marker;
    const response=a.hook("Output",marker+payload+"[/LEP_AUTOCARDS]");
    assert.ok(response.includes("story progress is unchanged"));assert.deepEqual(a.ep,before);
    assert.equal(a.state.polluted,undefined);assert.equal(worldCards(a.cards).length,1);assert.equal(a.state.lepAutoCards.pending,null);
  }
  const a=automaticAdventure();seedCandidate(a);startTask(a);
  const response=a.hook("Output",JSON.stringify({name:"Chloe Parker",type:"Character",entry:"Unframed private task."}));
  assert.ok(!response.includes("Unframed private task"));assert.equal(a.ep.enabledTurns,2);
});
test("card API failures retain ordinary story, commit no false registration, and release task state",()=>{
  const a=automaticAdventure();seedCandidate(a);a.options.failAdd=true;
  assert.equal(a.turn("Go on.",cardOutput(a)).visible,"The ordinary scene continues.");
  assert.equal(a.ep.enabledTurns,3);assert.equal(activeEntities(a).length,0);assert.equal(a.state.lepAutoCards.pending,null);
  a.options.failAdd=false;assert.ok(a.control("/lep help").visible.includes("/lep entities"));
});
test("Auto-Cards discovery does not assign romance roles; explicit set enables the generic authored event",()=>{
  const a=dynamicAdventure();a.configure({autoCardsEnabled:true,memoryMode:"character",autoCharacterCards:true});
  seedCandidate(a);a.turn("Go on.",cardOutput(a));
  assert.equal(a.ep.variables.relationship.status,"single");assert.equal(a.ep.variables.relationship.partner,null);assert.equal(a.ep.completedEvents.length,0);
  const id=activeEntities(a)[0].id;
  assert.ok(a.control("/lep entities").visible.includes(id));
  a.control(setCommand("relationship.partner",id));a.control(setCommand("relationship.status","dating"));
  assert.equal(a.ep.completedEvents.length,0);
  assert.equal(a.turn().visible,"Three weeks have passed since you started dating Chloe Parker. Status: dating.");
  assert.equal(a.ep.characters[0].entityId,id);assert.equal(a.ep.variables.milestone,true);
  assert.equal(a.cards.filter(card=>card.type==="Character").length,1);assert.equal(a.cards.filter(card=>card.type===CHAR_TYPE).length,1);
});

test("absent Story Card snapshots cannot validate stale cached entity references",()=>{
  const a=dynamicAdventure({cards:[chloeCard()]});a.turn();
  a.control(setCommand("relationship.partner","entity_c11"));a.control(setCommand("relationship.status","dating"));
  const registry=clone(a.ep.entities);a.options.noStoryCards=true;
  assert.equal(a.turn().visible,"The ordinary scene continues.");assert.deepEqual(a.ep.entities,registry);
  assert.ok(a.control("/lep entities").visible.includes("cached identities cannot resolve"));
});
test("registry fingerprint collisions fail closed without overwriting a different identity",()=>{
  const a=new Adventure([],{cards:[chloeCard(undefined,{id:undefined}),cafeCard(undefined,{id:undefined})]});
  a.source+='\nLEP_hash = function () { return "collision"; };';a.turn();
  assert.equal(activeEntities(a).length,1);assert.equal(activeEntities(a)[0].name,"Chloe Parker");
});
test("default-off Auto-Cards preserves literal marker-like narrative and creates no transport state",()=>{
  const a=new Adventure([]);const prose="A label reads [LEP_AUTOCARDS_story] and the scene continues.";
  assert.equal(a.turn("Inspect.",prose).visible,prose);assert.equal(a.state.lepAutoCards,undefined);
});
test("complete raw sidecars are removed from later context without altering the Memory prefix",()=>{
  const a=automaticAdventure();seedCandidate(a);let raw;
  a.turn("Go on.",()=>raw=cardOutput(a,"Character",{entry:"PRIVATE_CARD_PAYLOAD"})());
  const text="MEM\n"+raw+"\nLatest player action.";
  const context=a.hook("Context",text,{maxChars:text.length});
  assert.ok(context.startsWith("MEM\n"));assert.ok(context.includes("Latest player action."));
  assert.ok(!context.includes("PRIVATE_CARD_PAYLOAD"));assert.ok(!context.includes("LEP_AUTOCARDS"));
});
test("deleted owned cards require new discovery mentions and are never recreated by registry rescan alone",()=>{
  const a=automaticAdventure({fast:true});seedCandidate(a);a.turn("Go on.",cardOutput(a));
  const oldId=activeEntities(a)[0].id;a.cards=a.cards.filter(card=>card.keys!=="Chloe Parker");
  a.turn();a.turn();assert.equal(worldCards(a.cards).length,1);assert.equal(activeEntities(a).length,0);
  assert.ok(a.ep.entities.items.some(item=>item.id===oldId&&!item.active));
  a.turn("Go on.","You meet Chloe Parker again.");
  a.turn("Go on.",cardOutput(a));
  assert.equal(activeEntities(a).length,1);assert.notEqual(activeEntities(a)[0].id,oldId);
});
test("owned update failure cannot change type, registry identity or creator content",()=>{
  const a=automaticAdventure({fast:true});seedCandidate(a);a.turn("Go on.",cardOutput(a));a.turn();
  const cards=clone(a.cards),entities=clone(a.ep.entities);a.options.failUpdate=true;
  const result=a.turn("Go on.",cardOutput(a,"Location",{entry:"Do not commit this."}));
  assert.equal(result.visible,"The ordinary scene continues.");assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.deepEqual(a.ep.entities,entities);
  assert.equal(a.state.lepAutoCards.pending,null);
});
test("corrupt automatic metadata cannot block the LEP console or reset story progress",()=>{
  const a=fixtureAdventure();a.turn();a.state.lepAutoCards={version:1,pending:{bad:true},owned:null};
  const turns=a.ep.enabledTurns;
  assert.ok(a.control("/lep help").visible.includes("/lep entities"));
  assert.ok(a.control(setCommand("choice.search","backstage")).visible.includes("Set choice.search"));
  assert.equal(a.ep.enabledTurns,turns);
});
test("README entity example validates and third-party license/revision accompany the installed code",()=>{
  const readme=fs.readFileSync(path.join(root,"docs/LEP_Technical_Reference.txt"),"utf8");
  const code=readme.match(/BEGIN RUNNABLE ENTITY EVENT\n([\s\S]*?)\nEND RUNNABLE ENTITY EVENT/)[1];
  const example=clone(new vm.Script("("+code+")").runInNewContext({}));
  new vm.Script(source([example])+"\nLEP_validateEvent(LEP_EVENTS[0]);").runInNewContext({});
  const notice=fs.readFileSync(path.join(root,"THIRD_PARTY_NOTICES.txt"),"utf8");
  for(const text of ["Copyright (c) 2025 LewdLeah","Permission is hereby granted, free of charge", "c8a4e4d6e1ef03b3177fa35c8c332afe1f914aa3"]){
    assert.ok(notice.includes(text));assert.ok(library.includes(text));
  }
  assert.ok(readme.includes("DYNAMIC ENTITIES AND INTEGRATED AUTO-CARDS"));
});

test("restored-state Retry recovers an already-written owned update without freezing later updates",()=>{
  const a=automaticAdventure({fast:true});seedCandidate(a);a.turn("Go on.",cardOutput(a));a.turn();
  let raw;a.turn("Go on.",()=>raw=cardOutput(a,"Character",{entry:"Chloe Parker manages the lights."})());
  const before=clone(a.state),calls=clone(a.calls),cards=clone(a.cards);
  assert.equal(a.retry(raw,true),"The ordinary scene continues.");
  assert.deepEqual(a.state,before);assert.deepEqual(a.calls,calls);assert.deepEqual(worldCards(a.cards),worldCards(cards));
  a.turn();a.turn("Go on.",cardOutput(a,"Character",{entry:"Chloe Parker has repaired the lights."}));
  assert.equal(a.calls.update,calls.update+1);assert.equal(activeEntities(a).length,1);
});
test("ownership revision cannot adopt a card manually edited after an automatic write",()=>{
  const a=automaticAdventure();seedCandidate(a);let raw;
  a.turn("Go on.",()=>raw=cardOutput(a)());
  const card=a.cards.find(card=>card.keys==="Chloe Parker");card.entry+="\nManual correction.";
  const cards=clone(a.cards);a.retry(raw,true);
  assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.equal(a.state.lepAutoCards.owned.length,0);
  assert.equal(a.state.lepAutoCards.pending,null);
});
test("automatic ownership limit defers additional cards without corrupting registered entities",()=>{
  const a=automaticAdventure({fast:true});a.source+='\nLEP_AC_LIMITS.owned=1;';
  seedCandidate(a);a.turn("Go on.",cardOutput(a));
  seedCandidate(a,"Moonlight Cafe");a.turn();
  assert.equal(a.state.lepAutoCards.owned.length,1);assert.equal(activeEntities(a).length,1);
  assert.equal(a.cards.filter(card=>card.keys==="Moonlight Cafe").length,0);
  assert.ok(JSON.stringify(a.state.lepAutoCards).length<=20000);
});

test("a missing sidecar never suppresses ordinary bracketed narrative",()=>{
  const a=automaticAdventure();seedCandidate(a);
  assert.equal(a.turn("Go on.","[The curtains rise.] The scene continues.").visible,"[The curtains rise.] The scene continues.");
  assert.equal(a.ep.enabledTurns,3);assert.equal(a.state.lepAutoCards.pending,null);
});

// v0.4 narrative time and rich chapter contracts.
const timeChapters = {
  start: {title:"ACT I — Arrival",description:"The family meets.",announce:true,opening:"The front door opens.",timeAdvance:{years:9}},
  next: {title:"ACT II — A New Routine",description:"Life settles into a routine.",announce:true,opening:"Three months later...",timeAdvance:{months:3}},
  hidden: {title:"Behind the scenes",description:"A quiet week.",announce:false,opening:"This opening stays hidden.",timeAdvance:{weeks:1}},
  finish: "Free play continues."
};
const timelineAdventure = (events=[], options={}) => new Adventure(events, {chapters:timeChapters,...options});
const announcement = "────────────────────\nACT II — A New Routine\n────────────────────\n\nThree months later...";
const elapsed = a => a.ep.timeline.elapsed;
const evaluate = code => clone(new vm.Script(library + "\n" + code).runInNewContext({}, {timeout:500}));

test("v0.4 fresh timeline is zero; turns and AI time skips never consult or advance a clock",()=>{
  const a=timelineAdventure();
  a.source+='\nDate = function(){throw new Error("Clock forbidden");}; Date.now = function(){throw new Error("Clock forbidden");};';
  a.turn("A year later.","Three weeks later...");a.turn();
  assert.deepEqual(elapsed(a),{months:0,days:0,hours:0});assert.deepEqual(a.ep.timeline.anchors,[]);
  assert.equal(a.ep.enabledTurns,2);assert.equal(a.ep.chapter,"start");
  assert.ok(!a.turn().context.includes("[LEP Timeline]"));
});
test("v0.3 migration preserves progress, entities, ownership and old checkpoints; read-only time does not migrate",()=>{
  const a=timelineAdventure([event("old",{effects:[{path:"score",op:"add",value:2}]})],{cards:[chloeCard()]});
  a.turn();delete a.ep.timeline;
  for(const record of a.ep.checkpoints)delete record.before.timeline;
  const before=storyState(a),cards=clone(a.cards);
  assert.ok(a.control("/lep time").visible.includes("0 days"));
  assert.deepEqual(storyState(a),before);assert.deepEqual(worldCards(a.cards),worldCards(cards));
  a.hook("Input","Continue.");
  const expected=clone(before);expected.lep.timeline={version:1,elapsed:{months:0,days:0,hours:0},anchors:[]};
  assert.deepEqual(storyState(a),expected);
});
test("durations normalize only months/years and days/weeks with bounded nonnegative integers",()=>{
  for(const [duration,expected] of [[{months:14,days:10,hours:0},"1 year, 2 months, 1 week, 3 days"],[{years:1,weeks:4},"1 year, 4 weeks"],[{months:1,days:30,hours:0},"1 month, 4 weeks, 2 days"],[{},"0 days"]]) {
    assert.equal(evaluate("LEP_timeText(LEP_duration("+JSON.stringify(duration)+"))"),expected);
  }
  for(const raw of ['{"days":-1}','{"months":1.2}','{"days":"3"}','{"minutes":2}','{"__proto__":{}}','{"days":1000001}','{"years":1000000,"months":1}','{"weeks":1000000,"days":1}','null','[]','{"days":null}']) {
    assert.throws(()=>evaluate("LEP_duration(JSON.parse("+JSON.stringify(raw)+"))"),undefined,raw);
  }
  for(const value of ["NaN","Infinity","-Infinity"])assert.throws(()=>evaluate("LEP_duration({days:"+value+"})"));
});
test("rich chapters reject unknown fields and invalid types while old string syntax stays valid",()=>{
  for(const chapter of [{description:"Valid",typo:true},{title:"Title"},{description:""},{description:"x",announce:"true"},{description:"x",opening:2},{description:"x",title:" "},{description:"x",timeAdvance:{days:-1}}]) {
    const a=timelineAdventure([],{chapters:{...timeChapters,next:chapter}});
    assert.ok(a.control("/lep testChapter = next").visible.includes("LEP:"));assert.equal(a.ep,undefined);
  }
  const a=timelineAdventure();assert.ok(a.control("/lep testChapter = finish").visible.includes("Legacy chapter"));
  assert.ok(a.control("/lep chaptersID").visible.includes("next — ACT II — A New Routine — Life settles into a routine. [announced] [+3 months]"));
});
test("real events apply event then destination time and anchor the final position with exact prose",()=>{
  const a=timelineAdventure([event("adoption",{text:"Exact authored event.\nSecond line.",display:"replace",timeAdvance:{days:10},nextChapter:"next",
    timeAnchor:{id:"adopted",label:"Alex was adopted",context:true},memory:{slot:"family",scope:"story",summary:"The family welcomed Alex.",timeAnchor:"adopted"},effects:[{path:"score",op:"add",value:1}]})]);
  const visible=a.turn().visible;
  assert.equal(visible,"Exact authored event.\nSecond line.\n\n"+announcement);
  assert.deepEqual(elapsed(a),{months:3,days:10,hours:0});assert.deepEqual(a.ep.timeline.anchors[0].at,elapsed(a));
  assert.equal(a.ep.chapterTurns,0);assert.equal(a.ep.variables.score,1);
  assert.equal(a.ep.memories[0].summary,"The family welcomed Alex.");assert.equal(a.ep.memories[0].timeAnchor,"adopted");
  const before=clone(a.state);for(const rollback of [false,true]){assert.equal(a.retry("Different.",rollback),visible);assert.deepEqual(a.state,before);}
  a.turn();assert.deepEqual(elapsed(a),{months:3,days:10,hours:0});
});
test("append transitions preserve event prose and put chapter announcement after it",()=>{
  const a=timelineAdventure([event("transition",{nextChapter:"next"})]);
  assert.equal(a.turn().visible,"The ordinary scene continues.\n\nAuthored transition.\n\n"+announcement);
  assert.equal(a.retry("Retried scene."),"Retried scene.\n\nAuthored transition.\n\n"+announcement);
});
for(const paused of [false,true])test("testChapter and time are state-neutral through blank/stop Output and Retry; paused="+paused,()=>{
  const a=timelineAdventure([event("eligible")],{cards:[chloeCard()]});
  a.configure({enabled:!paused,autoCardsEnabled:true,debug:true,forceEvent:"eligible",commandRevision:7});
  const before=storyState(a),cards=clone(a.cards),calls=clone(a.calls);
  for(const [command,needle] of [["/lep testChapter = next",announcement],["/lep testChapter = hidden","normally has no visible announcement"],["/lep testChapter = finish","Legacy chapter"],["/lep testChapter = missing","Unknown chapter"],["/lep time","Narrative time since story start"]]) {
    for(const output of ["","stop",null,undefined]) {
      const result=a.turn(command,()=>output,{actionType:"do"});assert.ok(result.visible.includes(needle),command);
      assert.equal(a.retry(""),result.visible);assert.deepEqual(storyState(a),before);
    }
  }
  assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.deepEqual(a.calls,calls);
});
test("fresh paused chapter previews/time never initialize progress or registry",()=>{
  const a=timelineAdventure([],{cards:[{id:8,keys:CONFIG,type:CONFIG_TYPE,entry:"enabled=false"},chloeCard()]});
  const before=storyState(a);
  for(const command of ["/lep time","/lep testChapter = next","/lep testChapter = finish","/lep chaptersID","/lep status"]){a.control(command);assert.deepEqual(storyState(a),before);}
  assert.equal(a.ep,undefined);
});
test("forceChapter owns its cycle, applies entry time once, resets only chapter turns and expires chapter memories",()=>{
  const a=timelineAdventure([event("eligible")]);a.configure({debug:true,forceEvent:"eligible",commandRevision:99,manualSet:{revision:8,path:"score",value:8}});
  a.ep.chapterTurns=6;a.ep.enabledTurns=10;
  a.ep.memories=[{slot:"old",scope:"chapter",chapter:"start",summary:"Expired."},{slot:"keep",scope:"story",chapter:"start",summary:"Kept."}];
  const variables=clone(a.ep.variables),calls=clone(a.calls);
  assert.equal(a.control("/lep forceChapter = next").visible,announcement);
  assert.deepEqual(elapsed(a),{months:3,days:0,hours:0});assert.equal(a.ep.chapter,"next");assert.equal(a.ep.chapterTurns,0);assert.equal(a.ep.enabledTurns,10);
  assert.deepEqual(a.ep.completedEvents,[]);assert.deepEqual(a.ep.eventLog,[]);assert.deepEqual(a.ep.characters,[]);assert.deepEqual(a.ep.timeline.anchors,[]);
  assert.deepEqual(a.ep.variables,variables);assert.equal(a.ep.lastCommandRevision,0);assert.equal(a.ep.lastManualRevision,0);
  assert.deepEqual(a.ep.memories.map(item=>item.slot),["keep"]);assert.deepEqual(a.calls,calls);
  a.ep.chapterTurns=2;assert.ok(a.control("/lep forceChapter = next").visible.includes("already current"));assert.equal(a.ep.chapterTurns,2);assert.deepEqual(elapsed(a),{months:3,days:0,hours:0});
  assert.ok(a.control("/lep forceChapter = hidden").visible.includes("no visible announcement"));assert.deepEqual(elapsed(a),{months:3,days:7,hours:0});
  assert.equal(a.control("/lep forceChapter = next").visible,announcement);assert.deepEqual(elapsed(a),{months:6,days:7,hours:0});
});
for(const rawInputHistory of [false,true])for(const rollback of [false,true])test("chapter/time mutation Retry exactly once; raw="+rawInputHistory+", restored="+rollback,()=>{
  const a=timelineAdventure([],{rawInputHistory});
  for(const command of ["/lep forceChapter = next",'/lep advanceTime = {"days":2}']) {
    const visible=a.turn(command,()=>"stop",{actionType:"do"}).visible,before=storyState(a),cards=clone(a.cards),calls=clone(a.calls);
    for(let i=0;i<3;i++){assert.equal(a.retry("",rollback),visible);assert.deepEqual(storyState(a),before);}
    assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.deepEqual(a.calls,calls);
  }
  assert.deepEqual(elapsed(a),{months:3,days:2,hours:0});assert.equal(a.ep.enabledTurns,0);
});
test("chapter/time mutations reject unknown IDs, paused mode, unsafe duration, corrupt state and recovery",()=>{
  const a=timelineAdventure();a.turn();
  for(const command of ["/lep forceChapter = missing",'/lep advanceTime = {"days":-1}',"/lep forceChapter = constructor",'/lep set = {"path":"timeline.elapsed.days","value":3}']) {
    const before=storyState(a);assert.ok(a.control(command).visible.includes("LEP:"));assert.deepEqual(storyState(a),before);
  }
  for(const recovery of [false,true]) {
    a.configure({enabled:recovery});a.ep.recoveryRequired=recovery;
    const before=storyState(a);
    for(const command of ["/lep forceChapter = next",'/lep advanceTime = {"days":3}']){assert.ok(a.control(command).visible.includes(recovery?"recovery":"paused"));assert.deepEqual(storyState(a),before);}
  }
  a.ep.recoveryRequired=false;a.ep.timeline.version=9;const corrupt=storyState(a);
  assert.ok(a.control("/lep time").visible.includes("Incompatible"));a.control("/lep forceChapter = next");assert.deepEqual(storyState(a),corrupt);
  assert.ok(a.control("/lep status").visible.includes("unavailable"));
});
test("advanceTime is a bounded timeline-only mutation and its console text stays out of later narrative context",()=>{
  const a=timelineAdventure([event("pending")]);a.configure({debug:false});const before=clone(a.ep);
  assert.ok(a.control('/lep advanceTime = {"years":1,"months":2,"weeks":1,"days":3}').visible.includes("1 year, 2 months, 1 week, 3 days"));
  const expected=clone(before);expected.timeline.elapsed={months:14,days:10,hours:0};expected.checkpoints=clone(a.ep.checkpoints);assert.deepEqual(a.ep,expected);
  const status=a.control("/lep status").visible;assert.ok(status.includes("ACT I — Arrival"));assert.ok(status.includes("Narrative time: 1 year, 2 months, 1 week, 3 days"));
  const result=a.turn();assert.ok(!result.context.includes("No events were evaluated"));assert.ok(result.context.includes("[LEP Timeline]"));
  assert.ok(result.visible.endsWith("Authored pending."));assert.deepEqual(elapsed(a),{months:14,days:10,hours:0});
});
test("testEvent never applies time or anchors; forceEvent and legacy force apply them including destination announcements",()=>{
  const definition=event("jump",{timeAdvance:{weeks:1},nextChapter:"next",timeAnchor:{id:"jumped",context:true}});
  for(const legacy of [false,true]) {
    const a=timelineAdventure([definition]);a.configure({debug:true});const before=storyState(a);
    assert.ok(a.control("/lep testEvent = jump").visible.includes("Authored jump."));assert.deepEqual(storyState(a),before);
    if(legacy)a.configure({debug:true,testEvent:"jump",commandRevision:1});
    if(legacy){const prior=progress(a.ep);a.turn();assert.deepEqual(progress(a.ep),prior);a.configure({debug:true,forceEvent:"jump",commandRevision:2});}
    const visible=legacy?a.turn().visible:a.control("/lep forceEvent = jump").visible;
    assert.ok(visible.endsWith("Authored jump.\n\n"+announcement));assert.deepEqual(elapsed(a),{months:3,days:7,hours:0});assert.deepEqual(a.ep.timeline.anchors[0].at,elapsed(a));
    const prior=clone(a.state);assert.ok(a.retry().endsWith("Authored jump.\n\n"+announcement));assert.deepEqual(a.state,prior);
    a.control("/lep forceEvent = jump");assert.deepEqual(elapsed(a),{months:3,days:14,hours:0});assert.equal(a.ep.timeline.anchors.length,1);assert.deepEqual(a.ep.timeline.anchors[0].at,{months:3,days:7,hours:0});
    assert.ok(a.logs.some(line=>line.includes("first occurrence retained")));
  }
});
test("failed effects, duration overflow and full anchor storage commit no partial event transaction",()=>{
  for(const kind of ["effect","overflow","anchors"]) {
    const definition=event("bad",{timeAdvance:{days:1},nextChapter:"next",timeAnchor:{id:"new_anchor"},effects:[{path:"score",op:"add",value:5}],memory:{summary:"Must not persist."}});
    if(kind==="effect")definition.effects.push({path:"missing",op:"add",value:1});
    const a=timelineAdventure([definition]);a.configure({debug:true});
    if(kind==="overflow")a.ep.timeline.elapsed.days=7000000;
    if(kind==="anchors")a.ep.timeline.anchors=Array.from({length:32},(_,i)=>({id:"anchor_"+i,at:{months:0,days:0,hours:0}}));
    const before=storyState(a);assert.ok(a.control("/lep forceEvent = bad").visible.includes("No event was committed"));assert.deepEqual(storyState(a),before);
    a.turn();assert.deepEqual(a.ep.timeline,before.lep.timeline);assert.deepEqual(a.ep.variables,before.lep.variables);assert.equal(a.ep.chapter,"start");assert.deepEqual(a.ep.completedEvents,[]);
    assert.equal(a.ep.enabledTurns,1);
  }
});
test("timeline and anchor definition validation rejects unsafe metadata before force",()=>{
  for(const extra of [{timeAdvance:{minutes:2}},{timeAnchor:{id:"__proto__"}},{timeAnchor:{id:"x",unknown:true}},{timeAnchor:{id:"x",label:"x".repeat(161)}},{timeAnchor:{id:"x",context:"true"}},{timeAnchor:{id:"x",label:"a\nb"}},{memory:{summary:"x",timeAnchor:"constructor"}}]) {
    const a=timelineAdventure([event("bad",extra)]);a.configure({debug:true});const before=storyState(a);assert.ok(a.control("/lep forceEvent = bad").visible.includes("not found among valid"));assert.deepEqual(storyState(a),before);
  }
});
test("relative anchors and memory metadata render without rewriting summaries or leaking IDs into bounded context",()=>{
  const a=timelineAdventure([event("mark",{timeAnchor:{id:"internal_adoption_id",label:"Alex was adopted",context:true},memory:{summary:"The family welcomed Alex.",scope:"story",timeAnchor:"internal_adoption_id"}})]);
  a.configure({memoryBudget:600});a.turn();a.control('/lep advanceTime = {"months":14,"days":10}');
  const read=a.control("/lep time").visible;assert.ok(read.includes("internal_adoption_id — Alex was adopted — 1 year, 2 months, 1 week, 3 days ago"));
  const before=clone(a.ep.memories);const result=a.turn();assert.ok(result.context.includes("Alex was adopted — 1 year, 2 months, 1 week, 3 days ago"));assert.ok(result.context.includes("The family welcomed Alex. (1 year, 2 months, 1 week, 3 days ago)"));
  assert.ok(!result.context.includes("internal_adoption_id"));assert.deepEqual(a.ep.memories,before);
  assert.deepEqual(a.state.memory,{context:"USER MEMORY",authorsNote:"USER NOTE"});
  a.configure({memoryBudget:45});const small=a.turn().context;assert.ok(small.includes("Narrative time:"));
  const block=small.match(/\n\[LEP memory\][\s\S]*?\[\/LEP memory\]\n/);assert.ok(!block||block[0].length<=135);
  a.configure({memoryBudget:0});assert.ok(!a.turn().context.includes("[LEP Timeline]"));
});
test("only three opted-in anchors enter dynamic context, while time console remains bounded",()=>{
  const a=timelineAdventure();a.configure({memoryBudget:600});
  a.ep.timeline.anchors=Array.from({length:32},(_,i)=>({id:"anchor_"+i,label:"Milestone "+i,context:i!==31,at:{months:0,days:0,hours:0}}));
  const read=a.control("/lep time").visible;assert.ok(read.length<7000);assert.ok(read.includes("anchor_31"));
  const context=a.turn().context;assert.equal((context.match(/Milestone \d+ —/g)||[]).length,3);assert.ok(!context.includes("Milestone 31"));assert.ok(context.includes("Milestone 30"));
});
test("bounded Undo restores forced chapter/time changes and anchors, including legacy checkpoints",()=>{
  const a=timelineAdventure([event("mark",{timeAnchor:{id:"old"}})]);a.turn();
  delete a.ep.timeline;for(const cp of a.ep.checkpoints)delete cp.before.timeline;
  const old=clone(a.savedSlots[0].history);
  a.control("/lep forceChapter = next");const forceSlot=clone(a.savedSlots[1].history),forceState=clone(a.ep);
  a.control('/lep advanceTime = {"days":3}');a.control("/lep forceEvent = mark");assert.equal(a.ep.timeline.anchors.length,1);
  a.history=forceSlot;assert.equal(a.hook("Output",""),announcement);assert.deepEqual(elapsed(a),forceState.timeline.elapsed);assert.deepEqual(a.ep.timeline.anchors,[]);assert.equal(a.ep.chapter,"next");
  a.history=old;a.hook("Output","Retry old.");assert.deepEqual(elapsed(a),{months:0,days:0,hours:0});assert.equal(a.ep.chapter,"start");assert.deepEqual(a.ep.timeline.anchors,[]);
});
test("Undo beyond retained chapter/time checkpoints pauses instead of guessing",()=>{
  const a=timelineAdventure();a.control('/lep advanceTime = {"days":1}');const old=clone(a.savedSlots[0].history);
  for(let i=0;i<8;i++)a.control('/lep advanceTime = {"days":1}');
  a.history=old;a.history.push({type:"continue",text:"Earlier output."});a.hook("Output","A changed old action.");assert.equal(a.ep.recoveryRequired,true);assert.deepEqual(elapsed(a),{months:0,days:9,hours:0});
});
test("Auto-Cards maintenance never changes timeline, enters a chapter or creates anchors",()=>{
  const a=automaticAdventure();seedCandidate(a);
  a.source=source([event("due",{timeAdvance:{days:2},nextChapter:"next",timeAnchor:{id:"unexpected"}})],baseStart,timeChapters);
  startTask(a);const before=clone(a.ep);const raw=cardOutput(a,"Character",{},"")();
  assert.ok(a.hook("Output",raw).includes("story progress is unchanged"));
  const after=clone(a.ep);delete after.entities;delete before.entities;assert.deepEqual(after,before);
});
test("Missing Stage Key v0.4 keeps legacy, multi-event, one-event and zero-event chapters and records festival time",()=>{
  assert.equal(typeof fixture.chapters.recovery,"string");assert.equal(typeof fixture.chapters.festival,"string");
  assert.ok(fixture.events.filter(e=>e.chapter==="preparation").length>1);assert.equal(fixture.events.filter(e=>e.chapter==="opening").length,1);assert.equal(fixture.events.filter(e=>e.chapter==="free_roam").length,0);
  const a=fixtureAdventure();fixtureThroughClue(a);a.control(setCommand("choice.search","backstage"));fixtureStep(a,"find_key_backstage","recovery",0);fixtureThroughFinale(a);
  assert.deepEqual(elapsed(a),{months:0,days:2,hours:0});assert.deepEqual(a.ep.timeline.anchors[0].at,{months:0,days:1,hours:0});assert.ok(a.control("/lep time").visible.includes("festival_opened — The school festival opened — 1 day ago"));
});

test("creator guide runnable scenarios and branch examples match the implemented v0.4 syntax",()=>{
  const guide=fs.readFileSync(path.join(root,"AuthorToolKit/LEP_Events_Creator.txt"),"utf8");
  assert.ok(guide.startsWith("LEP: Lilith Event Paradox — Events Creator"));
  const examples=Array.from(guide.matchAll(/BEGIN RUNNABLE EXAMPLE: ([A-Z]+)\n([\s\S]*?)\nEND RUNNABLE EXAMPLE/g));
  assert.deepEqual(examples.map(item=>item[1]),["MINIMAL","STARTER"]);
  const scenarios={};
  for(const [,name,block] of examples){
    const parsed=clone(new vm.Script(block+'\n({start:LEP_START,chapters:LEP_CHAPTERS,events:LEP_EVENTS})').runInNewContext({}));scenarios[name]=parsed;
    new vm.Script(source(parsed.events,parsed.start,parsed.chapters)+'\nLEP_initialState(); LEP_EVENTS.forEach(LEP_validateEvent);').runInNewContext({});
    const a=new Adventure(parsed.events,{start:parsed.start,chapters:parsed.chapters});
    a.turn();a.turn();a.turn();
    if(name==="STARTER"){
      assert.equal(a.ep.chapter,"routine");assert.deepEqual(elapsed(a),{months:3,days:2,hours:0});assert.equal(a.ep.variables.welcomed,true);assert.equal(a.ep.timeline.anchors[0].id,"alex_arrived");assert.deepEqual(a.ep.timeline.anchors[0].at,{months:0,days:0,hours:0});
    }else{assert.equal(a.ep.chapter,"free_roam");assert.equal(a.ep.variables.bellRang,true);}
    assert.equal(a.ep.completedEvents.length,parsed.events.length);
  }
  const array=guide.match(/BEGIN EVENT ARRAY: BRANCHES\n([\s\S]*?)\nEND EVENT ARRAY/)[1];
  const branches=clone(new vm.Script('('+array+')').runInNewContext({}));
  for(const route of ["backstage","office"]){const a=new Adventure(branches,{start:scenarios.MINIMAL.start,chapters:scenarios.MINIMAL.chapters});a.control(setCommand("choice.search",route));a.turn();assert.deepEqual(a.ep.completedEvents,["search_"+route]);assert.equal(a.ep.chapter,"free_roam");}
  const help=new Adventure().control("/lep help").visible;
  for(const command of ["help","status","eventsID","chaptersID","entities","time","set","testEvent","forceEvent","testChapter","forceChapter","advanceTime","timeSkip"]){assert.ok(guide.includes('/lep '+command));assert.ok(help.includes('/lep '+command));}
});
test("replaying a chapter mutation after its progress checkpoint expires requires recovery",()=>{
  const a=timelineAdventure();a.control("/lep forceChapter = next");const old=clone(a.savedSlots[0].history);
  for(let i=0;i<7;i++)a.control('/lep advanceTime = {"days":1}');
  const timeline=clone(a.ep.timeline);a.history=old;assert.ok(a.hook("Output","").includes("no recoverable progress checkpoint"));assert.equal(a.ep.recoveryRequired,true);assert.deepEqual(a.ep.timeline,timeline);
});
test("paused chapter/time Retry and a changed command cannot repurpose a handled action",()=>{
  const a=timelineAdventure();a.configure({enabled:false});const blocked=a.control("/lep forceChapter = next").visible;
  a.configure({enabled:true});const before=storyState(a);assert.equal(a.retry(""),blocked);assert.deepEqual(storyState(a),before);
  const visible=a.control("/lep forceChapter = next").visible;const after=clone(a.ep.timeline);
  a.history=clone(a.savedSlots[a.savedSlots.length-1].history);a.hook("Input",'/lep advanceTime = {"days":99}');assert.equal(a.hook("Output",""),visible);assert.deepEqual(a.ep.timeline,after);
  a.configure({enabled:false});assert.ok(a.retry("").includes("paused"));assert.deepEqual(a.ep.timeline,after);
});

// Pre-public-beta v0.4 timeSkip and hour-level narrative time.
const skipCommand = (duration, prose) => "/lep timeSkip = " + duration + ";" + prose;
const position = (months=0, days=0, hours=0) => ({months,days,hours});
test("timeSkip parses compact units, splits only the first semicolon and preserves literal multiline prose",()=>{
  const cases=[
    ["3mo","Three months pass.",position(3)],
    ["6h","By evening...",position(0,0,6)],
    ["1y,2mo,3d,6h","Text",position(14,3,6)],
    [" 1Y, 2Mo, 1w, 4D, 6H ","A long interval.",position(14,11,6)],
    ["2d,12h","You wait; the rain eases; the streets dry.",position(0,2,12)],
    ["1y,3mo","First paragraph.\n\nSecond paragraph; still literal.",position(15)],
    ["1h","  Leading spaces.\r\nTrailing spaces and newline.  \n",position(0,0,1)],
    ["0h",'Literal: {"ready":true}; {{entity:helper}}; $&; ${score=99}; `not code`.',position()],
    ["24h","One day.",position(0,1)]
  ];
  for(const [duration,prose,expected] of cases){
    const a=timelineAdventure();const result=a.control(skipCommand(duration,prose));
    assert.equal(result.visible,prose);assert.deepEqual(elapsed(a),expected);assert.equal(a.ep.enabledTurns,0);assert.equal(a.ep.chapterTurns,0);
    assert.equal(a.state.lepConsole.receipts[0].canon,true);assert.equal(a.state.lepConsole.receipts[0].mutation,"timeskip");
    assert.ok(!result.context.includes(prose));assert.ok(!result.context.includes("/lep timeSkip"));
  }
  for(const command of ["> You /lep timeSkip = 6h;By evening."," \n> You /LEP TIMESKIP=6H;By evening.","/lep timeSkip=6h;By evening."]){
    const a=timelineAdventure();assert.equal(a.control(command).visible,"By evening.");assert.deepEqual(elapsed(a),position(0,0,6));
  }
});
test("timeSkip malformed syntax, unsafe durations and missing prose fail without canon or state mutation",()=>{
  const commands=["/lep timeSkip","/lep timeSkip = 3mo","/lep timeSkip = ;Private prose.",skipCommand("3mo",""),skipCommand("3mo"," \n\t"),skipCommand("3mo","stop"),skipCommand("3mo"," stop "),
    ...["-3mo","1.5y","3m","3months","2h,2h","2h,2H","1d,,2h","hello","1d,-2h","1min","1ms","NaNy","Infinityd","__proto__","constructor","1d,",",1d","1 d","1d 2h","1000001h","1000001y","9".repeat(320)+"h"].map(d=>skipCommand(d,"Private prose."))];
  for(const command of commands){
    const a=timelineAdventure();a.configure({debug:true});const before=storyState(a),cards=clone(a.cards);
    const result=a.control(command);assert.ok(result.visible.startsWith("[LEP Console]"),command);assert.ok(!result.visible.includes("Private prose."),command);assert.deepEqual(storyState(a),before);assert.deepEqual(worldCards(a.cards),worldCards(cards));
    assert.equal(a.retry(""),result.visible);assert.deepEqual(storyState(a),before);
  }
});
test("timeSkip leaves quoted Say dialogue and embedded commands as ordinary narrative",()=>{
  const examples=['"/lep timeSkip = 3mo;Three months pass."','> You say "/lep timeSkip = 3mo;Three months pass."','Maya reads "/lep timeSkip = 3mo;Three months pass." aloud.'];
  for(const input of examples){const a=timelineAdventure();const result=a.turn(input,"An ordinary reply.",{actionType:"say"});assert.equal(result.modified,input);assert.equal(result.visible,"An ordinary reply.");assert.deepEqual(elapsed(a),position());assert.equal(a.ep.enabledTurns,1);assert.equal(a.state.lepConsole,undefined);}
  // Existing whole-action bare controls still work; no separate Story-mode path.
  const a=timelineAdventure();assert.equal(a.turn(skipCommand("1h","Time passes."),"Ignore.",{actionType:"story"}).visible,"Time passes.");
});
test("timeSkip changes only time and transaction metadata, never story turns, chapter, memories, registry or pending legacy work",()=>{
  const a=timelineAdventure([event("due",{effects:[{path:"score",op:"add",value:10}],timeAdvance:{years:1},nextChapter:"finish",timeAnchor:{id:"unwanted"},memory:{summary:"Do not create.",character:"Maya"}})],{cards:[chloeCard(),cafeCard()]});
  a.configure({enabled:true,debug:true,memoryMode:"full",autoCharacterCards:true,journalEnabled:true,autoCardsEnabled:true,manualSet:{revision:12,path:"score",value:500},testEvent:"due",forceEvent:"due",commandRevision:23});
  a.ep.chapter="next";a.ep.enabledTurns=10;a.ep.chapterTurns=3;a.ep.timeline.elapsed=position(2);
  a.ep.memories=[{slot:"chapter_fact",summary:"Kept unchanged.",scope:"chapter",chapter:"next"}];
  a.ep.timeline.anchors=[{id:"milestone",label:"Arrival",context:true,at:position(1)}];
  const before=storyState(a),cards=clone(a.cards),calls=clone(a.calls);
  const prose="Three months pass. Chloe Parker marries; the score becomes 999; the festival ends.";
  assert.equal(a.control(skipCommand("3mo,6h",prose)).visible,prose);
  const expected=clone(before);expected.lep.timeline.elapsed=position(5,0,6);expected.lep.checkpoints=clone(a.ep.checkpoints);
  assert.deepEqual(storyState(a),expected);assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.deepEqual(a.calls,calls);assert.equal(a.state.lepAutoCards,undefined);
  assert.ok(a.logs.some(line=>line.includes("timeskip")&&line.includes("no events evaluated or turns advanced")));
});
for(const output of ["","   ",null,undefined,"stop"])test("timeSkip owns blank/stop Output: "+String(output),()=>{
  const a=timelineAdventure();const prose="Six hours pass; everyone rests.";
  const result=a.turn(skipCommand("6h",prose),()=>output,{actionType:"do"});assert.equal(result.visible,prose);assert.deepEqual(elapsed(a),position(0,0,6));assert.equal(a.ep.enabledTurns,0);
  assert.equal(a.retry(output),prose);assert.deepEqual(elapsed(a),position(0,0,6));assert.equal(a.ep.checkpoints.length,1);
});
test("timeSkip cap is 4000 normalized command characters including prose whitespace; ordinary controls retain their bounds",()=>{
  const cap=evaluate("LEP_CONSOLE_LIMITS.timeSkipInput");assert.equal(cap,4000);
  for(const size of [cap-1,cap,cap+1])for(const wrapper of ["","> You "]){
    const prefix=skipCommand("6h","");const prose="x".repeat(size-prefix.length-1)+"\n";
    const a=timelineAdventure();a.configure({debug:true});const before=storyState(a);
    const result=a.control(wrapper+prefix+prose);
    if(size<=cap){assert.equal(result.visible,prose);assert.deepEqual(elapsed(a),position(0,0,6));}
    else{assert.ok(result.visible.includes("exceeds 4000"));assert.deepEqual(storyState(a),before);assert.ok(!result.visible.includes(prose));}
  }
  const a=timelineAdventure();assert.ok(a.control("/lep status "+"x".repeat(300)).visible.includes("maximum 256"));
});
test("hours normalize into days on every timeline path without ever converting months",()=>{
  for(const [duration,expected,display] of [[{hours:24},position(0,1),"1 day"],[{hours:48},position(0,2),"2 days"],[{days:1,hours:25},position(0,2,1),"2 days, 1 hour"],[{months:14,days:10,hours:30},position(14,11,6),"1 year, 2 months, 1 week, 4 days, 6 hours"]]){
    assert.deepEqual(evaluate("LEP_duration("+JSON.stringify(duration)+")"),expected);assert.equal(evaluate("LEP_timeText(LEP_duration("+JSON.stringify(duration)+"))"),display);
  }
  const chapters=clone(timeChapters);chapters.next.timeAdvance={months:3,hours:23};
  const a=timelineAdventure([event("jump",{timeAdvance:{hours:2},nextChapter:"next",timeAnchor:{id:"jumped",label:"Jump happened",context:true}})],{chapters});
  a.turn();assert.deepEqual(elapsed(a),position(3,1,1));assert.deepEqual(a.ep.timeline.anchors[0].at,position(3,1,1));
  assert.ok(a.control("/lep time").visible.includes("3 months, 1 day, 1 hour"));assert.ok(a.control("/lep status").visible.includes("Narrative time: 3 months, 1 day, 1 hour"));
  a.control('/lep advanceTime = {"hours":25}');assert.deepEqual(elapsed(a),position(3,2,2));
  a.control(skipCommand("22h","The next day arrives."));assert.deepEqual(elapsed(a),position(3,3));
  assert.ok(a.control("/lep time").visible.includes("jumped — Jump happened — 1 day, 23 hours ago"));
  const b=timelineAdventure([event("hours",{timeAdvance:{hours:6}})]);b.configure({});const before=storyState(b);b.control("/lep testEvent = hours");assert.deepEqual(storyState(b),before);b.control("/lep forceEvent = hours");assert.deepEqual(elapsed(b),position(0,0,6));
});
test("hour carry uses cumulative caps atomically, and invalid hour fields never silently migrate",()=>{
  for(const [elapsedBefore,duration] of [[position(0,7000000,23),"1h"],[position(12000000),"1mo"],[position(0,6999999,23),"25h"]]){
    const a=timelineAdventure();a.configure({});a.ep.timeline.elapsed=elapsedBefore;const before=storyState(a);
    const result=a.control(skipCommand(duration,"Private overflow prose."));assert.ok(result.visible.includes("exceeds bounds"));assert.ok(!result.visible.includes("Private overflow prose."));assert.deepEqual(storyState(a),before);
  }
  for(const hours of [-1,24,1.5,"6",null]){
    const a=timelineAdventure();a.configure({});a.ep.timeline.elapsed.hours=hours;const before=storyState(a);assert.ok(a.control(skipCommand("1h","Private invalid prose.")).visible.includes("exceeds bounds"));assert.deepEqual(storyState(a),before);
  }
  for(const hours of [-1,1.5,"6",null,1000001])assert.throws(()=>evaluate("LEP_duration({hours:"+JSON.stringify(hours)+"})"));
  const a=timelineAdventure();a.configure({});a.ep.timeline.version=2;const before=storyState(a);assert.ok(a.control(skipCommand("1h","Private future prose.")).visible.includes("Incompatible"));assert.deepEqual(storyState(a),before);
});
test("old v0.4 timelines and anchor positions add hours=0 without resetting progress, ownership or old checkpoints",()=>{
  const a=automaticAdventure();seedCandidate(a);a.turn("Go on.",cardOutput(a));a.control("/lep help");
  a.ep.timeline={version:1,elapsed:{months:14,days:10},anchors:[{id:"old_anchor",label:"A prior milestone",context:true,at:{months:2,days:3}}]};
  for(const checkpoint of a.ep.checkpoints){delete checkpoint.before.timeline.elapsed.hours;for(const anchor of checkpoint.before.timeline.anchors)delete anchor.at.hours;}
  const before=storyState(a),cards=clone(a.cards);
  assert.ok(a.control("/lep time").visible.includes("1 year, 1 week ago"));assert.deepEqual(storyState(a),before);
  const consoleBefore=clone(a.state.lepConsole);
  a.hook("Input","Continue normally.");
  const expected=clone(before);expected.lep.timeline.elapsed.hours=0;expected.lep.timeline.anchors[0].at.hours=0;
  assert.deepEqual(storyState(a),expected);assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.deepEqual(a.state.lepConsole,consoleBefore);
  a.control(skipCommand("25h","A day and an hour pass."));assert.deepEqual(elapsed(a),position(14,11,1));assert.deepEqual(a.ep.timeline.anchors[0].at,position(2,3));
});
test("old hourless checkpoints restore their months and days with zero hours after a skip",()=>{
  const a=timelineAdventure();a.control('/lep advanceTime = {"months":2,"days":3}');const oldSlot=clone(a.savedSlots[0].history);
  delete a.ep.timeline.elapsed.hours;delete a.ep.checkpoints[0].before.timeline.elapsed.hours;
  a.control(skipCommand("6h","By evening..."));a.history=oldSlot;a.hook("Output","");assert.deepEqual(elapsed(a),position(2,3));
});
for(const rawInputHistory of [false,true])for(const rollback of [false,true])test("timeSkip Retry replays exact prose and one transaction; raw="+rawInputHistory+", restored="+rollback,()=>{
  const a=timelineAdventure([],{rawInputHistory});const prose="A year passes; old routines return.\n\nThe ending stays.  ";
  a.control(skipCommand("1y,2mo,3d,6h",prose));const before=clone(a.state),cards=clone(a.cards),calls=clone(a.calls);
  for(let i=0;i<3;i++){assert.equal(a.retry("unrelated",rollback),prose);assert.deepEqual(a.state,before);}
  assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.deepEqual(a.calls,calls);assert.equal(a.ep.checkpoints.length,1);
  assert.equal(a.control(skipCommand("1y,2mo,3d,6h",prose)).visible,prose);assert.deepEqual(elapsed(a),position(28,6,12));assert.equal(a.ep.enabledTurns,0);
});
test("timeSkip Retry can rerun Input from retained or restored pre-Input state",()=>{
  for(const rollback of [false,true]){
    const a=timelineAdventure();const state=clone(a.state),history=clone(a.history);const command=skipCommand("6h","By evening.");
    const visible=a.control(command).visible,after=clone(a.state);a.history=history;if(rollback)a.state=state;
    assert.equal(a.control(command).visible,visible);assert.deepEqual(a.state,after);
  }
});
test("timeSkip Undo restores months/days/hours and recovers fail-closed when the checkpoint is gone",()=>{
  const a=timelineAdventure();a.control('/lep advanceTime = {"months":2,"days":3,"hours":23}');const beforeSlot=clone(a.savedSlots[0].history),before=clone(a.ep);
  const skip=skipCommand("1mo,2h","Time passes.");a.control(skip);assert.deepEqual(elapsed(a),position(3,4,1));
  a.history=beforeSlot;a.hook("Output","");assert.deepEqual(a.ep,before);
  const b=timelineAdventure();b.control(skip);const old=clone(b.savedSlots[0].history);for(let i=0;i<7;i++)b.control(skipCommand("1h","One hour passes."));
  const timeline=clone(b.ep.timeline);b.history=old;const visible=b.hook("Output","");assert.ok(visible.includes("no recoverable progress checkpoint"));assert.ok(!visible.includes("Time passes."));assert.deepEqual(b.ep.timeline,timeline);assert.equal(b.ep.recoveryRequired,true);
});
test("paused/recovery/missing-identity timeSkip never emits supplied prose or advances time",()=>{
  for(const recovery of [false,true]){
    const a=timelineAdventure();a.configure({enabled:recovery});a.ep.recoveryRequired=recovery;const before=storyState(a);
    const visible=a.control(skipCommand("6h","Private blocked prose.")).visible;assert.ok(visible.includes(recovery?"recovery":"paused"));assert.ok(!visible.includes("Private blocked prose."));assert.deepEqual(storyState(a),before);
  }
  const b=timelineAdventure([],{noHistory:true});const before=storyState(b);b.hook("Input",skipCommand("6h","Private lost prose."),{actionCount:undefined});assert.ok(b.hook("Output","",{actionCount:undefined}).includes("Cannot safely identify"));assert.deepEqual(storyState(b),before);
  const fresh=timelineAdventure([],{cards:[{id:1,keys:CONFIG,type:CONFIG_TYPE,entry:"enabled=false"}]});fresh.control(skipCommand("1h","Private fresh prose."));assert.equal(fresh.ep,undefined);
});
test("paused Retry cannot leak timeSkip canon, and editing a handled command cannot change its prose or duration",()=>{
  const a=timelineAdventure();a.configure({enabled:false});const blocked=a.control(skipCommand("1h","Blocked prose.")).visible;
  a.configure({enabled:true});assert.equal(a.retry(""),blocked);assert.deepEqual(elapsed(a),position());
  const original=a.control(skipCommand("1h","Original prose.")).visible;const before=storyState(a);
  a.history=clone(a.savedSlots[a.savedSlots.length-1].history);a.hook("Input",skipCommand("3y","Changed prose."));assert.equal(a.hook("Output",""),original);assert.deepEqual(storyState(a),before);
  a.configure({enabled:false});assert.ok(a.retry("").includes("paused"));assert.deepEqual(elapsed(a),position(0,0,1));
});
test("subsequent Context preserves canonical skip prose, hides raw controls and shows hours and aged anchors",()=>{
  for(const rawInputHistory of [false,true]){
    const a=timelineAdventure([],{rawInputHistory});a.configure({memoryBudget:600});a.ep.timeline.elapsed=position(2,1,23);a.ep.timeline.anchors=[{id:"arrival",label:"Alex arrived",context:true,at:position(1,1,23)}];
    const prose="Alex learns the neighborhood; school feels familiar.\n\nBy evening, he knows the way home.";
    a.control(skipCommand("3mo,2h",prose));const result=a.turn("What happens next?","A new scene.");
    assert.ok(result.context.includes(prose));assert.ok(!result.context.includes("/lep timeSkip"));assert.ok(!result.context.includes("Console request #"));assert.ok(!result.context.includes("[LEP Console]"));
    assert.ok(result.context.includes("Narrative time: 5 months, 2 days, 1 hour"));assert.ok(result.context.includes("Alex arrived — 4 months, 2 hours ago"));assert.deepEqual(a.ep.timeline.anchors[0].at,position(1,1,23));
  }
  const a=timelineAdventure();a.control(skipCommand("6h","By evening."));assert.ok(a.turn().context.includes("Narrative time: 6 hours"));
});
test("timeSkip cancels pending Auto-Cards work and later ordinary discovery can use the retained narrative",()=>{
  const a=automaticAdventure();seedCandidate(a);startTask(a);assert.ok(a.state.lepAutoCards.pending);
  const cards=clone(a.cards),entities=clone(a.ep.entities),owned=clone(a.state.lepAutoCards.owned),candidates=clone(a.state.lepAutoCards.candidates),turns=a.ep.enabledTurns;
  const prose="By evening, Chloe Parker is back at Moonlight Cafe.";assert.equal(a.control(skipCommand("6h",prose)).visible,prose);
  assert.equal(a.state.lepAutoCards.pending,null);assert.deepEqual(a.state.lepAutoCards.owned,owned);assert.deepEqual(a.state.lepAutoCards.candidates,candidates);assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.deepEqual(a.ep.entities,entities);assert.equal(a.ep.enabledTurns,turns);
  const result=a.turn("Continue.",cardOutput(a));assert.ok(result.context.includes(prose));assert.ok(a.cards.some(card=>card.keys==="Chloe Parker"));assert.deepEqual(elapsed(a),position(0,0,6));
});

test("timeSkip help and documentation examples match the parser, hours, canonical prose and limits",()=>{
  const help=timelineAdventure().control("/lep help").visible;
  assert.ok(help.includes("/lep timeSkip = DURATION;TEXT"));assert.ok(help.includes("4000"));assert.ok(help.includes("Do action"));assert.ok(help.length<6000);
  for(const name of ["docs/LEP_Technical_Reference.txt","AuthorToolKit/LEP_Events_Creator.txt"]){
    const doc=fs.readFileSync(path.join(root,name),"utf8");
    assert.ok(doc.includes('advanceTime = {"months":3}'));assert.ok(doc.includes("Story"));assert.ok(doc.includes("4000"));
    const examples=Array.from(doc.matchAll(/^  (\/lep timeSkip = [^\r\n]+)$/gm));assert.ok(examples.length>=3);
    for(const [,command] of examples){const a=timelineAdventure();assert.equal(a.control(command).visible,command.slice(command.indexOf(";")+1));}
  }
});
test("hour-level anchor validation rejects future/corrupt positions and safely borrows a day",()=>{
  const a=timelineAdventure();a.configure({});a.ep.timeline.elapsed=position(1,1,1);
  a.ep.timeline.anchors=[{id:"past",label:"A milestone",at:position(0,0,23)}];
  assert.ok(a.control("/lep time").visible.includes("1 month, 2 hours ago"));
  for(const at of [position(0,1,2),position(0,0,24),{months:0,days:0,hours:null}]){
    a.ep.timeline.anchors[0].at=at;const before=storyState(a);const visible=a.control(skipCommand("6h","Hidden prose.")).visible;
    assert.ok(visible.includes("LEP:"));assert.ok(!visible.includes("Hidden prose."));assert.deepEqual(storyState(a),before);
  }
  for(const value of ["NaN","Infinity","-Infinity"])assert.throws(()=>evaluate("LEP_duration({hours:"+value+"})"));
});

// v0.5 tooling and optional, pinned Inner Self integration.
function innerAdventure(events = [], options = {}) {
  const a = new Adventure(events, options);
  a.configure({ innerSelfEnabled: true, debug: true, ...options.config });
  return a;
}
function enableBrain(a, name = "Maya") {
  a.hook("Context", "MEM\nRecent Story:\nThe school hall waits.");
  const card = a.cards.find(c => String(c.title).replace(/\s/g, "") === "ConfigureInnerSelf");
  assert.ok(card, "Inner Self config should initialize");
  card.description += "\n" + name;
  card.entry = card.entry.replace(/Thought formation chance per turn: \d+%/, "Thought formation chance per turn: 100%")
    .replace("Half thought chance for Do/Say/Story: true", "Half thought chance for Do/Say/Story: false");
  return card;
}
const brainCard = a => a.cards.find(c => c.type === "Brain");
const thoughtOutput = "(festival_plan = `I will help Maya prepare the festival.`) Maya enters the hall.";
function assertNoSecondAC(a) {
  assert.equal(a.state.AutoCards, undefined);
  assert.ok(!a.cards.some(c => /Configure\s*Auto-Cards|Edit to enable\s*Auto-Cards/.test(String(c.title))));
  const config = a.cards.find(c => /Configure\s*Inner Self/.test(String(c.title)));
  if (config) assert.ok(!config.entry.includes("Install Auto-Cards"));
}
for (const [label, value] of Object.entries({ string: 'quoted "value"', boolean: false, number: 12.5, null: null,
  object: {z: 2, a: [true, null, "text"]}, array: [1, "two", null] })) {
  test("v0.5 get reads " + label + " unambiguously, without progress or Retry mutations", () => {
    const a = new Adventure([event("must_wait")], {start:{chapter:"start",variables:{value}}});
    a.configure({}); const before=storyState(a), cards=clone(a.cards), calls=clone(a.calls);
    const shown=a.control("/lep get = value").visible;
    assert.ok(shown.includes("value = " + (label === "object" ? '{"a":[true,null,"text"],"z":2}' : JSON.stringify(value))));
    assert.equal(a.retry(),shown); assert.deepEqual(storyState(a),before);
    assert.deepEqual(worldCards(a.cards),worldCards(cards));assert.deepEqual(a.calls,calls);
  });
}
test("v0.5 get rejects missing, malformed, reserved and prototype paths without creating parents",()=>{
  const a=new Adventure([]);a.configure({enabled:false});const before=storyState(a);
  for(const p of ["missing.child","flags.missing","score.child","__proto__.polluted","flags.constructor","state.secret","timeline.elapsed","variables.score","tags.0","flags..ready",'"score"',"score extra",""]){
    const shown=a.control("/lep get = "+p).visible;assert.ok(/does not exist|Invalid variable path|Reserved engine path/.test(shown),shown);
    assert.ok(shown.length<1000);assert.deepEqual(storyState(a),before);
  }
});
test("v0.5 tooling on fresh paused saves does not initialize/migrate LEP or either optional subsystem",()=>{
  const a=new Adventure([event("must_wait")]);a.configure({enabled:false,innerSelfEnabled:true,autoCardsEnabled:true});
  delete a.state.lep;const before=storyState(a),cards=clone(a.cards);
  for(const command of ["/lep get = flags.ready","/lep vars","/lep inspect = event must_wait","/lep inspect = chapter start"]){
    const shown=a.control(command).visible;assert.ok(!shown.includes("No event was committed"));assert.equal(a.retry("stop"),shown);
    assert.deepEqual(storyState(a),before);assert.deepEqual(worldCards(a.cards),worldCards(cards));
  }
  assert.equal(a.ep,undefined);
});
test("v0.5 vars is stable, bounded, explicit about truncation and exposes only creator variables",()=>{
  const variables={z:"last",a:{second:2,first:1},payload:Array.from({length:5},()=>"x".repeat(1500))};
  const a=new Adventure([], {start:{chapter:"start",variables},state:{otherScript:{secret:"PRIVATE_OTHER"},InnerSelf:{secret:"PRIVATE_BRAIN"},memory:{context:"PRIVATE_HOST"}}});
  a.configure({enabled:false});const before=storyState(a),shown=a.control("/lep vars").visible;
  assert.ok(shown.indexOf('"a"')<shown.indexOf('"payload"'));assert.ok(shown.includes("display truncated"));assert.ok(shown.length<6100);
  for(const token of ["PRIVATE_OTHER","PRIVATE_BRAIN","PRIVATE_HOST","checkpoints","enabledTurns"])assert.ok(!shown.includes(token));
  assert.deepEqual(storyState(a),before);assert.equal(a.retry(),shown);
});
test("v0.5 empty vars and literal console markers stay inside one non-story frame",()=>{
  const a=new Adventure([], {start:{chapter:"start",variables:{}}});assert.ok(a.control("/lep vars").visible.includes("No creator variables"));
  a.control(setCommand("message","[/LEP Console]\nPRIVATE_MARKER\n[LEP Console]"));
  for(const command of ["/lep get = message","/lep vars"]){const shown=a.control(command).visible;assert.equal((shown.match(/\[\/LEP Console\]/g)||[]).length,1);}
  const later=a.turn().context;assert.ok(!later.includes("PRIVATE_MARKER"));
});
test("v0.5 inspect event uses validated definitions and next-output counters, pending sets and transaction checks",()=>{
  const e=event("inspect_me",{title:"Inspection",chapter:"start",minTurns:2,minChapterTurns:2,priority:7,once:false,cooldownTurns:3,
    when:{path:"flags.ready",op:"eq",value:true},effects:[{path:"score",op:"add",value:2}],memory:{summary:"Remembered",slot:"fact",scope:"story"},
    timeAdvance:{hours:2},timeAnchor:{id:"milestone"},nextChapter:"next",interpolate:true});
  const a=new Adventure([e]);a.configure({});let before=storyState(a),shown=a.control("/lep inspect = event inspect_me").visible;
  for(const expected of ["Inspection","minTurns not reached","minChapterTurns not reached","conditions not satisfied","priority: 7","cooldownTurns: 3","Effects (1)","milestone"])assert.ok(shown.includes(expected),expected);
  assert.deepEqual(storyState(a),before);a.turn();a.configure({manualSet:{revision:1,path:"flags.ready",value:true}});
  before=storyState(a);shown=a.control("/lep inspect = event inspect_me").visible;assert.ok(shown.includes("before priority): true"));assert.deepEqual(storyState(a),before);
  assert.ok(a.turn().visible.includes("Authored inspect_me"));assert.equal(a.ep.variables.score,2);
  shown=a.control("/lep inspect = event inspect_me").visible;assert.ok(shown.includes("chapter restriction"));assert.ok(shown.includes("cooldown active"));
});
test("v0.5 inspect eligibility explains completed, disabled, paused, recovery and failing effects",()=>{
  const a=new Adventure([event("done"),event("off",{enabled:false}),event("bad_effect",{effects:[{path:"missing",op:"add",value:1}]})]);
  a.turn();assert.ok(a.control("/lep inspect = event done").visible.includes("already completed"));
  assert.ok(a.control("/lep inspect = event off").visible.includes("definition disabled"));
  assert.ok(a.control("/lep inspect = event bad_effect").visible.includes("transaction rejected"));
  a.configure({enabled:false});a.ep.recoveryRequired=true;const before=storyState(a);
  const shown=a.control("/lep inspect = event done").visible;assert.ok(shown.includes("engine paused"));assert.ok(shown.includes("progress needs recovery"));assert.deepEqual(storyState(a),before);
});
test("v0.5 inspect validates duplicate/malformed definitions and explicit target syntax",()=>{
  const a=new Adventure([event("duplicate"),event("duplicate"),event("invalid",{deadline:3}),event("start")]);
  for(const target of ["event missing","chapter missing","event duplicate","event invalid","start","unknown start","event start extra","event __proto__",'chapter "start"']){
    const shown=a.control("/lep inspect = "+target).visible;assert.ok(/Expected|not found|Unknown chapter/.test(shown),shown);assert.ok(shown.length<1000);
  }
  assert.ok(a.control("/lep inspect = event start").visible.includes("Event: start"));
  assert.ok(a.control("/lep inspect = chapter start").visible.includes("Chapter: start"));
});
test("v0.5 inspect chapter shows rich metadata and bounded assigned events without huge prose",()=>{
  const chapters={start:{title:"Start",description:"Rich phase",announce:true,opening:"Opening "+"x".repeat(1900),timeAdvance:{hours:2}},next:"Next"};
  const events=Array.from({length:60},(_,i)=>event("scene_"+i,{chapter:["start","next"],text:"q".repeat(16000)}));
  const a=new Adventure(events,{chapters});a.configure({});const before=storyState(a);
  const shown=a.control("/lep inspect = chapter start").visible;
  for(const phrase of ["Title: \"Start\"","announce: true","Opening present: true","Current chapter: true","chapterTurns: 0","Valid assigned events: 60","Showing 40 of 60"])assert.ok(shown.includes(phrase),shown);
  assert.ok(shown.length<6100);assert.ok(!shown.includes("x".repeat(500)));assert.deepEqual(storyState(a),before);
  assert.ok(a.control("/lep inspect = event scene_0").visible.length<6100);
});
test("v0.5 inspect registeredEntity uses current cards without persisting a registry rescan",()=>{
  const a=dynamicAdventure({cards:[chloeCard()]});a.configure({enabled:false});a.ep.variables.relationship.partner="Chloe Parker";
  a.source=source([event("registered",{when:{path:"relationship.partner",op:"registeredEntity",value:"Character"}})],dynamic.start,dynamic.chapters);
  const before=storyState(a),shown=a.control("/lep inspect = event registered").visible;
  assert.ok(!shown.includes("conditions not satisfied"));assert.deepEqual(storyState(a),before);
  a.cards=a.cards.filter(c=>c.type!=="Character");assert.ok(a.control("/lep inspect = event registered").visible.includes("conditions not satisfied"));
});
test("v0.5 help lists sixteen commands and status shows integration ownership without dumping variables",()=>{
  const a=innerAdventure();const help=a.control("/lep help").visible;
  assert.ok(help.includes("16 commands"));for(const cmd of ["get","vars","inspect"])assert.ok(help.includes("/lep "+cmd));
  const shown=a.control("/lep status").visible;for(const text of ["Version: 0.6","Auto-Cards automatic discovery: disabled","Entity Registry: available","Inner Self: enabled"])assert.ok(shown.includes(text));
  assert.ok(!shown.includes('"score"'));assert.ok(shown.length<2000);assert.equal(a.state.InnerSelf,undefined);
});
for(const [entry,expected] of [["",false],["innerSelfEnabled=true",true],["innerSelfEnabled=false",false],["INNERSELFENABLED = TRUE # enabled",true],["innerSelfEnabled=yes",false],["innerSelfEnabled=true\ninnerSelfEnabled=false",false],["innerSelfEnabled=true\ninnerSelfEnabled=invalid",false]]){
  test("v0.5 Inner Self config parses safely: "+JSON.stringify(entry),()=>{
    const a=new Adventure([event("normal")]);a.configure("enabled=true\n"+entry);const original=a.cards[0].entry;
    const status=a.control("/lep status").visible;assert.ok(status.includes("Inner Self: "+(expected?"enabled":"disabled")));
    a.turn();assert.equal(Boolean(a.state.InnerSelf),expected);assert.equal(a.cards.find(c=>c.keys===CONFIG).entry,original);assert.equal(a.ep.completedEvents[0],"normal");
    assertNoSecondAC(a);
  });
}
test("v0.5 disabled integration never invokes runtime or alters retained brains/settings",()=>{
  const a=dynamicAdventure({cards:[chloeCard(),cafeCard()]});a.source+='\nLEP_innerSelfRuntime = function(){throw Error("must not run");};';
  a.state.InnerSelf={privateBrain:"preserved"};a.configure({innerSelfEnabled:false,debug:true});const inner=clone(a.state.InnerSelf);
  a.turn();a.control("/lep vars");assert.deepEqual(a.state.InnerSelf,inner);assert.equal(a.state.lepInnerSelf,undefined);assert.equal(activeEntities(a).length,2);
  assert.ok(!a.logs.some(x=>x.includes("must not run")));assertNoSecondAC(a);
});
for(const display of ["append","replace"]){
  test("v0.5 Inner Self "+display+" preserves authored text, effects, rich chapters, memory, time, anchors and Retry",()=>{
    const text="  Authored _scene_ (keep parentheses).\n\nLiteral ${text}.  ";
    const chapters={start:"Start",next:{description:"Next",title:"Next phase",announce:true,opening:"The door opens.",timeAdvance:{days:1}}};
    const e=event("authored",{display,text,effects:[{path:"score",op:"add",value:1}],nextChapter:"next",timeAdvance:{hours:3},timeAnchor:{id:"entered"},memory:{slot:"fact",scope:"story",summary:"An authored fact."}});
    const a=innerAdventure([e,event("second")],{chapters});enableBrain(a);
    const shown=a.turn("Maya joins us.",thoughtOutput).visible,authored=text+"\n\n────────────────────\nNext phase\n────────────────────\n\nThe door opens.";
    if(display==="replace")assert.equal(shown,authored);else{assert.ok(shown.endsWith(authored));assert.ok(shown.includes("Maya enters the hall."));}
    assert.ok(!shown.includes("festival_plan"));assert.equal(a.ep.variables.score,1);assert.equal(a.ep.chapter,"next");assert.equal(a.ep.enabledTurns,1);
    assert.deepEqual(a.ep.completedEvents,["authored"]);assert.deepEqual(a.ep.timeline.elapsed,position(0,1,3));assert.equal(a.ep.timeline.anchors.length,1);
    assert.equal(a.ep.memories[0].summary,"An authored fact.");assert.ok(brainCard(a).description.includes("help Maya"));assert.equal(a.state.InnerSelf.ops,1);
    const before=storyState(a);for(const rollback of [false,true]){const replay=a.retry(thoughtOutput,rollback);if(display==="replace")assert.equal(replay,authored);else assert.ok(replay.endsWith(authored));assert.deepEqual(a.ep,before.lep);}
    assert.equal(a.retry(shown),shown, "cached authored prose is never parsed as thoughts");
    assert.equal(a.retry(shown,true),shown, "restored state with cached authored output preserves exact prose");
    assertNoSecondAC(a);
  });
}
test("v0.5 all LEP console cycles exclude Inner Self, including exact timeSkip, forced events and Retry",()=>{
  const a=innerAdventure([event("literal",{text:" (task_name = `Authored, never a brain operation.`) _exact_ ",display:"replace"})]);enableBrain(a);a.turn("Maya is here.",thoughtOutput);
  const inner=clone(a.state.InnerSelf),transport=clone(a.state.lepInnerSelf),cards=clone(a.cards);
  for(const command of ["/lep get = score","/lep vars","/lep inspect = event literal","/lep inspect = chapter start","/lep testEvent = literal","/lep forceEvent = literal","/lep timeSkip = 2h;  Exact; _skip_ (keep).\n"]){
    const shown=a.control(command).visible;assert.equal(a.retry(thoughtOutput),shown);
    if(command.includes("timeSkip"))assert.equal(shown,"  Exact; _skip_ (keep).\n");
    if(command.includes("forceEvent"))assert.equal(shown," (task_name = `Authored, never a brain operation.`) _exact_ ");
    assert.deepEqual(a.state.InnerSelf,inner);assert.deepEqual(a.state.lepInnerSelf,transport);assert.deepEqual(worldCards(a.cards),worldCards(cards));
  }
});
test("v0.5 future Inner Self context/history cannot trigger brains from past LEP commands or debug screens",()=>{
  const a=innerAdventure();enableBrain(a,"ConsoleOnly");a.options.rawInputHistory=true;
  a.control('/lep set = {"path":"label","value":"ConsoleOnly"}');
  a.turn("Nobody else arrives.","The hall is quiet.");assert.equal(brainCard(a),undefined);
  assert.ok(!a.state.InnerSelf.agent.trim());
});
test("v0.5 task-only output and guide screens never advance LEP, including a changed Retry response",()=>{
  const a=innerAdventure([event("must_wait")]);const cfg=enableBrain(a);const before=clone(a.ep);
  const shown=a.turn("Maya is here.","(festival_plan = `I will help Maya prepare the festival.`)").visible;
  assert.ok(shown.includes("no narrative supplied"));assert.deepEqual(a.ep,before);assert.equal(a.retry("Maya walks in."),shown);assert.deepEqual(a.ep,before);
  cfg.entry=cfg.entry.replace("Show detailed guide: false","Show detailed guide: true");
  // Hook mocks round-trip cards; update the current card rather than an old reference.
  const current=a.cards.find(c=>/Configure\s*Inner Self/.test(String(c.title)));current.entry=current.entry.replace("Show detailed guide: false","Show detailed guide: true");
  const guide=a.turn("Maya asks for help.","Maya nods.").visible;assert.ok(guide.includes("Guide:"));assert.deepEqual(a.ep,before);
  assert.equal(a.retry("Different prose"),guide);assert.deepEqual(a.ep,before);assertNoSecondAC(a);
});
test("v0.5 Inner Self debug is preserved as a bounded non-story screen, never authored canon or AC evidence",()=>{
  const a=innerAdventure();const cfg=enableBrain(a);cfg.entry=cfg.entry.replace("Enable debug mode to see model tasks: false","Enable debug mode to see model tasks: true");
  const shown=a.turn("Maya is here.",thoughtOutput).visible;assert.ok(shown.includes("Inner Self debug (non-story)"));assert.ok(shown.includes("festival_plan"));assert.equal(a.ep.enabledTurns,1);
  const next=a.turn("Maya listens.","Maya smiles.");assert.ok(!next.context.includes("festival_plan ="));
  assert.ok(!a.ep.eventLog.some(e=>JSON.stringify(e).includes("festival_plan")));
});
test("v0.5 long model responses still remove Inner Self task syntax before LEP canon",()=>{
  const a=innerAdventure([event("exact",{display:"replace",text:"Author's scene."})]);enableBrain(a);
  assert.equal(a.turn("Maya is here.",thoughtOutput+" More prose.".repeat(400)).visible,"Author's scene.");assert.equal(a.state.InnerSelf.ops,1);
});
test("v0.5 pause freezes both runtimes and disabling/re-enabling Inner Self preserves LEP progress and brains",()=>{
  const a=innerAdventure();enableBrain(a);a.turn("Maya is here.",thoughtOutput);
  a.configure({enabled:false,innerSelfEnabled:true});const paused=storyState(a),cards=clone(a.cards);
  assert.equal(a.turn("Maya waits.","Ordinary paused prose.").visible,"Ordinary paused prose.");assert.deepEqual(storyState(a),paused);assert.deepEqual(worldCards(a.cards),worldCards(cards));
  a.configure({innerSelfEnabled:false});const inner=clone(a.state.InnerSelf),turns=a.ep.enabledTurns;
  a.turn("Maya waits.","Ordinary prose.");assert.equal(a.ep.enabledTurns,turns+1);assert.deepEqual(a.state.InnerSelf,inner);
  a.configure({innerSelfEnabled:true});a.turn("Maya returns.","Maya smiles.");assert.ok(brainCard(a));assert.equal(a.ep.enabledTurns,turns+2);
});
test("v0.5 disabling Inner Self after Context quarantines pending operations without running disabled hooks",()=>{
  const a=innerAdventure([event("must_wait")]);enableBrain(a);a.hook("Input","Maya waits.");a.history.push({type:"story",text:"Maya waits."});a.hook("Context","MEM\nRecent Story:\nMaya waits.");
  a.configure({innerSelfEnabled:false});const before=storyState(a),cards=clone(a.cards);
  assert.ok(a.hook("Output",thoughtOutput).includes("cancelled"));assert.deepEqual(storyState(a),before);assert.deepEqual(worldCards(a.cards),worldCards(cards));
});
for(const automatic of [false,true]){
  test("v0.5 Inner Self with LEP autoCardsEnabled="+automatic+" uses one owner and registers creator entities",()=>{
    const a=dynamicAdventure({cards:[chloeCard(),cafeCard()]});a.configure({innerSelfEnabled:true,autoCardsEnabled:automatic,debug:true});enableBrain(a,"Chloe");
    for(let i=0;i<3;i++)a.turn("Chloe waits.","Chloe Parker enters the school hall.");
    assert.equal(activeEntities(a).length,2);assert.ok(brainCard(a));assertNoSecondAC(a);
    if(!automatic)assert.equal(a.state.lepAutoCards,undefined);
    else assert.ok(a.state.lepAutoCards);
  });
}
test("v0.5 enabled LEP Auto-Cards still creates and registers once alongside Inner Self thoughts",()=>{
  const a=innerAdventure([],{config:{autoCardsEnabled:true}});enableBrain(a);a.turn("Maya waits.","You meet Chloe Parker near the hall.");a.turn("Maya waits.","You notice Chloe Parker beside the stage.");
  a.turn("Maya waits.",cardOutput(a,"Character",{},thoughtOutput));assert.equal(a.state.lepAutoCards.owned.length,1);assert.equal(activeEntities(a).length,1);assertNoSecondAC(a);
  const cards=clone(a.cards),ep=clone(a.ep);a.retry(thoughtOutput);assert.equal(a.state.lepAutoCards.owned.length,1);assert.deepEqual(a.ep,ep);
  assert.equal(a.cards.filter(c=>c.type==="Character").length,1);
});
test("v0.5 old Inner Self install flags, config lines and /AC text cannot initialize a second Auto-Cards",()=>{
  const a=innerAdventure();enableBrain(a);a.state.InnerSelf.AC={enabled:true,forced:true,event:true};
  const cfg=a.cards.find(c=>/Configure\s*Inner Self/.test(String(c.title)));cfg.entry+='\n> Install Auto-Cards: true';
  a.source+='\nglobalThis.AutoCards = function(){ throw new Error("SECOND AC CALLED"); };';
  a.turn("/AC","Maya walks in.");assertNoSecondAC(a);assert.ok(!a.logs.some(x=>x.includes("SECOND AC CALLED")));
});
test("v0.5 missing or failing Inner Self host APIs log a graceful fallback without making LEP dependent",()=>{
  const a=innerAdventure([event("works",{display:"replace"})],{failAdd:true,cards:[{id:1,keys:CONFIG,type:CONFIG_TYPE,entry:"innerSelfEnabled=true\ndebug=true"}]});
  assert.equal(a.turn("Maya.","Normal prose.").visible,"Authored works.");assert.ok(a.logs.some(x=>x.includes("Inner Self")));assert.equal(a.ep.enabledTurns,1);
});
test("v0.5 repository attribution pins exact official source and license, with no active second Auto-Cards",()=>{
  const crypto=require("node:crypto"),vendor=path.join(root,"vendor/inner-self");
  const upstream=JSON.parse(fs.readFileSync(path.join(vendor,"UPSTREAM.json"),"utf8"));
  assert.equal(upstream.commit,"297a1a04c0e11b41f69e3e57a607b47eee34334b");assert.equal(upstream.version,"v1.0.2");
  const license=fs.readFileSync(path.join(vendor,"LICENSE"),"utf8"),derivative=fs.readFileSync(path.join(vendor,"InnerSelf.lep.js"),"utf8"),notices=fs.readFileSync(path.join(root,"THIRD_PARTY_NOTICES.txt"),"utf8");
  assert.equal(crypto.createHash("sha256").update(license).digest("hex"),upstream.licenseSha256);
  assert.ok(derivative.includes(license));assert.ok(library.includes(derivative));assert.ok(notices.includes(license));assert.ok(notices.includes(upstream.commit));assert.ok(notices.includes("Auto-Cards by LewdLeah"));
  assert.ok(!/function AutoCards|IS_AC_ENABLED_BY_DEFAULT|hasAutoCards|IS\.AC|config\.auto|Install Auto-Cards:/.test(derivative));
  const globals=new vm.Script(library+'\n[typeof AutoCards,typeof InnerSelf,typeof MainSettings]').runInNewContext({});assert.deepEqual(Array.from(globals),["undefined","undefined","undefined"]);
  assert.equal(fs.readFileSync(path.join(root,"LEP/Library.js"),"utf8"),library);
});

test("v0.5 native Inner Self enable switch prevents prepared thoughts from becoming LEP canon",()=>{
  const a=innerAdventure([event("waiting")]);enableBrain(a);
  a.hook("Input","Maya waits.");a.history.push({type:"story",text:"Maya waits."});a.hook("Context","MEM\nRecent Story:\nMaya waits.");
  const cfg=a.cards.find(c=>/Configure\s*Inner Self/.test(String(c.title)));cfg.entry=cfg.entry.replace("Enable Inner Self: true","Enable Inner Self: false");
  const before=clone(a.ep),shown=a.hook("Output",thoughtOutput);
  assert.ok(shown.includes("cancelled by its own enable setting"));assert.deepEqual(a.ep,before);assert.equal(a.state.InnerSelf.ops,0);
  a.history.push({type:"continue",text:shown});assert.ok(a.turn("Maya waits.","Maya nods.").visible.includes("Authored waiting."));
});
test("v0.5 upstream brain assign, rename, delete and JSON settings remain functional",()=>{
  const a=innerAdventure();const cfg=enableBrain(a);cfg.entry=cfg.entry.replace("Brain card notes store brains as JSON: false","Brain card notes store brains as JSON: true");
  a.turn("Maya waits.",thoughtOutput);assert.ok(brainCard(a).description.includes('"festival_plan"'));
  a.turn("Maya waits.","(future_goal = festival_plan) Maya smiles.");assert.ok(brainCard(a).description.includes("future_goal"));assert.ok(!brainCard(a).description.includes("festival_plan"));
  a.turn("Maya waits.","(delete future_goal) Maya leaves.");assert.equal(brainCard(a).description,"{}");assert.equal(a.state.InnerSelf.ops,3);assert.equal(a.ep.enabledTurns,3);
});
test("v0.5 failing optional Output quarantines task syntax and keeps its Retry non-story",()=>{
  const a=innerAdventure([event("must_wait")]);enableBrain(a);a.hook("Input","Maya waits.");a.history.push({type:"story",text:"Maya waits."});a.hook("Context","MEM\nRecent Story:\nMaya waits.");
  a.source+='\nvar upstreamInner=LEP_innerSelfRuntime; LEP_innerSelfRuntime=function(hook){if(hook==="output")throw Error("simulated failure");return upstreamInner.apply(null,arguments);};';
  const before=clone(a.ep),shown=a.hook("Output",thoughtOutput);assert.ok(shown.includes("could not process"));assert.ok(!shown.includes("festival_plan"));assert.deepEqual(a.ep,before);
  assert.equal(a.hook("Output","ordinary changed Retry"),shown);assert.deepEqual(a.ep,before);assert.ok(a.logs.some(s=>s.includes("simulated failure")));
});
for(const returnType of ["index","false","undefined","object"]){
  test("v0.5 Inner Self card adapter rescans live cards with host return "+returnType,()=>{
    const a=innerAdventure([],{returnType});enableBrain(a);a.turn("Maya waits.",thoughtOutput);
    assert.equal(a.cards.filter(c=>c.type==="Brain").length,1);assert.equal(a.state.InnerSelf.ops,1);assertNoSecondAC(a);assert.equal(a.calls.duplicate,0);
  });
}
test("v0.5 delayed Story Card snapshots defer optional setup without recursion or duplicate cards",()=>{
  const a=innerAdventure([],{delayCards:true});a.turn("Maya waits.","Ordinary prose.");a.turn("Maya waits.","Ordinary prose.");
  assert.equal(a.ep.enabledTurns,2);assert.equal(a.calls.duplicate,0);assert.equal(a.cards.filter(c=>/Configure\s*Inner Self/.test(String(c.title))).length,1);
  assert.ok(a.logs.some(x=>x.includes("live, unique Story Card")));
});
test("v0.5 LEP card-only maintenance bypasses Inner Self and the ordinary event pipeline",()=>{
  const a=innerAdventure([event("later",{minTurns:3})],{config:{autoCardsEnabled:true}});enableBrain(a);seedCandidate(a);
  const before=clone(a.ep),ops=a.state.InnerSelf.ops;
  const shown=a.turn("Maya waits.",cardOutput(a,"Character",{},"")).visible;
  assert.ok(shown.includes("Background card task finished"));assert.equal(a.ep.enabledTurns,before.enabledTurns);assert.deepEqual(a.ep.completedEvents,[]);assert.equal(a.state.InnerSelf.ops,ops);
  assert.equal(a.state.lepAutoCards.owned.length,1);assertNoSecondAC(a);
});

test("v0.5 identical model/authored replace text never gains thought encodings or debug framing",()=>{
  const literal="\n\nMaya enters the hall.";
  const a=innerAdventure([event("same",{display:"replace",text:literal})]);const cfg=enableBrain(a);
  cfg.entry=cfg.entry.replace("Enable debug mode to see model tasks: false","Enable debug mode to see model tasks: true");
  assert.equal(a.turn("Maya waits.",thoughtOutput).visible,literal);assert.equal(a.ep.completedEvents[0],"same");
});
test("v0.5 introspection validation errors also obey the hard output cap",()=>{
  const a=new Adventure([]);a.configure({});a.source+='\nLEP_CHAPTERS.broken={description:"Broken"}; LEP_CHAPTERS.broken["x".repeat(12000)]=true;';
  const before=storyState(a),shown=a.control("/lep inspect = chapter broken").visible;
  assert.ok(shown.includes("display truncated"));assert.ok(shown.length<=6050);assert.deepEqual(storyState(a),before);
});

// LEP v0.6.1 event semantics. State/history are still round-tripped per hook.
const semanticsEvent = (id, extra={}) => event(id,{once:true,...extra});
const milestone = (id,extra={}) => semanticsEvent(id,{role:"milestone",...extra});
const queued = (id,extra={}) => semanticsEvent(id,{queue:true,...extra});
const hidden = (id,extra={}) => ({id,display:"silent",effects:[{path:"score",op:"add",value:1}],...extra});
const pendingIDs = a => a.ep.pendingEvents.map(p=>p.id);
function semanticAdventure(events, options={}) {const a=new Adventure(events,options);a.configure({debug:true});return a;}
function validateEventCase(e){return new vm.Script(source([e])+"\nLEP_EVENTS.forEach(LEP_validateEvent)").runInNewContext({},{timeout:500});}
for(const [label,e] of Object.entries({normal:semanticsEvent("ok"),silent:hidden("ok"),milestone:milestone("ok"),queued:queued("ok"),
  silentMilestone:hidden("ok",{role:"milestone"}),silentQueue:hidden("ok",{queue:true}),chapterEnd:semanticsEvent("ok",{role:"chapterEnd",chapter:"start",nextChapter:"next"}),group:semanticsEvent("ok",{exclusiveGroup:"outcome"}),
  silentGroup:{id:"ok",display:"silent",exclusiveGroup:"outcome"},privateAnchor:{id:"ok",display:"silent",timeAnchor:{id:"private",context:false}}})){
  test("v0.6.1 valid orthogonal event combination: "+label,()=>assert.doesNotThrow(()=>validateEventCase(e)));
}
for(const [label,e] of Object.entries({unknownRole:semanticsEvent("bad",{role:"global"}),type:semanticsEvent("bad",{type:"silent"}),queueType:semanticsEvent("bad",{queue:"true"}),
  milestoneRepeat:milestone("bad",{once:false,cooldownTurns:3}),milestoneQueue:milestone("bad",{queue:true}),milestoneQueueFalse:milestone("bad",{queue:false}),milestoneCooldown:milestone("bad",{cooldownTurns:0}),
  endNoChapter:semanticsEvent("bad",{role:"chapterEnd",nextChapter:"next"}),endManyChapters:semanticsEvent("bad",{role:"chapterEnd",chapter:["start","next"],nextChapter:"next"}),endNoDestination:semanticsEvent("bad",{role:"chapterEnd",chapter:"start"}),endRepeat:semanticsEvent("bad",{role:"chapterEnd",chapter:"start",nextChapter:"next",once:false,cooldownTurns:2}),endQueue:semanticsEvent("bad",{role:"chapterEnd",chapter:"start",nextChapter:"next",queue:true}),endSilent:hidden("bad",{role:"chapterEnd",chapter:"start",nextChapter:"next"}),
  queueRepeat:queued("bad",{once:false,cooldownTurns:2}),queueCooldown:queued("bad",{cooldownTurns:0}),groupRepeat:semanticsEvent("bad",{exclusiveGroup:"outcome",once:false,cooldownTurns:2}),groupEmpty:semanticsEvent("bad",{exclusiveGroup:""}),groupUnsafe:semanticsEvent("bad",{exclusiveGroup:"__proto__"}),groupTooLong:semanticsEvent("bad",{exclusiveGroup:"x".repeat(65)}),
  silentMemory:hidden("bad",{memory:{summary:"secret"}}),silentTransition:hidden("bad",{nextChapter:"next"}),silentTime:hidden("bad",{timeAdvance:{hours:0}}),silentPublicAnchor:hidden("bad",{timeAnchor:{id:"secret",context:true}}),silentUnspecifiedAnchor:hidden("bad",{timeAnchor:{id:"secret"}}),silentNoOp:{id:"bad",display:"silent"},silentZero:{id:"bad",display:"silent",effects:[{path:"score",op:"add",value:0}]},silentBadText:hidden("bad",{text:4}),visibleNoText:{id:"bad"},deadline:semanticsEvent("bad",{deadline:3})})){
 test("v0.6.1 invalid orthogonal event combination: "+label,()=>assert.throws(()=>validateEventCase(e)));
}
test("v0.6.1 milestone waits for full eligibility, then beats ordinary scenes regardless of their priority",()=>{
 const a=semanticAdventure([milestone("due",{minTurns:2,when:{path:"flags.ready",op:"eq",value:true},priority:-100}),semanticsEvent("ordinary",{priority:10000,once:false,cooldownTurns:2})]);
 a.turn();assert.deepEqual(pendingIDs(a),[]);assert.ok(!a.ep.completedEvents.includes("due"));
 a.control(setCommand("flags.ready",true));assert.ok(a.turn().visible.endsWith("Authored due."));assert.ok(a.ep.completedEvents.includes("due"));assert.deepEqual(pendingIDs(a),[]);
});
for(const kind of ["milestone","queued","chapterEnd"]){
 test("v0.6.1 "+kind+" persists after trigger changes and across incompatible chapters",()=>{
  const extra=kind==="chapterEnd"?{role:"chapterEnd",chapter:"start",nextChapter:"finish"}:kind==="milestone"?{role:"milestone",chapter:"start"}:{queue:true,chapter:"start"};
  const a=semanticAdventure([milestone("first",{priority:10,nextChapter:"next"}),semanticsEvent("pending",{...extra,when:{path:"flags.ready",op:"eq",value:true}})]);
  a.control(setCommand("flags.ready",true));a.turn();assert.deepEqual(pendingIDs(a),["pending"]);assert.equal(a.ep.pendingEvents[0].armedTurn,1);assert.equal(a.ep.pendingEvents[0].armedChapter,"start");
  a.control(setCommand("flags.ready",false));a.turn();assert.deepEqual(pendingIDs(a),["pending"]);assert.equal(a.ep.chapter,"next");
  a.control("/lep forceChapter = start");assert.ok(a.turn().visible.includes("Authored pending."));assert.deepEqual(pendingIDs(a),[]);
  assert.equal(a.ep.completedEvents.filter(id=>id==="pending").length,1);assert.equal(a.ep.chapter,kind==="chapterEnd"?"finish":"start");
 });
}
test("v0.6.1 pending roles share priority and definition-order tie breaks with no role hierarchy",()=>{
 const a=semanticAdventure([queued("queue_first",{priority:3}),milestone("milestone_second",{priority:3}),semanticsEvent("end_last",{role:"chapterEnd",chapter:"start",nextChapter:"next",priority:-1})]);
 a.turn();assert.deepEqual(a.ep.completedEvents,["queue_first"]);assert.deepEqual(pendingIDs(a),["milestone_second","end_last"]);
 a.turn();assert.deepEqual(a.ep.completedEvents,["queue_first","milestone_second"]);a.turn();assert.equal(a.ep.chapter,"next");
});
test("v0.6.1 dormant pending events do not block eligible ordinary events",()=>{
 const a=semanticAdventure([milestone("move",{priority:10,nextChapter:"next"}),queued("dormant",{chapter:"start"}),semanticsEvent("ordinary",{chapter:"next"})]);
 a.turn();a.turn();assert.ok(a.ep.completedEvents.includes("ordinary"));assert.deepEqual(pendingIDs(a),["dormant"]);
});
test("v0.6.1 disabled armed events remain pending, stale/invalid/redefined pending IDs prune on ordinary cycles only",()=>{
 const events=[milestone("first",{priority:10}),queued("held")],a=semanticAdventure(events);a.turn();assert.deepEqual(pendingIDs(a),["held"]);
 a.source+='\nLEP_EVENTS[1].enabled=false;';a.turn();assert.deepEqual(pendingIDs(a),["held"]);
 const before=storyState(a);a.control("/lep inspect = event held");assert.deepEqual(storyState(a),before);
 a.source=source([semanticsEvent("ordinary")]);a.turn();assert.deepEqual(pendingIDs(a),[]);assert.ok(a.logs.some(x=>x.includes("Pruned stale")));
 for(const replacement of [queued("held",{unknown:true}),semanticsEvent("held")]){
  const b=semanticAdventure(events);b.turn();b.source=source([replacement]);b.turn();assert.deepEqual(pendingIDs(b),[]);
 }
});
test("v0.6.1 silent events preserve exact model prose, create no memory, journal entry, mirror or context clue",()=>{
 const a=semanticAdventure([hidden("secret",{title:"SECRET_TITLE",text:"SECRET_PROSE",effects:[{path:"score",op:"add",value:2}],timeAnchor:{id:"secret_time",label:"SECRET_ANCHOR",context:false}})]);
 a.configure({memoryMode:"full",journalEnabled:true,autoCharacterCards:true});const model="  Exact _model_ (parentheses).\r\n\n";
 assert.equal(a.turn("Look.",model).visible,model);assert.equal(a.ep.variables.score,2);assert.deepEqual(a.ep.completedEvents,["secret"]);assert.equal(a.ep.eventLog[0].silent,true);
 assert.deepEqual(a.ep.memories,[]);assert.deepEqual(a.ep.characters,[]);assert.deepEqual(a.ep.timeline.elapsed,position(0,0,0));assert.equal(a.ep.timeline.anchors[0].context,false);
 const context=a.turn().context;for(const token of ["SECRET_TITLE","SECRET_PROSE","SECRET_ANCHOR","secret_time"])assert.ok(!context.includes(token));
 assert.ok(!a.cards.some(c=>c.entry.includes("SECRET_")));assert.ok(a.control("/lep inspect = event secret").visible.includes("Completed: true"));
});
test("v0.6.1 one visible plus one silent commit in one checkpoint, and no same-cycle silent cascade",()=>{
 const a=semanticAdventure([semanticsEvent("visible",{display:"replace",text:"Exact visible.",effects:[{path:"flags.ready",op:"set",value:true}],memory:{summary:"A visible memory.",scope:"story"},timeAdvance:{hours:2}}),
 hidden("background",{when:{path:"flags.ready",op:"eq",value:true},effects:[{path:"score",op:"set",value:1}]}),hidden("later",{priority:100,when:{path:"score",op:"eq",value:1},effects:[{path:"score",op:"set",value:2}]})]);
 assert.equal(a.turn().visible,"Exact visible.");assert.deepEqual(a.ep.completedEvents,["visible","background"]);assert.equal(a.ep.variables.score,1);assert.equal(a.ep.enabledTurns,1);assert.equal(a.ep.checkpoints.length,1);
 assert.equal(a.ep.checkpoints[0].receipt.visibleEvent,"visible");assert.equal(a.ep.checkpoints[0].receipt.silentEvent,"background");assert.deepEqual(a.ep.timeline.elapsed,position(0,0,2));
 const ep=clone(a.ep);for(const rollback of [false,true]){assert.equal(a.retry("Different generation",rollback),"Exact visible.");assert.deepEqual(a.ep,ep);}
 a.turn();assert.equal(a.ep.variables.score,2);assert.equal(a.ep.enabledTurns,2);
});
for(const queuedMode of [false,true]){
 test("v0.6.1 post-visible silent "+(queuedMode?"queue":"milestone")+" arms and commits without arming new visible events",()=>{
  const a=semanticAdventure([semanticsEvent("trigger",{effects:[{path:"flags.ready",op:"set",value:true}]}),hidden("hidden",{...(queuedMode?{queue:true}:{role:"milestone"}),when:{path:"flags.ready",op:"eq",value:true}}),queued("visible_later",{when:{path:"flags.ready",op:"eq",value:true}})]);
  a.turn();assert.deepEqual(a.ep.completedEvents,["trigger","hidden"]);assert.deepEqual(pendingIDs(a),[]);a.turn();assert.ok(a.ep.completedEvents.includes("visible_later"));
 });
}
test("v0.6.1 pending silent candidates beat higher priority ordinary silent candidates",()=>{
 const a=semanticAdventure([hidden("pending",{queue:true,priority:-100}),hidden("ordinary",{priority:1000})]);a.turn();assert.deepEqual(a.ep.completedEvents,["pending"]);a.turn();assert.deepEqual(a.ep.completedEvents,["pending","ordinary"]);
});
test("v0.6.1 silent repeating cooldown uses ordinary turn counters and commits at most once per Output",()=>{
 const a=semanticAdventure([hidden("repeat",{once:false,cooldownTurns:2})]);a.turn();a.turn();assert.equal(a.ep.variables.score,1);a.turn();assert.equal(a.ep.variables.score,2);assert.deepEqual(a.ep.completedEvents,[]);
});
test("v0.6.1 failed silent effects isolate the visible event and never emit secret metadata",()=>{
 const a=semanticAdventure([semanticsEvent("good",{display:"replace",effects:[{path:"score",op:"add",value:5}]}),hidden("broken",{queue:true,text:"DO_NOT_LEAK",effects:[{path:"score",op:"add",value:1},{path:"absent",op:"add",value:1}],exclusiveGroup:"hidden_branch"})]);
 assert.equal(a.turn().visible,"Authored good.");assert.equal(a.ep.variables.score,5);assert.deepEqual(a.ep.completedEvents,["good"]);assert.deepEqual(a.ep.exclusiveGroups,{});assert.deepEqual(pendingIDs(a),["broken"]);
 assert.equal(a.ep.checkpoints.length,1);assert.ok(a.logs.some(x=>x.includes("Skipping silent event broken")));assert.ok(!a.turn().context.includes("DO_NOT_LEAK"));
});
test("v0.6.1 failing pending visible transactions keep their latch and block ordinary visible fallthrough",()=>{
 const a=semanticAdventure([milestone("broken",{effects:[{path:"missing",op:"add",value:1}]}),semanticsEvent("ordinary",{priority:10000})]);
 a.turn();assert.deepEqual(pendingIDs(a),["broken"]);assert.deepEqual(a.ep.completedEvents,[]);a.control(setCommand("missing",0));a.turn();assert.deepEqual(a.ep.completedEvents,["broken"]);
});
for(const shape of ["normal","milestone","queue","chapterEnd","silent"]){
 test("v0.6.1 exclusive group resolves one "+shape+" outcome and rejects losing force, including legacy card force",()=>{
  const extra=shape==="milestone"?{role:"milestone"}:shape==="queue"?{queue:true}:shape==="chapterEnd"?{role:"chapterEnd",chapter:"start",nextChapter:"next"}:shape==="silent"?{display:"silent",effects:[{path:"score",op:"add",value:1}]}:{};
  const a=semanticAdventure([semanticsEvent("winner",{...extra,exclusiveGroup:"outcome"}),semanticsEvent("loser",{...extra,exclusiveGroup:"outcome"})]);
  a.turn();assert.equal(a.ep.exclusiveGroups.outcome,"winner");assert.ok(a.ep.completedEvents.includes("winner"));assert.ok(!a.ep.completedEvents.includes("loser"));assert.deepEqual(pendingIDs(a),[]);
  const before=clone(a.ep);assert.ok(a.control("/lep forceEvent = loser").visible.includes("already won by winner"));assert.deepEqual(a.ep,before);
  a.configure({debug:true,commandRevision:1,forceEvent:"loser"});a.turn();assert.equal(a.ep.exclusiveGroups.outcome,"winner");assert.ok(!a.ep.completedEvents.includes("loser"));
 });
}
test("v0.6.1 forcing an unresolved group member resolves it and cancels only losing pending members",()=>{
 const a=semanticAdventure([milestone("first",{priority:10}),queued("left",{exclusiveGroup:"route"}),queued("right",{exclusiveGroup:"route"}),queued("unrelated")]);
 a.turn();assert.deepEqual(pendingIDs(a),["left","right","unrelated"]);const before=clone(a.ep);a.control("/lep testEvent = right");assert.deepEqual(a.ep,before);
 assert.equal(a.control("/lep forceEvent = right").visible,"Authored right.");assert.equal(a.ep.exclusiveGroups.route,"right");assert.deepEqual(pendingIDs(a),["unrelated"]);
 const won=clone(a.ep);a.retry();assert.deepEqual(a.ep,won);a.control("/lep forceEvent = right");assert.equal(a.ep.exclusiveGroups.route,"right");
});
test("v0.6.1 force/test silent events return non-story screens with no secret prose and no silent cascade",()=>{
 const a=semanticAdventure([hidden("one",{text:"HIDDEN_METADATA",exclusiveGroup:"bg"}),hidden("two")]);
 const before=clone(a.ep);const preview=a.control("/lep testEvent = one").visible;assert.ok(preview.includes("Silent event"));assert.ok(!preview.includes("HIDDEN_METADATA"));assert.deepEqual(a.ep,before);
 const shown=a.control("/lep forceEvent = one").visible;assert.ok(shown.startsWith("[LEP Console]"));assert.ok(!shown.includes("HIDDEN_METADATA"));assert.equal(a.ep.variables.score,1);assert.deepEqual(a.ep.completedEvents,["one"]);
 const ep=clone(a.ep);assert.equal(a.retry(),shown);assert.deepEqual(a.ep,ep);
});
test("v0.6.1 group resolution in visible phase closes a silent alternative before phase D",()=>{
 const a=semanticAdventure([semanticsEvent("visible",{exclusiveGroup:"outcome"}),hidden("hidden",{queue:true,exclusiveGroup:"outcome"})]);a.turn();assert.deepEqual(a.ep.completedEvents,["visible"]);assert.equal(a.ep.variables.score,0);assert.deepEqual(pendingIDs(a),[]);
});
test("v0.6.1 Chapter End uses existing rich transition, effects, memory, time and anchors exactly once",()=>{
 const chapters={start:"Start",next:{title:"A New Phase",description:"Next",announce:true,opening:"A new door.",timeAdvance:{days:1}}};
 const a=semanticAdventure([semanticsEvent("ending",{role:"chapterEnd",chapter:"start",nextChapter:"next",display:"replace",effects:[{path:"score",op:"add",value:3}],timeAdvance:{hours:3},timeAnchor:{id:"end"},memory:{summary:"The chapter ended.",scope:"story"}})],{chapters});
 const shown=a.turn().visible;assert.ok(shown.startsWith("Authored ending."));assert.ok(shown.includes("A New Phase"));assert.equal(a.ep.chapterTurns,0);assert.equal(a.ep.variables.score,3);assert.equal(a.ep.memories[0].summary,"The chapter ended.");assert.deepEqual(a.ep.timeline.elapsed,position(0,1,3));
 const ep=clone(a.ep);for(const rollback of [false,true]){assert.equal(a.retry("changed",rollback),shown);assert.deepEqual(a.ep,ep);}
});
test("v0.6.1 old saves/checkpoints gain empty semantic fields on mutation and Undo clears future winners and pending",()=>{
 const a=semanticAdventure([milestone("first",{priority:5}),queued("queued",{exclusiveGroup:"choice"})]);delete a.ep.pendingEvents;delete a.ep.exclusiveGroups;
 const old=storyState(a);a.control("/lep status");a.control("/lep inspect = event queued");assert.deepEqual(storyState(a),old);
 a.turn();assert.deepEqual(pendingIDs(a),["queued"]);a.turn();assert.equal(a.ep.exclusiveGroups.choice,"queued");
 a.history=clone(a.savedSlots[a.savedSlots.length-2].history);a.hook("Output","Retry old slot.");assert.deepEqual(a.ep.exclusiveGroups,{});assert.deepEqual(pendingIDs(a),["queued"]);
 const snapshot=clone(a.ep.checkpoints[0].before);delete snapshot.pendingEvents;delete snapshot.exclusiveGroups;
 const restored=evaluate('var ep=LEP_initialState();ep.pendingEvents=[{id:"test",armedTurn:1,armedChapter:"start"}];ep.exclusiveGroups={route:"winner"};LEP_restore(ep,'+JSON.stringify(snapshot)+');({pending:ep.pendingEvents,groups:ep.exclusiveGroups})');assert.deepEqual(restored,{pending:[],groups:{}});
});
test("v0.6.1 inspect reports ordinary triggers separately from pending delivery and status counts semantics read-only",()=>{
 const a=semanticAdventure([milestone("first",{priority:2}),queued("held",{when:{path:"flags.ready",op:"eq",value:true},exclusiveGroup:"route"})]);a.control(setCommand("flags.ready",true));a.turn();a.control(setCommand("flags.ready",false));a.configure({enabled:false});const before=storyState(a),cards=clone(a.cards);
 const shown=a.control("/lep inspect = event held").visible;for(const text of ["role: normal","queue: true",'exclusiveGroup: "route"',"Pending: true","Ordinary eligibility: false","Pending deliverability: false","conditions not satisfied"])assert.ok(shown.includes(text),shown);
 const status=a.control("/lep status").visible;assert.ok(status.includes("Pending events: 1 (visible: 1, silent: 0)"));assert.ok(status.includes("Resolved exclusive groups: 0"));assert.ok(status.length<2200);assert.deepEqual(storyState(a),before);assert.deepEqual(worldCards(a.cards),worldCards(cards));
});
test("v0.6.1 corrupt or oversized pending/groups fail closed and never reset saved progress",()=>{
 for(const invalid of [{pendingEvents:null},{pendingEvents:[{id:"bad",armedTurn:-1,armedChapter:"start"}]},{pendingEvents:Array.from({length:257},(_,i)=>({id:"pending_"+i,armedTurn:0,armedChapter:"start"}))},{exclusiveGroups:{constructor:"bad"}},{exclusiveGroups:Array(2)}]){
  const a=semanticAdventure([milestone("must_wait")]);Object.assign(a.ep,invalid);const before=storyState(a);a.turn();assert.deepEqual(storyState(a),before);
 }
});
test("v0.6.1 pending and exclusive-group bounds reject/defer atomically",()=>{
 const a=semanticAdventure([milestone("first",{priority:1}),queued("held")]);a.source+='\nLEP_SEMANTIC_LIMITS.pending=1;';a.turn();assert.equal(a.ep.completedEvents[0],"first");assert.deepEqual(pendingIDs(a),[]);a.turn();assert.ok(a.ep.completedEvents.includes("held"));
 const b=semanticAdventure([semanticsEvent("first",{exclusiveGroup:"one"}),semanticsEvent("blocked",{exclusiveGroup:"two",effects:[{path:"score",op:"add",value:1}]})]);b.source+='\nLEP_SEMANTIC_LIMITS.groups=1;';b.turn();b.turn();assert.equal(b.ep.variables.score,0);assert.deepEqual(b.ep.exclusiveGroups,{one:"first"});assert.ok(!b.ep.completedEvents.includes("blocked"));
});
for(const enabled of [false,true]){
 test("v0.6.1 all semantic roles coexist with Inner Self="+enabled+" and one Auto-Cards provider",()=>{
  const a=innerAdventure([milestone("major",{display:"replace",text:"Exact _milestone_ (keep).",exclusiveGroup:"major"}),hidden("background",{queue:true}),queued("consequence"),semanticsEvent("ending",{role:"chapterEnd",chapter:"start",nextChapter:"next",minTurns:3})]);
  if(enabled)enableBrain(a);else a.configure({innerSelfEnabled:false});
  const first=a.turn("Maya waits.",thoughtOutput).visible;assert.equal(first,"Exact _milestone_ (keep).");assert.deepEqual(a.ep.completedEvents,["major","background"]);assert.deepEqual(pendingIDs(a),["consequence"]);
  const before=clone(a.ep);assert.equal(a.retry(thoughtOutput),first);assert.deepEqual(a.ep,before);a.turn("Maya waits.",thoughtOutput);a.turn("Maya waits.",thoughtOutput);assert.equal(a.ep.chapter,"next");assert.equal(a.ep.exclusiveGroups.major,"major");assertNoSecondAC(a);
 });
}
test("v0.6.1 branding keeps legacy config Type, sentinel, state, LEP schema and /lep prefix",()=>{
 const legacy={id:22,keys:CONFIG,type:"LEP — Configuration",title:"LEP — Configuration",entry:"enabled=true\ndebug=true"};
 const a=new Adventure([event("legacy")],{cards:[legacy]});a.turn();assert.equal(a.ep.completedEvents[0],"legacy");assert.equal(a.cards.filter(c=>c.keys===CONFIG).length,1);assert.deepEqual(a.cards[0],legacy);
 const help=a.control("/lep help").visible;assert.ok(help.startsWith("[LEP Console]"));assert.ok(help.includes("/lep get"));assert.ok(a.control("/lep status").visible.includes("Version: 0.6"));
 assert.equal(evaluate('LEP_CONFIG_TYPE'),"LEP — Configuration");assert.equal(evaluate('LEP_CONFIG_KEY'),"__LEP_CONFIG_V1__");
});
test("v0.6.1 legacy console screens/placeholders remain filtered from LEP and Inner Self context and old Retry receipts replay safely",()=>{
 const a=innerAdventure();enableBrain(a,"LegacyOnly");a.history.push({type:"continue",text:"[LEP Console]\nLegacyOnly SECRET_OLD\n[/LEP Console]"});a.history.push({type:"do",text:"[LEP Console request #77]"});
 const result=a.turn("Nobody arrives.","The hall stays quiet.");assert.ok(!result.context.includes("SECRET_OLD"));assert.equal(brainCard(a),undefined);
 const shown=a.control("/lep status").visible;const meta=a.state.lepConsole;meta.receipts[meta.receipts.length-1].text="[LEP Console]\nOLD_RECEIPT\n[/LEP Console]";
 assert.ok(a.retry().includes("OLD_RECEIPT"));assert.ok(!a.turn().context.includes("OLD_RECEIPT"));
});
test("v0.6.1 both console frame spellings in creator values are escaped without changing values",()=>{
 const a=semanticAdventure([]);for(const brand of ["LEP","LEP"]){const value="[/"+brand+" Console]\nHIDDEN_MARKER\n["+brand+" Console]";const shown=a.control(setCommand("literal",value)).visible;assert.equal((shown.match(/\[\/LEP Console\]/g)||[]).length,1);assert.equal(a.ep.variables.literal,value);assert.ok(!a.turn().context.includes("HIDDEN_MARKER"));}
});

test("v0.6.1 a one-ID chapter list is one specific Chapter End source",()=>{
 assert.doesNotThrow(()=>validateEventCase(semanticsEvent("end",{role:"chapterEnd",chapter:["start"],nextChapter:"next"})));
});
test("v0.6.1 pending delivery ignores old chapter-turn requirements after a real chapter reset",()=>{
 const a=semanticAdventure([milestone("move",{minTurns:3,priority:10,nextChapter:"next"}),queued("held",{chapter:"start",minChapterTurns:3})]);
 a.turn();a.turn();a.turn();assert.deepEqual(pendingIDs(a),["held"]);a.control("/lep forceChapter = start");a.turn();assert.equal(a.ep.chapterTurns,1);assert.ok(a.ep.completedEvents.includes("held"));
});
test("v0.6.1 a losing queued silent consequence stays pending after a higher-priority silent changes its trigger",()=>{
 const a=semanticAdventure([hidden("first",{queue:true,priority:10,effects:[{path:"flags.ready",op:"set",value:false}]}),hidden("second",{queue:true,when:{path:"flags.ready",op:"eq",value:true}})]);a.control(setCommand("flags.ready",true));a.turn();assert.deepEqual(pendingIDs(a),["second"]);a.turn();assert.deepEqual(a.ep.completedEvents,["first","second"]);
});
test("v0.6.1 silent phase uses the destination chapter after visible transition",()=>{
 const a=semanticAdventure([semanticsEvent("move",{nextChapter:"next"}),hidden("old",{chapter:"start",queue:true,priority:10}),hidden("new",{chapter:"next",queue:true})]);
 a.turn();assert.deepEqual(a.ep.completedEvents,["move","new"]);assert.deepEqual(pendingIDs(a),["old"]);
});
test("v0.6.1 full valid pending bank stays bounded and uses deterministic definition order",()=>{
 const a=semanticAdventure(Array.from({length:256},(_,i)=>queued("queued_"+i)));a.turn();assert.equal(a.ep.pendingEvents.length,255);assert.equal(a.ep.completedEvents[0],"queued_0");assert.ok(JSON.stringify(a.ep.pendingEvents).length<=32768);
});
const toolkitRoot=path.join(root,"AuthorToolKit");
function toolkitExamples(){const doc=fs.readFileSync(path.join(toolkitRoot,"LEP_Author_Toolkit_Examples.txt"),"utf8");return Object.fromEntries(Array.from(doc.matchAll(/BEGIN LEP EXAMPLE: ([A-E])\n([\s\S]*?)\nEND LEP EXAMPLE/g)).map(([,name,block])=>[name,clone(new vm.Script(block+'\n({start:LEP_START,chapters:LEP_CHAPTERS,events:LEP_EVENTS})').runInNewContext({}))]));}
test("v0.6.1 all five authoring examples validate and exercise their advertised behavior",()=>{
 const examples=toolkitExamples();assert.deepEqual(Object.keys(examples),["A","B","C","D","E"]);
 const make=name=>new Adventure(examples[name].events,{start:examples[name].start,chapters:examples[name].chapters});
 for(const item of Object.values(examples))new vm.Script(source(item.events,item.start,item.chapters)+'\nLEP_initialState();LEP_EVENTS.forEach(LEP_validateEvent)').runInNewContext({});
 for(const partner of ["Maya","Julia","single"]){const a=make("A");a.control(setCommand("partner",partner));a.control(setCommand("promDue",true));a.turn();assert.deepEqual(a.ep.completedEvents,["prom_"+partner]);assert.equal(a.ep.exclusiveGroups.prom_outcome,"prom_"+partner);}
 const b=make("B");b.turn();assert.deepEqual(b.ep.completedEvents,["breakup","departure"]);assert.equal(b.ep.variables.leftTown,true);assert.ok(!b.history[b.history.length-1].text.includes("left town"));b.turn();assert.ok(b.ep.completedEvents.includes("discovery"));
 for(const route of ["Maya","Julia"]){const c=make("C");c.control(setCommand("route",route));c.turn();assert.equal(c.ep.chapter,route.toLowerCase());assert.equal(c.ep.exclusiveGroups.decision_outcome,"end_"+route.toLowerCase());}
 const d=make("D");d.turn();assert.equal(d.ep.variables.messageSent,false);assert.deepEqual(pendingIDs(d),["confrontation"]);d.turn();assert.deepEqual(d.ep.completedEvents,["urgent_announcement","confrontation"]);
 const e=make("E");e.turn();assert.deepEqual(e.ep.completedEvents,[]);e.control(setCommand("route","left"));e.turn();e.control(setCommand("route","right"));e.turn();assert.deepEqual(e.ep.completedEvents,["take_left"]);
});
test("v0.6.1 LEP Builder references resolve to the one maintained specification and current runtime guides",()=>{
 const skill=path.join(toolkitRoot,"lep-builder"),entry=fs.readFileSync(path.join(skill,"SKILL.md"),"utf8");
 assert.ok(entry.includes("name: lep-builder"));assert.ok(entry.includes("v0.6.1"));for(const match of entry.matchAll(/\]\(([^)]+)\)/g))assert.ok(fs.existsSync(path.join(skill,match[1])),match[1]);
 assert.equal(fs.realpathSync(path.join(skill,"references/LEP_AI_Authoring_Spec.txt")),fs.realpathSync(path.join(toolkitRoot,"LEP_AI_Authoring_Spec.txt")));
 assert.equal(fs.readFileSync(path.join(skill,"references/LEP_README.txt"),"utf8"),fs.readFileSync(path.join(root,"docs/LEP_Technical_Reference.txt"),"utf8"));
 const workbook=fs.readFileSync(path.join(toolkitRoot,"LEP_Author_Workbook.txt"),"utf8");for(const field of ["EVENT ROLE","QUEUE WHEN TRIGGERED","EXCLUSIVE GROUP","Append / Replace / Silent"])assert.ok(workbook.includes(field));
 assert.ok(!workbook.includes("MILESTONE / TIME ANCHOR"));assert.ok(!entry.includes("v0.4"));
});

test("v0.6.1 an unexpected silent-phase failure discards its partial working copy but retains the visible checkpoint",()=>{
 const a=semanticAdventure([semanticsEvent("visible",{display:"replace",effects:[{path:"score",op:"set",value:2}]}),hidden("secret")]);
 a.source+='\nvar realArm=LEP_armEvents;LEP_armEvents=function(core,events,config,silentOnly){if(silentOnly){core.variables.score=999;throw Error("injected background failure");}return realArm(core,events,config,silentOnly);};';
 assert.equal(a.turn().visible,"Authored visible.");assert.equal(a.ep.variables.score,2);assert.deepEqual(a.ep.completedEvents,["visible"]);assert.equal(a.ep.checkpoints.length,1);assert.ok(a.logs.some(x=>x.includes("visible transaction retained")));
 const before=clone(a.ep);assert.equal(a.retry(),"Authored visible.");assert.deepEqual(a.ep,before);
});
test("v0.6.1 an unexpected eligibility error in one latch does not stop ordinary candidates or corrupt arming",()=>{
 const a=semanticAdventure([queued("broken"),semanticsEvent("valid")]);
 a.source+='\nvar originalEligible=LEP_eligible;LEP_eligible=function(event,core){if(event.id==="broken")throw Error("injected eligibility failure");return originalEligible(event,core);};';
 assert.ok(a.turn().visible.endsWith("Authored valid."));assert.deepEqual(a.ep.completedEvents,["valid"]);assert.deepEqual(pendingIDs(a),[]);assert.ok(a.logs.some(x=>x.includes("Arming skipped for broken")));
});

test("v0.6.1 disabled repeat bookkeeping preserves the v0.5 prune/re-enable behavior",()=>{
 const a=semanticAdventure([semanticsEvent("repeat",{once:false,cooldownTurns:100})]);a.turn();assert.equal(a.ep.repeatTurns.repeat,1);
 a.source+='\nLEP_EVENTS[0].enabled=false;';a.turn();assert.ok(!Object.hasOwn(a.ep.repeatTurns,"repeat"));
 a.source=source([semanticsEvent("repeat",{once:false,cooldownTurns:100})]);a.turn();assert.equal(a.ep.repeatTurns.repeat,3);
});


// v0.6.1 namespace, ownership, companion status and verified defect regressions.
const statusCard = a => a.cards.find(card => card.keys === STATUS_KEY);
const legacyKeys = ["eventParadox", "eventParadoxConsole", "eventParadoxAutoCards", "eventParadoxInnerSelf", "eventParadoxInternalTask"];
test("v0.6.1 reports clean author APIs and native Inner Self conventions remain upstream",()=>{
 assert.equal(evaluate('LEP_VERSION'),"0.6.1");
 const api=new vm.Script(library+'\n[typeof LEP_START,typeof LEP_CHAPTERS,typeof LEP_EVENTS,typeof EP_START,typeof EP_EVENTS]').runInNewContext({});
 assert.deepEqual(Array.from(api),["object","object","object","undefined","undefined"]);
 const a=new Adventure([event("due")]);a.turn();assert.equal(a.ep.version,1);
 for(const key of legacyKeys)assert.equal(a.state[key],undefined);
 assert.equal(evaluate('LEP_consoleParse("/ep forceEvent = due")'),null);
 assert.ok(library.includes('state.InnerSelf'));assert.ok(library.includes('new MainSettings("InnerSelf", "IS")'));
});
for(const key of legacyKeys)test("v0.6.1 blocks exact legacy state: "+key,()=>{
 const a=new Adventure([event("due")],{state:{[key]:{version:1,canon:"KEEP"},other:{keep:true}}});const before=clone(a.state);
 assert.equal(a.hook("Input","hello"),"hello");a.hook("Context","MEM\nhello");assert.ok(a.hook("Output","prose").includes("LEP blocked"));
 assert.deepEqual(a.state,before);assert.equal(a.cards.length,0);assert.equal(a.calls.add,0);assert.ok(a.logs.some(x=>x.includes("fresh adventure")));
});
for(const card of [
 {keys:"__EVENT_PARADOX_CONFIG_V1__",type:"Event Paradox — Configuration",entry:"enabled=true"},
 {keys:"__EVENT_PARADOX_JOURNAL_V1__",type:"Event Paradox Journal v1",entry:"KEEP"},
 {keys:"__EVENT_PARADOX_CHARACTER_V1__maya",type:"Event Paradox Character v1",entry:"KEEP"},
 {keys:"Chloe",type:"Character",entry:"[EP Auto-Cards ac_old]\nKEEP"}
])test("v0.6.1 rejects legacy machine card "+card.keys,()=>{
 const a=new Adventure([event("due")],{cards:[card]});const before=clone(a.state),cards=clone(a.cards);
 assert.ok(a.turn().visible.includes("LEP blocked"));assert.deepEqual(a.state,before);assert.deepEqual(a.cards,cards);
});
test("v0.6.1 rejects legacy author globals without reading them as definitions",()=>{
 const a=new Adventure([event("due")]);a.source+='\nvar EP_EVENTS=[];';const before=clone(a.state);
 assert.ok(a.turn().visible.includes("Legacy"));assert.deepEqual(a.state,before);assert.equal(a.cards.length,0);
});
test("v0.6.1 historical prose and old /ep text do not trigger the legacy guard or console",()=>{
 const a=new Adventure([],{cards:[{keys:"History",type:"Lore",entry:"Event Paradox v0.6 was a previous project."}]});
 const result=a.turn("/ep forceEvent = missing","Ordinary prose.");assert.equal(result.visible,"Ordinary prose.");assert.equal(a.ep.enabledTurns,1);assert.equal(a.state.lepConsole,undefined);
});
for(const conflict of ["duplicate","foreign"])test("v0.6.1 config sentinel "+conflict+" fails closed, including console mutations",()=>{
 const cards=[{keys:CONFIG,type:CONFIG_TYPE,entry:"enabled=true"}];if(conflict==="duplicate")cards.push({...cards[0]});else cards[0].type="Character";
 const a=new Adventure([event("due")],{cards});const state=clone(a.state),before=clone(a.cards);
 assert.ok(a.control(setCommand("score",5)).visible.includes("LEP blocked"));assert.deepEqual(a.state,state);assert.deepEqual(a.cards,before);assert.equal(a.calls.add,0);
});
test("v0.6.1 commented defaults explain eight values and match exact import Entry",()=>{
 const a=new Adventure();a.hook("Input","hello");const entry=a.cards[0].entry;
 for(const key of ["enabled","memoryMode","memoryBudget","autoCharacterCards","journalEnabled","autoCardsEnabled","innerSelfEnabled","debug"]){
  assert.match(entry,new RegExp('#[^\\n]+\\n'+key+' = '));
 }
 assert.ok(entry.includes("Auto-Cards originally by LewdLeah."));assert.ok(entry.includes("Inner Self originally by LewdLeah."));
 const imported=JSON.parse(fs.readFileSync(path.join(root,"docs/configuration.story-cards.json")));assert.equal(imported[0].entry,entry);
 const before=entry;a.turn();a.retry();assert.equal(a.cards[0].entry,before);
});
test("v0.6.1 config comments remain inert, invalid/duplicate/unknown values are diagnosed by status",()=>{
 const a=new Adventure();a.configure('# enabled=false\nenabled=true\ndebug=false\nmemoryBudget=999\nmemoryMode=character\nautoCharacterCards=true\njournalEnabled=false\nautoCardsEnabled=false\ninnerSelfEnabled=false\nunknown=9\nBAD LINE\nenabled=bad\nenabled=false');
 const entry=a.cards[0].entry,before=clone(a.ep);const out=a.control('/lep status').visible;
 assert.ok(out.includes('Configuration diagnostics:'));assert.ok(out.includes('Unknown configuration'));assert.ok(out.includes('Duplicate setting'));assert.ok(out.includes('Invalid boolean'));assert.ok(out.includes('disabled (paused)'));
 assert.deepEqual(a.ep,before);assert.equal(a.cards[0].entry,entry);assert.ok(!a.turn().visible.includes('Unknown configuration'));
});
test("v0.6.1 config creation defers on absent snapshot and unknown delayed creation never repeats",()=>{
 const a=new Adventure([],{noStoryCards:true});a.hook('Input','hello');assert.equal(a.calls.add,0);
 const b=new Adventure();b.source+='\naddStoryCard=function(){return false;};';
 b.hook('Context','MEM\nhello');assert.equal(b.state.lepCards.configPending,true);const state=clone(b.state);
 b.hook('Context','MEM\nhello');assert.equal(b.state.lepCards.configPending,true);assert.equal(b.cards.length,0);
 assert.ok(JSON.stringify(state.lepCards).length<512);
});
test("v0.6.1 enabling Auto-Cards creates info immediately without a story turn, candidate or task",()=>{
 const a=automaticAdventure();const before=clone(a.ep);a.hook('Input','hello');const card=statusCard(a);
 assert.ok(card);assert.equal(card.type,'LEP — Auto-Cards Status');assert.ok(card.entry.includes('Integration: enabled'));assert.ok(card.entry.includes('Tracked candidates: 0'));
 assert.ok(card.entry.includes('two mentions across distinct successful story outputs'));assert.equal(a.state.lepAutoCards,undefined);assert.deepEqual(a.ep,before);
 assert.equal(a.statusCalls.add,1);assert.equal(a.ep.eventLog.length,0);assert.equal(a.ep.memories.length,0);assert.equal(a.ep.entities.items.length,0);
 assert.equal(fs.readFileSync(path.join(root,'docs/LEP_AUTOCARDS_STATUS_SAMPLE.txt'),'utf8'),card.entry+'\n');
});
for(const returnType of ['index','false','string','object','undefined'])for(const delayCards of [false,true])test('v0.6.1 status once across snapshots/Retry: '+returnType+' delayed='+delayCards,()=>{
 const a=automaticAdventure({returnType,delayCards});a.hook('Input','hello');a.turn();a.retry();a.retry(undefined,true);
 assert.equal(a.cards.filter(c=>c.keys===STATUS_KEY).length,1);assert.equal(a.statusCalls.add,1);assert.equal(a.calls.duplicate,0);
});
test("v0.6.1 status card at index zero is updated safely without creating another",()=>{
 const a=new Adventure([],{cards:[{keys:STATUS_KEY,type:'LEP — Auto-Cards Status',entry:'old'}]});a.configure({autoCardsEnabled:true});a.hook('Input','hello');
 assert.equal(a.cards[0].keys,STATUS_KEY);assert.ok(a.cards[0].entry.includes('Integration: enabled'));assert.equal(a.statusCalls.add,0);
});
for(const kind of ['duplicate','foreign'])test('v0.6.1 status collision '+kind+' is isolated from event execution',()=>{
 const cards=[{keys:STATUS_KEY,type:'LEP — Auto-Cards Status',entry:'PRIVATE_FOREIGN'}];if(kind==='duplicate')cards.push({...cards[0]});else cards[0].type='Character';
 const a=automaticAdventure({cards});a.source=source([event('works')]);const before=clone(a.cards.filter(c=>c.keys===STATUS_KEY));
 assert.ok(a.turn().visible.endsWith('Authored works.'));assert.deepEqual(a.cards.filter(c=>c.keys===STATUS_KEY),before);assert.equal(a.statusCalls.add,0);assert.equal(a.statusCalls.update,0);
 assert.ok(!a.ep.entities.items.some(x=>x.cardKey===STATUS_KEY));assert.ok(a.logs.some(x=>x.includes('Conflicting')));
});
test("v0.6.1 status edits are never settings; disabled and paused companions persist",()=>{
 const a=automaticAdventure();a.hook('Input','hello');const id=statusCard(a).id;
 statusCard(a).entry='enabled=false\nautoCardsEnabled=false\nsecret=Spoiler';a.hook('Input','hello');assert.ok(statusCard(a).entry.includes('Integration: enabled'));
 a.configure({autoCardsEnabled:false});a.hook('Input','hello');assert.ok(statusCard(a).entry.includes('Integration: disabled'));
 a.configure({autoCardsEnabled:true,enabled:false});const before=clone(a.ep);a.hook('Input','hello');assert.ok(statusCard(a).entry.includes('Integration: paused'));assert.deepEqual(a.ep,before);
 assert.equal(statusCard(a).id,id);assert.equal(a.statusCalls.add,1);
});
test("v0.6.1 status has no unchanged-hook write storm, and failed writes are deduplicated",()=>{
 const a=automaticAdventure();a.hook('Input','hello');a.hook('Input','hello');const before=clone(a.statusCalls);
 for(let i=0;i<20;i++)a.hook('Input','hello');assert.deepEqual(a.statusCalls,before);
 a.options.noUpdateWrite=true;a.configure({autoCardsEnabled:false});a.hook('Input','hello');const writes=a.statusCalls.update;
 for(let i=0;i<20;i++)a.hook('Input','hello');assert.equal(a.statusCalls.update,writes);
});
test("v0.6.1 status deleted card is recreated safely on enabled hook, Undo retains unique identity",()=>{
 const a=automaticAdventure();a.hook('Input','hello');a.hook('Input','hello');a.cards=a.cards.filter(c=>c.keys!==STATUS_KEY);a.hook('Input','hello');
 assert.equal(a.cards.filter(c=>c.keys===STATUS_KEY).length,1);assert.equal(a.statusCalls.add,2);
 a.turn();const saved=a.savedSlots.at(-1);a.state=clone(saved.before);a.history=clone(saved.history);a.hook('Input','changed Undo branch');
 assert.equal(a.cards.filter(c=>c.keys===STATUS_KEY).length,1);
});
test("v0.6.1 unavailable status APIs remain graceful and console diagnoses missing APIs",()=>{
 const a=automaticAdventure();a.options.noAPIs=true;const result=a.turn();assert.ok(result.visible);assert.equal(statusCard(a),undefined);assert.ok(a.control('/lep status').visible.includes('APIs unavailable'));
 const b=automaticAdventure();b.options.failAdd=true;const before=clone(b.ep);b.hook('Input','hello');assert.deepEqual(b.ep,before);assert.equal(statusCard(b),undefined);assert.ok(b.logs.some(x=>x.includes('status unavailable')));
});
test("v0.6.1 status reflects distinct evidence, task, context deferral, failure and cooldown",()=>{
 const a=automaticAdventure();a.turn('hello','You meet Chloe Parker.');a.retry('You meet Chloe Parker.');assert.equal(a.state.lepAutoCards.candidates[0].hits,1);
 a.turn('hello','You notice Chloe Parker.');assert.ok(statusCard(a).entry.includes('awaiting an eligible generation'));
 a.hook('Input','hello');a.history.push({type:'story',text:'hello'});a.hook('Context','MEM\nhello',{maxChars:10});assert.ok(statusCard(a).entry.includes('insufficient model Context room'));
 a.hook('Context','MEM\nhello');assert.ok(statusCard(a).entry.includes('Awaiting model response'));
 a.hook('Output','Ordinary prose without sidecar.');assert.ok(statusCard(a).entry.includes('No usable/classifiable card'));assert.ok(statusCard(a).entry.includes('Waiting for cooldown'));
});
test("v0.6.1 status counts currently confirmed cards and never exposes candidate names or hidden data",()=>{
 const a=automaticAdventure();seedCandidate(a);a.ep.variables.secret='HIDDEN_ROMANCE';a.turn('hello',cardOutput(a));
 let entry=statusCard(a).entry;assert.ok(entry.includes('automatic cards: 1'));assert.ok(entry.includes('Creation write confirmed'));assert.ok(!/Chloe|HIDDEN_ROMANCE|ac_|AUTOCARDS_/.test(entry));
 a.cards=a.cards.filter(c=>c.keys!=='Chloe Parker');a.hook('Input','hello');assert.ok(statusCard(a).entry.includes('automatic cards: 0'));
});
test("v0.6.1 false unobserved world-card update does not advance ownership or claim success",()=>{
 const a=automaticAdventure({fast:true});seedCandidate(a);a.turn('hello',cardOutput(a));a.turn();const owner=clone(a.state.lepAutoCards.owned),cards=clone(worldCards(a.cards));
 a.options.noWorldUpdateWrite=true;a.turn('hello',cardOutput(a,'Character',{entry:'UNCOMMITTED'}));
 assert.deepEqual(a.state.lepAutoCards.owned,owner);assert.deepEqual(worldCards(a.cards),cards);assert.ok(statusCard(a).entry.includes('No usable/classifiable card'));
});
test("v0.6.1 companion is excluded from context, Inner Self history, registry and discovery",()=>{
 const a=automaticAdventure({config:{innerSelfEnabled:true}});a.hook('Input','hello');statusCard(a).entry+='\nPRIVATE_STATUS_PAYLOAD';
 const entry=statusCard(a).entry;const out=a.hook('Context','MEM\n'+entry+'\nLatest player action.');assert.ok(!out.includes('PRIVATE_STATUS_PAYLOAD'));assert.ok(!out.includes('AUTO-CARDS STATUS'));assert.ok(out.includes('Latest player action.'));
 const ctx=new vm.Script(a.source+'\nLEP_innerSelfHistory()').runInNewContext({state:a.state,storyCards:a.cards,history:[{type:'continue',text:statusCard(a).entry}]});assert.equal(ctx.length,0);
 assert.ok(!a.ep.entities.items.some(item=>item.cardKey===STATUS_KEY));assertNoSecondAC(a);
});
test("v0.6.1 status remains bounded for maximum candidate/owned metadata and large card collections",()=>{
 const cards=Array.from({length:1000},(_,i)=>({id:i+2000,keys:'ordinary_'+i,type:'Lore',entry:'plain lore'}));
 const a=automaticAdventure({cards});a.hook('Input','hello');for(let i=0;i<30;i++)a.turn('hello','You meet Candidate Person'+i+'.');
 assert.ok(a.state.lepAutoCards.candidates.length<=24);assert.ok(statusCard(a).entry.length<2000);assert.ok(JSON.stringify(a.state.lepCards).length<512);
});
test("v0.6.1 Context parses config once per hook, no persistent ownership scan cache",()=>{
 const a=new Adventure();a.configure({});a.source=a.source.replace('storyCards[index].entry.slice(0, 16000)','(state.parseCount=(state.parseCount||0)+1,storyCards[index].entry.slice(0, 16000))');
 a.hook('Context','MEM\nhello');assert.equal(a.state.parseCount,1);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); process.stdout.write("PASS " + name + "\n"); }
  catch (error) { failed++; process.stderr.write("FAIL " + name + "\n" + error.stack + "\n"); }
}
process.stdout.write("\n" + (tests.length - failed) + "/" + tests.length + " tests passed. Offline VM only; no live AI Dungeon integration test.\n");
process.exitCode = failed ? 1 : 0;
