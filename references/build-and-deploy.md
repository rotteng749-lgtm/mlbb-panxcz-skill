# Build, verify, deploy

## Layout

```
project/
  build.sh              # NDK resolver + compile + strip + guard
  jni/src/main.cpp      # UI, features, main loop
  jni/src/<Feature>.h   # feature logic, included after its deps
  jni/include/          # offset table, shared headers
  tools/                # probes, scanners, deploy helpers
```

Keep features in their own headers included *after* the helpers they use.
C++ has no forward declaration for "the thing defined 4000 lines later", and
the failure mode is a confusing wall of redeclaration errors.

## Build

- Resolve the NDK by searching a list of locations and `$NDK_HOME`; never
  hardcode a version path.
- Target `aarch64-linux-android28` (or 21 if you rely on nothing newer).
- Compile the hot path (`main.cpp`, touch helper, memory layer) at `-O2`; leave
  cold startup code at `-O0` if size matters.
- Strip and verify the result. Optionally obfuscate, but always produce a
  readable build for debugging first.

## Gates — check every build, they regress silently

1. **16 KB LOAD alignment.** Android 15+ rejects page-misaligned code.
   ```bash
   readelf -lW ./binary | grep LOAD    # every Align must be 0x4000
   ```
2. **Integrity guard.** If you hash code to detect tampering, re-verify on a
   timer in a separate thread and confirm the entry points are still exported:
   ```bash
   readelf --dyn-syms -W ./binary | grep <entry_symbol>
   ```
3. **Self-test.** Must pass with **no game running**, so it is usable as a
   commit gate:
   ```bash
   SELFTEST=1 ./binary
   ```
   Count PASS/FAIL explicitly. A run that prints nothing is a failed run.
4. **Checksum** recorded so the deployed artifact is provably the built one.

## Self-tests

Put pure logic behind free functions and test the decision, not the effect.
Good candidates: target selection and priority ordering, range gating, phase
gating (draft vs in-match), alive/dead acceptance, weapon/step sequencing,
and the pure filters.

Rules that have paid off:
- Save and restore every global the test mutates. Tests share one binary with
  live code.
- Assert with an explanatory label, and make the message name the rule
  ("target beyond max distance is dropped"), not the assertion.
- A failing self-test is usually a **wrong expectation**, not wrong code —
  read which one it is before editing anything.

## Deploy

```bash
adb push ./binary /data/local/tmp/
adb shell su -c 'chmod 755 /data/local/tmp/binary'
adb shell su -c '/data/local/tmp/binary'        # or a start script
```

- Binaries must **not** be executed from `/sdcard` (no exec bit). Push to
  `/data/local/tmp` and copy a keep-version to `/sdcard/<dir>/` if you want it
  archived.
- Name an ELF that is also a script `.sh` only if you intend to run it directly
  with `su -c`; some Android shells will treat it as a script and die.
- Do not deploy over a live game session unless the user asks. Restarting the
  tool is invisible; restarting their match is not.

## Runtime log access

```bash
adb shell su -c 'logcat -d | grep <TAG>'
```

Tags must be greppable and low-volume. `logcat -d -s TAG` has been unreliable on
some devices; pipe through `grep` instead. Keep a boot/health tag separate from
per-frame tags.

Note that stdout is redirected to `/dev/null` once the tool detaches, so
anything worth reading afterwards must go through `logcat`.