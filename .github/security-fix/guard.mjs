// Classifies a dependency fix before it can become a pull request.
//
//   auto    only same-major version raises of existing dependencies, catalog entries or overrides
//   review  a change a maintainer must judge: new or removed entries, major bumps, audit ignores,
//           release-age exceptions or any other configuration change
//   reject  a file other than package.json, pnpm-workspace.yaml or pnpm-lock.yaml changed
//   none    nothing changed
//
// Usage: node guard.mjs --repo <dir> --base <sha> [--head <sha>]
// Without --head the working tree (including untracked files) is compared with --base.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { overrideTarget } from "./lint-overrides.mjs";

const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const WORKSPACE_REVIEW_KEYS = ["auditConfig", "audit", "minimumReleaseAgeExclude", "minimumReleaseAge"];

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Lowest version a range or exact version names, as [major, minor, patch].
export function floor(spec) {
  const match = String(spec).match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

// Breaking-change line under semver: 0.x minors and 0.0.x patches break like majors.
function line(version) {
  if (version[0] > 0) return `${version[0]}`;
  if (version[1] > 0) return `0.${version[1]}`;
  return `0.0.${version[2]}`;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const PLAIN_RANGE = /^[\s\d.^~<>=|xX*-]+$/;

// Compares one version map (dependencies, a catalog or overrides) and records the outcome.
function compareVersions(label, before = {}, after = {}, out, { allowNew = false } = {}) {
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[name];
    const now = after[name];
    if (was === now) continue;
    if (was === undefined) {
      if (allowNew) out.auto.push(`${label}: adds ${name} ${now}`);
      else out.review.push(`${label}: adds ${name} ${now}`);
      continue;
    }
    if (now === undefined) {
      out.review.push(`${label}: removes ${name} ${was}`);
      continue;
    }
    if (typeof was !== "string" || typeof now !== "string" || !PLAIN_RANGE.test(was) || !PLAIN_RANGE.test(now)) {
      out.review.push(`${label}: changes ${name} from ${JSON.stringify(was)} to ${JSON.stringify(now)}`);
      continue;
    }
    const from = floor(was);
    const to = floor(now);
    if (!from || !to) {
      out.review.push(`${label}: changes ${name} from ${was} to ${now}`);
    } else if (line(from) !== line(to)) {
      out.review.push(`${label}: major version change for ${name} from ${was} to ${now}`);
    } else if (compare(to, from) < 0) {
      out.review.push(`${label}: lowers ${name} from ${was} to ${now}`);
    } else {
      out.auto.push(`${label}: raises ${name} from ${was} to ${now}`);
    }
  }
}

/**
 * Narrowing an override replaces its key, for example "follow-redirects" with "follow-redirects@<1.16.1".
 * A removed and an added key for the same package and parent path are compared as one entry.
 */
function compareOverrides(before = {}, after = {}, out) {
  const removed = Object.keys(before).filter((key) => !(key in after));
  const added = Object.keys(after).filter((key) => !(key in before));
  const pairedBefore = {};
  const pairedAfter = {};
  for (const key of removed) {
    const identity = overrideTarget(key).identity;
    const matches = added.filter((candidate) => overrideTarget(candidate).identity === identity);
    const others = removed.filter((candidate) => overrideTarget(candidate).identity === identity);
    if (matches.length !== 1 || others.length !== 1) continue;
    const label = `${key} -> ${matches[0]}`;
    pairedBefore[label] = before[key];
    pairedAfter[label] = after[matches[0]];
  }
  const pairedKeys = new Set(Object.keys(pairedBefore).flatMap((label) => label.split(" -> ")));
  const rest = (map) => Object.fromEntries(Object.entries(map).filter(([key]) => !pairedKeys.has(key)));
  compareVersions("pnpm-workspace.yaml overrides", { ...rest(before), ...pairedBefore }, { ...rest(after), ...pairedAfter }, out);
}

export function comparePackageJson(path, beforeText, afterText, out) {
  let before;
  let after;
  try {
    before = beforeText === null ? {} : JSON.parse(beforeText);
    after = afterText === null ? {} : JSON.parse(afterText);
  } catch {
    out.reject.push(`${path}: is not valid JSON`);
    return;
  }
  if (beforeText === null || afterText === null) {
    out.review.push(`${path}: ${beforeText === null ? "adds" : "deletes"} the file`);
    return;
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (DEP_SECTIONS.includes(key)) {
      compareVersions(`${path} ${key}`, before[key], after[key], out);
    } else if (canonical(before[key]) !== canonical(after[key])) {
      out.review.push(`${path}: changes ${key}`);
    }
  }
}

export function compareWorkspace(before, after, out) {
  compareVersions("pnpm-workspace.yaml catalog", before.catalog, after.catalog, out);
  const catalogs = new Set([...Object.keys(before.catalogs ?? {}), ...Object.keys(after.catalogs ?? {})]);
  for (const name of catalogs) {
    compareVersions(`pnpm-workspace.yaml catalogs.${name}`, before.catalogs?.[name], after.catalogs?.[name], out);
  }
  compareOverrides(before.overrides, after.overrides, out);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (["catalog", "catalogs", "overrides"].includes(key)) continue;
    if (canonical(before[key]) === canonical(after[key])) continue;
    out.review.push(
      WORKSPACE_REVIEW_KEYS.includes(key)
        ? `pnpm-workspace.yaml: changes ${key} (audit ignores and release-age exceptions need a maintainer)`
        : `pnpm-workspace.yaml: changes ${key}`,
    );
  }
}

