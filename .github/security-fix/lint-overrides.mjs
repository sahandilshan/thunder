// Checks the pnpm-workspace.yaml conventions that upstream review enforces on dependency fixes, so a fix
// passes in one round. Each rule matches a review finding on thunder-id/thunderid#5942:
//
//   narrow    a touched override is range-qualified (pkg@<range) or parent-scoped (parent>pkg), not a bare pin
//   justify   a touched override's comment has JUSTIFICATION, an advisory ID, "Added YYYY-MM-DD" and "Remove once"
//             (.agent/skills/prune-npm-overrides/SKILL.md, Step 5)
//   advisory  every GHSA ID in a touched override's comment lists that package in the GitHub advisory database
//   stale     no unchanged comment still names a package version this change replaced
//
// Usage: node lint-overrides.mjs --repo <dir> --base <sha> [--head <sha>] [--offline]
// Prints {problems, touched} as JSON and exits 1 when there are problems. --offline skips the advisory rule.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ADVISORY_ID = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi;

/** Entries of a top-level YAML map such as overrides or catalog, with the comment block directly above each. */
export function mapEntries(text, section) {
  const entries = {};
  let inside = false;
  let comment = [];
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      inside = line.startsWith(`${section}:`);
      comment = [];
      continue;
    }
    if (!inside) continue;
    const note = line.match(/^ {2}#\s?(.*)$/);
    if (note) {
      comment.push(note[1]);
      continue;
    }
    const entry = line.match(/^ {2}(?:'([^']+)'|"([^"]+)"|([^\s'"#][^:]*?)):\s*(.*?)\s*$/);
    if (entry) {
      const key = entry[1] ?? entry[2] ?? entry[3];
      entries[key] = { value: entry[4].replace(/^['"]|['"]$/g, ""), comment: comment.join("\n") };
    }
    comment = [];
  }
  return entries;
}

/**
 * "parent>child@range" -> {name: child, range, scoped, identity: "parent>child"}. Ranges may contain ">" (">=1.0.0").
 */
export function overrideTarget(key) {
  const parts = key.split(/>(?![=\d\s])/);
  const last = parts[parts.length - 1];
  const at = last.indexOf("@", 1);
  const name = at > 0 ? last.slice(0, at) : last;
  return { name, range: at > 0 ? last.slice(at + 1) : "", scoped: parts.length > 1, identity: [...parts.slice(0, -1), name].join(">") };
}

const versions = (value) => String(value).match(/\d+\.\d+\.\d+[\w.-]*/g) ?? [];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** lookup(id) resolves to the package names an advisory lists, or throws. Pass null to skip the advisory rule. */
export async function lintWorkspace(baseText, headText, lookup) {
  const problems = [];
  const baseOverrides = mapEntries(baseText, "overrides");
  const headOverrides = mapEntries(headText, "overrides");
  const touched = Object.keys(headOverrides).filter((key) => {
    const before = baseOverrides[key];
    return !before || before.value !== headOverrides[key].value || before.comment !== headOverrides[key].comment;
  });

  for (const key of touched) {
    const { value, comment } = headOverrides[key];
    const target = overrideTarget(key);
    if (!target.scoped && !target.range) {
      problems.push(
        `overrides "${key}: ${value}" pins every version of ${target.name}. Use ${target.name}@<affected range> or <parent>>${target.name} (prune-npm-overrides Step 5).`,
      );
    }
    const missing = [
      [/JUSTIFICATION:/, "a JUSTIFICATION line"],
      [/GHSA-[a-z0-9]{4}-|CVE-\d{4}-\d+/i, "the advisory ID"],
      [/Added \d{4}-\d{2}-\d{2}/, 'an "Added YYYY-MM-DD" date'],
      [/Remove once/i, 'a "Remove once" condition'],
    ].filter(([pattern]) => !pattern.test(comment));
    if (missing.length) {
      problems.push(`overrides "${key}" justification lacks ${missing.map(([, label]) => label).join(", ")} (prune-npm-overrides Step 5).`);
    }
    if (!lookup) continue;
    for (const normalized of new Set((comment.match(ADVISORY_ID) ?? []).map((match) => `GHSA${match.slice(4).toLowerCase()}`))) {
      try {
        const packages = await lookup(normalized);
        if (!packages.includes(target.name)) {
          problems.push(`overrides "${key}" cites ${normalized}, but that advisory covers ${packages.join(", ") || "no npm package"}, not ${target.name}.`);
        }
      } catch (error) {
        problems.push(`overrides "${key}" cites ${normalized}, which could not be verified: ${error.message}`);
      }
    }
  }

  // Versions this change replaced, by package: catalog entries and override targets.
  const replaced = [];
  const baseCatalog = mapEntries(baseText, "catalog");
  const headCatalog = mapEntries(headText, "catalog");
  for (const [name, entry] of Object.entries(headCatalog)) {
    if (baseCatalog[name] && baseCatalog[name].value !== entry.value) replaced.push([name, baseCatalog[name].value]);
  }
  const headTargets = new Set(Object.keys(headOverrides).map((key) => `${overrideTarget(key).name}=${headOverrides[key].value}`));
  for (const [key, entry] of Object.entries(baseOverrides)) {
    const name = overrideTarget(key).name;
    if (!headTargets.has(`${name}=${entry.value}`) && (!headOverrides[key] || headOverrides[key].value !== entry.value)) {
      replaced.push([name, entry.value]);
    }
  }
  const baseLines = new Set(baseText.split("\n"));
  const comments = headText.split("\n").filter((line) => /^\s*#/.test(line) && baseLines.has(line));
  for (const [name, old] of replaced) {
    for (const version of versions(old)) {
      // A trailing full stop ends a sentence; a digit or ".digit" would make it a different version.
      const pattern = new RegExp(`(^|[^\\w.-])${escape(version)}(?![\\w-]|\\.\\d)`);
      const mention = new RegExp(`(^|[^\\w/-])${escape(name)}([^\\w-]|$)`);
      for (const line of comments) {
        if (pattern.test(line) && mention.test(line)) {
          problems.push(`An unchanged comment still names ${name} ${version}: "${line.trim()}"`);
        }
      }
    }
  }
  return { problems: [...new Set(problems)], touched };
}

export async function githubAdvisoryPackages(id) {
  const response = await fetch(`https://api.github.com/advisories/${id}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const advisory = await response.json();
  return [...new Set((advisory.vulnerabilities ?? []).filter((v) => v.package?.ecosystem === "npm").map((v) => v.package.name))];
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const repo = option("repo");
  const base = option("base");
  const head = option("head");
  if (!repo || !base) throw new Error("Usage: lint-overrides.mjs --repo <dir> --base <sha> [--head <sha>] [--offline]");
  const show = (ref) => execFileSync("git", ["-C", repo, "show", `${ref}:pnpm-workspace.yaml`], { encoding: "utf8" });
  const baseText = show(base);
  const headText = head ? show(head) : readFileSync(join(repo, "pnpm-workspace.yaml"), "utf8");
  const result = await lintWorkspace(baseText, headText, args.includes("--offline") ? null : githubAdvisoryPackages);
  console.log(JSON.stringify(result, null, 2));
  if (result.problems.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
