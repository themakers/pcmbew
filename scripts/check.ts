import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { VERSION, EXTENSION_ID, TOOLS } from "../src/shared";
const read = (p: string) => readFileSync(p, "utf8");
assert.equal(read("README.md"), read("SKILL.md"));
assert(read("SKILL.md").startsWith("---\nname: webmcp-bridge-ext\n"));
assert(read("SKILL.md").split("\n").length < 500);
const manifest = JSON.parse(read("extension/manifest.json"));
assert.equal(manifest.version, VERSION); assert.equal(JSON.parse(read("package.json")).version, VERSION);
assert.equal(createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32).replace(/[0-9a-f]/g, s => String.fromCharCode(97 + parseInt(s, 16))), EXTENSION_ID);
assert.equal(TOOLS.length, 5); assert.equal(new Set(TOOLS.map(t => t.name)).size, 5);
for (const file of ["README.md", "SKILL.md", ...readdirSync("references").map(f => "references/" + f)]) {
  const text = read(file);
  for (const [, target] of text.matchAll(/\]\(([^\s)]+)\)/g)) if (!/^(?:[a-z]+:|#)/i.test(target)) assert(existsSync(resolve(dirname(file), target.split("#")[0])), file + ": " + target);
  for (const [, language, source] of text.matchAll(/^```(\w+)\n([\s\S]*?)^```/gm)) {
    if (language === "json") JSON.parse(source);
    if (language === "toml") Bun.TOML.parse(source);
  }
}
console.log("Skill, links, examples, identities and versions verified.");