export function yamlToObject(text) {
  if (text === null) return {};
  const json = execFileSync(
    "ruby",
    ["-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.safe_load($stdin.read, aliases: false) || {})"],
    { input: text, encoding: "utf8" },
  );
  return JSON.parse(json);
}

/** files: changed paths; read(path, side) returns the file text or null, side is "before" or "after". */
export function classify(files, read) {
  const out = { auto: [], review: [], reject: [] };
  for (const path of [...files].sort()) {
    if (path === "pnpm-lock.yaml") continue;
    if (path === "pnpm-workspace.yaml") {
      compareWorkspace(yamlToObject(read(path, "before")), yamlToObject(read(path, "after")), out);
    } else if (/(^|\/)package\.json$/.test(path)) {
      comparePackageJson(path, read(path, "before"), read(path, "after"), out);
    } else {
      out.reject.push(`${path}: only dependency files may change`);
    }
  }
  const verdict = out.reject.length ? "reject" : out.review.length ? "review" : files.length ? "auto" : "none";
  return { verdict, files: [...files].sort(), changes: out.auto, reasons: [...out.reject, ...out.review] };
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function main() {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .join(" ")
      .split(/\s*--/)
      .filter(Boolean)
      .map((part) => part.split(/\s+/)),
  );
  const repo = args.repo;
  const base = args.base;
  const head = args.head;
  if (!repo || !base) throw new Error("Usage: guard.mjs --repo <dir> --base <sha> [--head <sha>]");
  const lines = (text) => text.split("\n").filter(Boolean);
  const files = head
    ? lines(git(repo, ["diff", "--name-only", base, head]))
    : [
        ...new Set([
          ...lines(git(repo, ["diff", "--name-only", base])),
          ...lines(git(repo, ["ls-files", "--others", "--exclude-standard"])),
        ]),
      ];
  const show = (ref, path) => {
    try {
      return git(repo, ["show", `${ref}:${path}`]);
    } catch {
      return null;
    }
  };
  const read = (path, side) => {
    if (side === "before") return show(base, path);
    if (head) return show(head, path);
    return existsSync(join(repo, path)) ? readFileSync(join(repo, path), "utf8") : null;
  };
  console.log(JSON.stringify(classify(files, read), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
