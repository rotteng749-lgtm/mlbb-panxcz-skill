#!/usr/bin/env node
// ============================================================================
//  Skill installer (generic)
// ---------------------------------------------------------------------------
//  Copies the bundled skill into an OpenCode skills directory. The skill name
//  is read from SKILL.md frontmatter, so the same installer works for any skill
//  in this repo family -- no hardcoded name to drift out of sync.
//
//    npx <pkg> install --global     # every project for this user
//    npx <pkg> install --project    # .opencode/skills/ in cwd
//    npx <pkg> install --dir <path> # somewhere else
//    npx <pkg> path --global        # print the target, install nothing
//    npx <pkg> uninstall --global
//
//  Design notes (each of these is a failure mode someone actually hit):
//
//  * The USER-level skills dir is $XDG_CONFIG_HOME/opencode/skills when that is
//    set, and ~/.config/opencode/skills otherwise. Honouring XDG_CONFIG_HOME is
//    not a nicety: hardcoding ~/.config installs into a directory OpenCode
//    never reads, and the symptom is "the skill never triggers", discovered
//    much later.
//
//  * Never clobber silently. An existing install is renamed to
//    <name>.bak-<timestamp>. Losing a hand-edited SKILL.md without a trace is
//    the worst thing this script could do.
//
//  * Verify the payload after copying. "Installed" pointing at a directory with
//    no SKILL.md, or with a SKILL.md that has no frontmatter, is worse than a
//    hard error: OpenCode starts fine and the feature is simply absent.
//
//  * Explicit payload allowlist. A stray dev file in the package must not
//    become part of the installed skill -- OpenCode loads whatever is there.
//
//  * No dependencies, no network. If this script can run, the skill is there.
// ============================================================================

import {
  cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const pkgMeta = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  } catch {
    return {};
  }
})();
const PKG = pkgMeta.name ?? "skill";
const VERSION = pkgMeta.version ?? "?";

// Skill name comes from the frontmatter; fall back to the package name so a
// broken checkout still installs to *something* predictable.
const SKILL_NAME = (() => {
  try {
    const m = readFileSync(join(ROOT, "SKILL.md"), "utf8").match(/^name:\s*(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : PKG;
  } catch {
    return PKG;
  }
})();

const PAYLOAD = ["SKILL.md", "references", "eval"];

function userSkillsDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim()) return join(xdg, "opencode", "skills");
  return join(homedir(), ".config", "opencode", "skills");
}

function projectSkillsDir(cwd) {
  return join(cwd, ".opencode", "skills");
}

function parseArgs(argv) {
  const out = { cmd: "install", scope: null, dir: null, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--global" || a === "-g") out.scope = "global";
    else if (a === "--project" || a === "-p" || a === "--local") out.scope = "project";
    else if (a === "--force" || a === "-f") out.force = true;
    else if (a === "--dir") out.dir = argv[++i];
    else if (a === "--version" || a === "-v") out.cmd = "version";
    else if (!a.startsWith("-") && out.cmd === "install") out.cmd = a;
  }
  return out;
}

function usage() {
  return `${PKG} v${VERSION}

  Install the "${SKILL_NAME}" OpenCode skill.

  Usage
    ${PKG} install --global      install for the current user, all projects
    ${PKG} install --project     install into ./.opencode/skills/
    ${PKG} install --dir <path>  install into an arbitrary directory
    ${PKG} path --global         print the resolved target path, change nothing
    ${PKG} uninstall --global    remove an installed copy
    ${PKG} --version

  Options
    -g, --global     user-level skills dir ($XDG_CONFIG_HOME/opencode/skills,
                     else ~/.config/opencode/skills)
    -p, --project    <cwd>/.opencode/skills
        --dir <p>    explicit destination (the skill dir is created inside it)
    -f, --force      overwrite an existing skill without making a backup
    -h, --help       this text

  Restart OpenCode after installing.`;
}

function resolveTarget(args) {
  if (args.dir) return resolve(args.dir, SKILL_NAME);
  if (args.scope === "project" || (!args.scope && process.env.CI))
    return join(projectSkillsDir(process.cwd()), SKILL_NAME);
  return join(userSkillsDir(), SKILL_NAME);
}

function backupExisting(dest, force) {
  if (!existsSync(join(dest, "SKILL.md"))) return null;
  if (force) {
    rmSync(dest, { recursive: true, force: true });
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const bak = `${dest}.bak-${stamp}`;
  renameSync(dest, bak);
  return bak;
}

function install(dest, force) {
  const missing = PAYLOAD.filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`[x] package is incomplete, missing: ${missing.join(", ")}`);
    console.error("    Reinstall from the npm registry; do not edit the tarball.");
    process.exit(1);
  }

  mkdirSync(dirname(dest), { recursive: true });
  const bak = backupExisting(dest, force);
  if (bak) console.log(`[*] existing skill moved aside: ${bak}`);

  mkdirSync(dest, { recursive: true });
  for (const f of PAYLOAD) cpSync(join(ROOT, f), join(dest, f), { recursive: true });

  const skillMd = join(dest, "SKILL.md");
  if (!existsSync(skillMd)) {
    console.error(`[x] install finished but ${skillMd} is missing -- OpenCode will not see this skill.`);
    process.exit(1);
  }
  const text = readFileSync(skillMd, "utf8");
  if (!/^---\r?\n/.test(text)) {
    console.error("[x] SKILL.md has no YAML frontmatter -- OpenCode will ignore the skill.");
    process.exit(1);
  }
  if (text.length < 200) {
    console.error("[x] SKILL.md looks truncated -- refusing to report success.");
    process.exit(1);
  }
  const refsOk = existsSync(join(dest, "references"))
    && statSync(join(dest, "references")).isDirectory();

  console.log(`[ok] ${SKILL_NAME} v${VERSION}`);
  console.log(`     -> ${dest}`);
  console.log(`     references/: ${refsOk ? "ok" : "MISSING (prose fallback only)"}`);
  console.log("     Restart OpenCode to pick it up.");
}

function uninstall(dest) {
  if (!existsSync(join(dest, "SKILL.md"))) {
    console.log(`[ok] nothing to remove at ${dest}`);
    return;
  }
  rmSync(dest, { recursive: true, force: true });
  console.log(`[ok] removed ${dest}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
if (args.cmd === "version") {
  console.log(VERSION);
  process.exit(0);
}

const target = resolveTarget(args);
switch (args.cmd) {
  case "install":
    install(target, args.force);
    break;
  case "uninstall":
  case "remove":
    uninstall(target);
    break;
  case "path":
    console.log(target);
    break;
  default:
    console.error(`[x] unknown command: ${args.cmd}`);
    console.error(usage());
    process.exit(2);
}