import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
mkdirSync("artifacts", { recursive: true });
const stage = "artifacts/runtime";
rmSync(stage, { recursive: true, force: true }); mkdirSync(stage);
const pkg = JSON.parse(readFileSync("package.json", "utf8")); delete pkg.devDependencies; delete pkg.scripts;
writeFileSync(join(stage, "package.json"), JSON.stringify(pkg, null, 2));
cpSync("dist", join(stage, "dist"), { recursive: true });
for (const name of ["README.md", "SKILL.md", "LICENSE", "agents", "references"]) cpSync(name, join(stage, name), { recursive: true });
const p = Bun.spawnSync([process.execPath, "install", "--production", "--ignore-scripts"], { cwd: stage, stdout: "inherit", stderr: "inherit" });
if (p.exitCode) throw new Error("Runtime dependency installation failed");
function zip(directory: string) {
  const files: Record<string, Uint8Array> = {};
  function visit(path = "") {
    for (const name of readdirSync(join(directory, path)).sort()) {
      if ([".bin", ".cache"].includes(name)) continue;
      const key = path ? path + "/" + name : name, full = join(directory, key), stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error("Unexpected runtime symlink: " + key);
      if (stat.isDirectory()) visit(key); else files[key] = readFileSync(full);
    }
  }
  visit(); return zipSync(files, { level: 6 });
}
writeFileSync("artifacts/runtime.zip", zip(stage));
writeFileSync("artifacts/extension.zip", zip("dist/extension"));
const skill = "artifacts/skill"; rmSync(skill, { recursive: true, force: true }); mkdirSync(skill);
for (const name of ["README.md", "SKILL.md", "LICENSE", "agents", "references"]) cpSync(name, join(skill, name), { recursive: true });
writeFileSync("artifacts/skill.zip", zip(skill));
