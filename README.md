# mlbb-panxcz — an OpenCode skill for MLBB external overlay tooling

An [OpenCode](https://opencode.ai) skill that encodes the workflow for building,
extending, porting and debugging **Mobile Legends external overlay tools**: a
standalone arm64 Android ELF that reads another app's memory, draws an ImGui
overlay, and injects touches through grabbed uinput devices.

It is a playbook, not a library. There is no source code to import — what it
carries is the sequence of steps and the layout facts that are expensive to
rediscover.

## Why this exists

Most of the time spent on an MLBB overlay is not spent writing features. It is
spent discovering that:

- the game's offsets shifted without an app-version bump;
- the field you wanted is `<m_EnergyPoint>k__BackingField`, not `m_EnergyPoint`;
- enemy bots live in the *monster* entity list with `m_iType == 4`;
- world projection of points behind the camera returns garbage, not an error;
- a "hold" implemented as repeated press/release cycles is a tap to the game;
- two features sharing one synthetic finger silently break each other.

Every one of those is written down here, with the measurement that revealed it.

## Install

### npx (no clone, no build)

```bash
# every project, for the current user
npx mlbb-panxcz-skill install --global

# just this repo
npx mlbb-panxcz-skill install --project

# somewhere else entirely
npx mlbb-panxcz-skill install --dir /path/to/skills
```

Other commands:

```bash
npx mlbb-panxcz-skill path --global     # print the resolved target, install nothing
npx mlbb-panxcz-skill uninstall --global
npx mlbb-panxcz-skill --version
npx mlbb-panxcz-skill --help
```

Installing from a local checkout or tarball (how the package itself was tested —
`npx <tarball>` does **not** work, it tries to exec the archive; `--package`
tells npx which binary to run):

```bash
npm pack                                   # -> mlbb-panxcz-skill-0.1.0.tgz
npx --package ./mlbb-panxcz-skill-0.1.0.tgz mlbb-panxcz-skill install --global
```

### git / manual

```bash
git clone https://github.com/rotteng749-lgtm/mlbb-panxcz-skill ~/.config/opencode/skills/mlbb-panxcz
# or, while developing, symlink so edits take effect immediately:
ln -s "$PWD" ~/.config/opencode/skills/mlbb-panxcz
```

**Restart OpenCode after installing** — skills are discovered at startup.

### What the installer guarantees

- The user-level target is `$XDG_CONFIG_HOME/opencode/skills/` when that is
  set, otherwise `~/.config/opencode/skills/`. Hardcoding `~/.config` installs
  into a directory OpenCode never reads.
- An existing install is **renamed to `<name>.bak-<timestamp>`**, not
  overwritten. Your edited `SKILL.md` survives an upgrade.
- After copying, it verifies `SKILL.md` exists *and* has YAML frontmatter, and
  reports the resolved path. An install that silently landed in the wrong
  directory shows up much later as "the skill never triggers".
- Zero dependencies and no network access at install time.

Options: `--global` / `--project` / `--dir <p>`, `-f/--force` to overwrite
without a backup, `-h/--help`.

## What it triggers on

Mobile Legends / MLBB / `com.mobile.legends[.usa]` / `libcsharp.so` /
`global-metadata.dat` / il2cpp offsets / `ShowEntity` / `BattleManager` /
auto retri / auto aim / ESP / minimap dots / uinput touch injection /
healing offsets after an update / GLOBAL vs US offset shifts / NDK arm64
build / adb deploy — and also looser phrasing like "the overlay", "the tool",
"the cheat", "auto aim doesn't work" *in an MLBB context*.

## Contents

| Path | What's in it |
|---|---|
| `SKILL.md` | the workflow and the four non-negotiables |
| `references/offsets-and-heal.md` | il2cpp layout, class slots, static blobs, the heal table, the metadata probe CLI, the raw-offset scanner |
| `references/touch-injection.md` | grabbing uinput devices, tap vs hold semantics, shared-contact ownership, gating rules |
| `references/build-and-deploy.md` | NDK build, 16 KB alignment gate, integrity guard, self-tests, adb deploy |
| `references/diagnosis.md` | logcat tag layout, status-on-change + heartbeat, rejection counters, triage order |
| `references/ui-and-config.md` | ImGui theming that keeps animation, scaling, custom widgets, config clamping |
| `eval/eval_set.json` | 17 should-trigger + 10 should-not-trigger queries |

## Evaluate the trigger

Trigger evaluation runs real model calls, so it costs money. Run it only when
you want to:

```bash
# validate structure (free, no model calls)
opencode   # then: "validate the mlbb-panxcz skill"

# measure trigger accuracy (costs model calls)
skill_eval(evalSetPath=".../eval/eval_set.json",
           skillPath=".../mlbb-panxcz-skill")
```

`eval/eval_set.json` is intentionally left un-run: shipping it ready means the
trigger can be measured later without rewriting queries.

## Install via npm

The package is ready but **not yet published** to the npm registry (the
publishing account isn't authenticated on this machine). To publish:

```bash
npm adduser                # or: npm login
npm publish                 # from this directory
```

Then `npx mlbb-panxcz-skill install --global` works from the registry.

## Status

Skill structure validated. Installer verified end-to-end against a local
tarball: install, post-install verification, uninstall, and backup-on-conflict. Trigger accuracy and workflow output quality are not
yet benchmarked — the eval set is provided so that is a one-command follow-up.

## License

Apache-2.0.