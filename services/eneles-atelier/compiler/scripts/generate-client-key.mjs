#!/usr/bin/env node
/**
 * Generate a compiler client key for an external project.
 *
 *   node scripts/generate-client-key.mjs byblex
 *   node scripts/generate-client-key.mjs byblex laso lebsci
 *
 * Prints one `name:key` entry per project, plus the exact COMPILER_CLIENT_KEYS
 * line to paste into compiler/.env. Keys are 256 bits from the OS CSPRNG,
 * prefixed `ck_` so they are recognisable in logs and config.
 *
 * Nothing is written anywhere. The key exists only in this terminal output and
 * wherever you put it next, so copy it before closing the window. There is no
 * way to recover a lost key; generate a new one and replace the entry.
 */

import { randomBytes } from "node:crypto";

const names = process.argv
  .slice(2)
  .map((n) => n.trim().toLowerCase())
  .filter(Boolean);

if (names.length === 0) {
  console.error("Usage: node scripts/generate-client-key.mjs <name> [name ...]");
  console.error("  e.g. node scripts/generate-client-key.mjs byblex laso lebsci");
  process.exit(1);
}

const invalid = names.filter((n) => !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(n));
if (invalid.length) {
  console.error(
    `Invalid name(s): ${invalid.join(", ")}. Use lowercase letters, digits, - or _ (max 32 chars).`,
  );
  process.exit(1);
}

const entries = names.map(
  (name) => `${name}:ck_${randomBytes(32).toString("hex")}`,
);

console.log("");
console.log("Generated compiler client key(s):");
console.log("");
for (const entry of entries) console.log(`  ${entry}`);
console.log("");
console.log("Add to compiler/.env (append to any existing entries, comma-separated; add :<limit> to an entry to change its 60 compiles a minute):");
console.log("");
console.log(`  COMPILER_CLIENT_KEYS=${entries.join(",")}`);
console.log("");
console.log("Restart the compiler to load them. Each project then calls:");
console.log("");
console.log("  POST <COMPILER_URL>/compile");
console.log("  X-Compiler-Key: <its key>");
console.log("  Content-Type: application/json");
console.log("");
console.log("To revoke a project, delete its entry and restart. Nothing else changes.");
console.log("");
