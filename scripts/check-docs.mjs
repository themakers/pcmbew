import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const read = path => readFileSync(path, "utf8");
const skill = read("SKILL.md");
assert.equal(read("README.md"), skill, "README.md and SKILL.md must stay identical");
assert.match(skill, /^---\nname: pcmbew\ndescription: >-\n[\s\S]+?\n---\n/);
assert(skill.split("\n").length < 500, "Keep the entrypoint below 500 lines");
assert(existsSync("agents/openai.yaml"), "Missing skill UI metadata");

const files = ["README.md", "SKILL.md", ...readdirSync("references").filter(f => f.endsWith(".md")).map(f => join("references", f))];
let snippets = 0;
for (const file of files) {
  const text = read(file);
  assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, `Unbalanced fences in ${file}`);
  for (const [, target] of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    if (/^(?:[a-z]+:|#)/i.test(target)) continue;
    assert(existsSync(resolve(dirname(file), target.split("#")[0])), `${file}: missing ${target}`);
  }
  for (const [, language, source] of text.matchAll(/^```(\w+)\n([\s\S]*?)^```/gm)) {
    if (language === "json") { JSON.parse(source); snippets++; }
    if (language === "toml") { Bun.TOML.parse(source); snippets++; }
    if (["typescript", "javascript"].includes(language)) {
      new Bun.Transpiler({ loader: language === "typescript" ? "ts" : "js" }).transformSync(source);
      snippets++;
    }
  }
}
for (const name of ["pi", "OpenCode", "Claude Code", "Codex", "Cursor", "VS Code", "Gemini CLI", "Claude Desktop"]) {
  assert(read("references/harnesses.md").includes(name), `Missing recipe: ${name}`);
}
console.log(`Documentation OK: ${files.length} Markdown files, ${snippets} parsed code examples, matching skill/README and local links.`);
