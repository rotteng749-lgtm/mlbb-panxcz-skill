# Diagnosis over adb

You cannot see the screen from the host. `logcat` is the only window, so build
the instrumentation first and the fix second.

## Tag layout

| Tag | Content |
|---|---|
| `<Tool>Boot` | startup, attach state, build gates |
| `<Tool>Heal` | which offsets resolved, shifted, or were rejected |
| `<Tool>Room` | periodic entity/player snapshots |
| `<Tool>Feature` | per-feature: status changes + heartbeat |

## Status-on-change + heartbeat

Two different jobs, both required:

```cpp
static void SetStatus(const char* s) {
    if (strcmp(g_status, s) != 0) {           // only on CHANGE
        __android_log_print(..., "kimmy: %s (hero=%d targets=%d)", s, heroId, n);
    }
    snprintf(g_status, sizeof(g_status), "%s", s);
}
```

Heartbeat every ~3 s with the gate inputs, because a status string alone cannot
distinguish "gated off" from "tick never runs":

```text
hb: hero=71 touch=1 phase=1 joy=1788,527 healE=1 tgt=13 near=11.9unit/925px
    maxD=20.0 fov=0 inR=0 atkR=5.5 joy=1 sess=2 st='aiming at monster 2005'
```

Put the *raw* numbers in there, not just the conclusion. Every hour saved in
this project came from a heartbeat that printed inputs.

## Count rejection reasons

The single highest-value line in the whole tool:

```cpp
scan=P1(c1,d0,h0,o0->ok0) M70(ok0) t[0/13/0/57] hid=1 z=1
```

`P` = players, `M` = monsters, letters = rejected-for-same-camp / dead /
hp / off-screen / ok, `t[]` = count per entity type. With that one line you know
whether the list is empty, whether everything is being filtered, or whether the
read itself is broken — without guessing.

When the counts still don't explain it, print **raw entries**:

```text
0/113/113/0/1/0 ; 4/1010/7900/2/0/0 ; 4/1016/7300/2/0/0
     type/id/hp/camp/ally/dead
```

This exact dump is what revealed that enemy bots live in the *monster* list
with `type == 4`. No amount of reasoning about "where are the bots" would have
produced that number.

## Triage: "the feature doesn't work"

Check in this order; each step has killed at least one bug:

1. **Is the tick running at all?** Heartbeat present? Missing heartbeat =
   the call site is unreachable or gated above it.
2. **Which gate is closed?** Heartbeat prints gate values; compare against
   config. Default-safe flags that are *on* kill features silently.
3. **Is the data being read?** Raw-entry dump non-empty? Counts non-zero?
4. **Is the selection rejecting everything?** The "N candidates, closest X,
   limit Y" status line answers this.
5. **Is the gesture reaching the game?** Counter of injected gestures, plus
   device-write failure counters. Distinguish "not queued", "queued but device
   write failed", "written but game ignored".
6. **Is it the right kind of gesture?** Tap vs hold — see below.

## Tap vs hold, measured

For anything that steers with a held finger, count completed holds:

```text
sessions: 97 -> 130 in 3 s   (~11/s)  = TAPS, not steering
sessions: 1 -> 2 -> 2 -> 2               = correct hold
```

Rising sessions while `active = 1` means the finger is being released and
re-pressed while you still believe it is held. Two causes: a duration cap
coercing an "indefinite" request, or another feature stopping the shared
contact on its idle branches.

## Self-serve diagnosis

Once the heartbeat exists, hand the user one command:

```bash
adb shell su -c 'logcat -d | grep Feature'
```

Their report becomes a copy-pasteable data point instead of a description of
symptoms. Build this line before asking the user to describe a bug.

## Anti-patterns

- Logging every frame: logcat drowns, and the buffer rotates away the useful
  early lines.
- Logging only on success: the interesting state is the idle one.
- Encoding diagnosis in a status string the user must transcribe from a
  screenshot.
- Guessing layout from domain knowledge. Every "the bots must be in
  ShowPlayers" style assumption in this project was wrong, and every one of them
  was settled by printing ten raw entries.