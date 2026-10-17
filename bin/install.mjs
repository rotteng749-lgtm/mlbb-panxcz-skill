#!/usr/bin/env node
// ============================================================================
//  mlbb-panxcz-skill installer
// ---------------------------------------------------------------------------
//  Copies the bundled skill into an OpenCode skills directory.
//
//    npx mlbb-panxcz-skill install --global     # every project for this user
//    npx mlbb-panxcz-skill install --project    # .opencode/skills/ in cwd
//    npx mlbb-panxcz-skill install --dir <path> # somewhere else
//    npx mlbb-panxcz-skill path --global        # print the target, install nothing
//    npx mlbb-panxcz-skill uninstall --global
//
//  Design notes (learned from having to install one of these):
//
//  * The USER-level skills dir is $XDG_CONFIG_HOME/opencode/skills when that is
//    set, and ~/.config/opencode/skills otherwise. Honour XDG_CONFIG_HOME --
//    hardcoding ~/.config is the classic way to install into a directory the
//    app never reads.
//
//  * Never clobber silently. If a skill of the same name already exists and
//    differs, the old copy is renamed to <name>.bak-<timestamp> first. Losing
//    someone's edited SKILL.md without a trace is the worst failure mode here,
//    because it is discovered long after the fact.
//
//  * Verify the payload after copying. A "skill installed" message that points
//    at a directory with no SKILL.md is worse than a hard error, because OpenCode
//    then starts fine and the skill simply never triggers.
//
//  * No dependencies, no network. If this script can run, the skill is there.
// ============================================================================

import {
  cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "mlbb-panxcz";
const PKG = "mlbb-panxcz-skill";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

// Only these get copied. A stray dev file in the package must not become part
// of the installed skill (OpenCode loads whatever is under the skill dir).
const PAYLOAD = ["SKILL.md", "references", "eval"];

function version() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version ?? "?";
  } catch {
    return "?";
  }
}

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
  return `mlbb-panxcz-skill v${version()}

  Install the "${SKILL_NAME}" OpenCode skill (MLBB external overlay playbook).

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
        --dir <p>    explicit destination (parent dir; the skill is created
                     inside it)
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
  for (const f of PAYLOAD) {
    cpSync(join(ROOT, f), join(dest, f), { recursive: true });
  }

  // Verify what landed, not what we intended.
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
  const refs = existsSync(join(dest, "references")) ? statSync(join(dest, "references")).isDirectory() : false;
  console.log(`[ok] ${SKILL_NAME} v${version()}`);
  console.log(`     -> ${dest}`);
  console.log(`     references/: ${refs ? "ok" : "MISSING (prose fallback only)"}`);
  console.log("     Restart OpenCode, then ask about MLBB / il2cpp offsets / touch injection.");
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
  console.log(version());
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