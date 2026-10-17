---
name: mlbb-panxcz
description: Build, extend, port, and debug Mobile Legends (MLBB) external overlay tools in C++/NDK — the "mlbb-panxcz" class of project. Use this skill whenever the user mentions MLBB, Mobile Legends, com.mobile.legends, com.mobile.legends.usa, libcsharp.so, liblogic.so, global-metadata.dat, il2cpp, ShowEntity, BattleManager, ShowPlayer, m_Hp, m_iType, m_vCachePosition, auto retri / retribution, auto aim, auto combo, ESP, hero icons, minimap dots, drag-to-blast skills, uinput or synthetic touch injection, healing or re-syncing memory offsets after a game update, GLOBAL vs US edition offset shifts, building an arm64 ELF with the NDK, or deploying to a rooted phone with adb. Trigger this even when the user just says "the overlay", "the tool", "the cheat", "auto aim doesn't work", or "the offsets are wrong" in an MLBB context — do not wait for them to say "skill".
---

# MLBB External Overlay (mlbb-panxcz playbook)

Playbook for the class of tool that lives **outside** the game: a standalone
arm64 Android ELF that reads another app's memory over `/proc/<pid>/mem`, draws
an ImGui overlay on its own native surface, and injects touches through
grabbed uinput devices. No injection, no game-side code.

This is the workflow that produced a working tool, including every bug that
cost the most time. The bugs are the point — the layout facts below are the
reason this skill exists.

## Non-negotiables

1. **Never hardcode a field offset in feature code.** Every game field goes in
   one offset table, and that table is *healed at runtime* from the live il2cpp
   metadata. Feature code reads `OFF_...` names only.
2. **A gate that can reject everything must never be reached from a code path
   that does nothing else.** Silent permanent failure reads as "the feature is
   broken" and costs hours. Every gate needs a visible status string.
3. **Log status on *change*, not per frame, plus a heartbeat.** `logcat` is the
   only debugging channel you have over adb. A feature that prints nothing is
   indistinguishable from a feature that is gated off.
4. **Prove it with data, not with reasoning.** When a scan yields zero
   candidates, print the *raw entries* (type/id/hp/camp) and the count per
   rejection reason. Every layout bug below was found that way in minutes,
   after guessing had failed for an hour.

## Workflow

### 1. Scope and confirm the target

- Which package/edition is running: `com.mobile.legends` (GLOBAL) vs
  `com.mobile.legends.usa` (US)? Both can be installed side by side, in
  multiple Android profiles. Detect, never assume; let the user pick if
  ambiguous. The wrong process means *every* offset reads garbage while ESP
  still "works", which is the single most confusing failure mode.
- Which process holds the engine? Not the main app process — the game engine
  lives in the `:UnityKillsMe` child. Find the process whose maps actually
  contain `libcsharp.so`.
- Whether memory reads go through a kernel module, `/proc/<pid>/mem` via root,
  or a syscall shim. The whole tool must work with the weakest backend, and
  must degrade visibly rather than silently.

### 2. Build the offset table and the heal mechanism

Read `references/offsets-and-heal.md` before writing any feature code. It
covers class slots, static-field blobs, `FieldInfo` walking, the trusted-flag
pattern, and the metadata probe CLI.

Key facts that break naive tooling:
- Field offsets shift between builds (US build: ShowEntity fields move −0x8).
- Auto-properties are stored as `<m_EnergyPoint>k__BackingField`, *not*
  `m_EnergyPoint`. Guessing the pretty name silently fails the heal.
- Class *slot RVAs* also shift, and some classes have no slot at all — derive
  them by scanning or from the dump table.
- Some classes are only reachable through a live object (`Il2CppClass*` at
  `obj + 0x0`), not through a slot cell.

### 3. Wire touch injection

Read `references/touch-injection.md`. The parts that matter:
- Tap vs hold semantics. A long press-and-drag is a *hold* only if the finger
  stays down. Release/re-press cycles read as **taps**, which breaks every
  "aim by holding" feature. See the tap-vs-hold metric below.
- Multi-touch slots are finite. Long synthetic presses collide with the user's
  own fingers.
- Any synthetic gesture must be released on every exit path, including the
  ones you thought were unreachable.

### 4. Own the joystick, explicitly

If any feature steers the character, the joystick is a **shared, single-contact
resource**. Give it an owner enum and owner-scoped stop calls. Otherwise a
second feature that runs every frame will stop the joystick whenever *it* is
idle, and the first feature degrades into a stutter that nobody can explain.

Instrument `sessions` (completed joystick holds). Steady = one session while a
target exists. Rising fast = taps, not steering. This single counter found both
of our tap bugs.

### 5. Implement features

Per feature, in order: gate conditions → data collection → selection → gesture →
status string → heartbeat fields. Never skip the last two.

Known layout facts that silently break targeting (all measured, not guessed):
- **Enemy bots live in `m_ShowMonsters`, not `m_ShowPlayers`**, with
  `m_iType == 4` and hero *instance* ids (1008–1016). A filter that accepts
  only types 1/2/5 discards 100% of bots and leaves only jungle monsters.
  This same broken filter exists in most public MLBB menus.
- **World-space projection of points behind the camera does not fail** — it
  returns coordinates tens of thousands of pixels away. Validate that
  projections land inside the screen rect before trusting them.
- Entities outside the screen are still valid *targets*. Discarding them makes
  the candidate list oscillate every frame (present → gone → present), which
  reads to the user as "it only works once". Demote them in priority instead.

### 6. Build, verify, deploy

Read `references/build-and-deploy.md` for the NDK build, the 16 KB LOAD
alignment gate, the integrity guard, adb deployment, and the self-test harness.

### 7. Debug over logcat

Read `references/diagnosis.md` for the tag layout, the status-on-change +
heartbeat pattern, and the checklist for "the feature doesn't work".

## Quality bar

- Every feature: visible status string that names the *reason* it is idle
  (distance, FOV, calibration, phase, touch readiness) — never a bare
  "no target".
- Every gate: a testable pure function plus a self-test case.
- Self-tests run on device with no game running (`SELFTEST=1 ./binary`), so a
  change is verifiable without a match.
- Anything a player can misread as "broken" gets a slider or a status line.

## Files

- `references/offsets-and-heal.md` — il2cpp layout, offset table, runtime heal
- `references/touch-injection.md` — uinput, tap vs hold, joystick ownership
- `references/build-and-deploy.md` — NDK build, gates, adb, self-tests
- `references/diagnosis.md` — logcat tags, status patterns, triage checklist
- `references/ui-and-config.md` — ImGui theming without losing smoothness
- `eval/eval_set.json` — trigger-evals (should / should-not trigger)