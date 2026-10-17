# Touch injection: tap vs hold

Synthetic touches are the only safe way to drive a game that must not be
modified in memory. Everything below was learned from features that looked
correct in code and played wrong on device.

## Grab, don't create

Create a virtual device and you compete with the real touch stack — the game
ignores you or the kernel routes around you. Instead **grab the game's real
touch devices** (`EVIOCGRAB` on `/dev/input/event*` that expose ABS_MT), read
from them so the user can still play, and mirror your synthetic contacts into
the same MT slot slots.

Self-heal: if writes start failing hard, reopen the devices. Devices die
between matches and the feature then goes silently dead mid-game.

## Tap vs hold — the distinction the game actually sees

| Gesture | Implementation | Game reads as |
|---|---|---|
| Tap | down, short hold, up | discrete press |
| Hold | down, **no up**, move, up | continuous input (joystick / drag aim) |
| Bursts | repeated down/up | **many taps**, never a hold |

Features that "aim by holding" break in the third row. Two bugs we hit, both
invisible in code review:

1. **A duration cap hidden inside a helper.** The caller asked for "hold
   indefinitely"; the helper normalized `0` into `1200`, silently turning a
   hold into a 1.2-second burst. Respect the sentinel; do not coerce it.
2. **Another feature stopping the shared contact.** A routine that runs every
   frame released the joystick on its own idle branches — 2–3 times a second.
   The first feature then re-pressed, and the game saw taps.

Fix for (2): one owner per shared contact.

```cpp
enum { JOY_NONE = 0, JOY_FARM = 1, JOY_KIMMY = 2 };
static int g_joyOwner = JOY_NONE;

void StopOwned(int owner, int pauseMs) {
    if (g_joyOwner != JOY_NONE && g_joyOwner != owner) return;  // not mine
    Stop(pauseMs);
    g_joyOwner = JOY_NONE;
}
```

A safety net belongs on the worker itself: if no update arrives for ~1.5 s,
release. Otherwise a crashed or deadlocked caller leaves a finger on the
player's screen with no way to clear it.

## Grace period: don't flinch

A feature that reacquires its target every frame will drop and re-press
whenever a single scan tick misses — target behind a wall, dead for one
frame, or momentarily off screen. That reads as "works once".

Hold the last direction briefly after losing the target (a few hundred ms),
exactly like a player who keeps walking for a moment before looking around.
Expose it as a slider; 0 restores the twitchy behaviour.

## Off-screen targets are valid targets

Discarding candidates that fall outside the screen rect makes the candidate
list oscillate every frame. Demote them in priority instead, and compute the
gesture direction from world space, not pixels. Validate projections before
use: a point behind the camera does not fail to project, it returns garbage
coordinates (tens of thousands of pixels off).

## Multi-contact budget

Synthetic contacts occupy MT slots. Long holds held while the user drags the
real joystick will collide. Gate long holds on "is a real finger down?" and
skip if the device has no free slot — and say so in the status line rather
than retrying silently.

## Feature gating rules

- Features that only inject touches must **not** be gated behind the
  "no memory write" safety switch. That switch means what it says, and
  conflating it with "feature may not run" produces a feature that is dead by
  default with its toggle on a settings page nobody opens.
- Gate on *in-match* (draft/ban screens must never be touched) and on touch
  readiness — not on hero identity, unless the mechanic truly differs per hero.
- A per-hero requirement should be defeatable for testing, and the status line
  must state the hero id it saw when it refuses.

## Status lines matter

```
"no enemy visible (players 0/0, monsters 0/0)"
"closest 11.4 unit > attack range 5.5 (turn off 'in attack range')"
"waiting for own throw"
"touch not ready"
```

The user reads the overlay, not your source. Every idle state must say which
condition blocked it.