import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unzipSync } from "fflate";
import { verify } from "sigstore";
import { HOME, credential } from "./local";
import { VERSION, WIRE, HOST, EXTENSION_ID, REPO } from "./shared";
export const current = () => { try { return JSON.parse(readFileSync(join(HOME, "current.json"), "utf8")) as { version: string; previous?: string }; } catch { return undefined; } };
export const validVersion = (v: string) => /^\d+\.\d+\.\d+$/.test(v);
export function newer(a: string, b: string) { if (!validVersion(a) || !validVersion(b)) throw new Error("Invalid release version"); const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }
async function bytes(url: string, limit: number) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { "User-Agent": "webmcp-bridge-ext/" + VERSION } });
  if (!r.ok) throw new Error(`Release download failed: HTTP ${r.status}`);
  const reader = r.body!.getReader(), chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error("Release size limit exceeded"); } chunks.push(value); }
  return Buffer.concat(chunks);
}
export async function latestVersion() {
  const release = JSON.parse((await bytes(`https://api.github.com/repos/${REPO}/releases/latest`, 256 * 1024)).toString());
  const v = String(release.tag_name).replace(/^v/, ""); if (!validVersion(v) || release.draft || release.prerelease) throw new Error("Invalid latest release"); return v;
}
export async function verifiedRuntime(version: string) {
  if (!validVersion(version)) throw new Error("Only numeric release versions are accepted");
  const base = `https://github.com/${REPO}/releases/download/v${version}/`;
  const manifest = await bytes(base + "release.json", 64 * 1024);
  const bundle = JSON.parse((await bytes(base + "release.sigstore.json", 128 * 1024)).toString());
  await verify(bundle, manifest, { certificateIssuer: "https://token.actions.githubusercontent.com", certificateIdentityURI: `https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/v${version}` });
  const meta = JSON.parse(manifest.toString());
  if (meta.version !== version || meta.wire !== WIRE || meta.runtime?.name !== "runtime.zip" || typeof meta.runtime.sha256 !== "string") throw new Error("Incompatible or invalid signed release");
  const archive = await bytes(base + "runtime.zip", 64 * 1024 * 1024);
  if (archive.length !== meta.runtime.size || createHash("sha256").update(archive).digest("hex") !== meta.runtime.sha256) throw new Error("Release checksum mismatch");
  return archive;
}
export function extract(archive: Uint8Array, destination: string) {
  let total = 0;
  const files = unzipSync(archive, { filter: f => {
    if (!f.name || f.name.includes("\\") || f.name.startsWith("/") || f.name.split("/").includes("..") || /^[A-Za-z]:/.test(f.name)) throw new Error("Unsafe archive path");
    total += f.originalSize; if (total > 256 * 1024 * 1024) throw new Error("Expanded archive size limit exceeded"); return true;
  } });
  for (const [name, data] of Object.entries(files)) { const path = join(destination, name); if (name.endsWith("/")) mkdirSync(path, { recursive: true }); else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); } }
}
export function nativeManifestPath(browser = "chrome") {
  if (!["chrome", "chromium"].includes(browser)) throw new Error("Supported browsers: chrome, chromium");
  if (process.platform === "win32") return join(HOME, HOST + ".json");
  const base = process.platform === "darwin" ? join(homedir(), "Library", "Application Support", browser === "chrome" ? "Google/Chrome" : "Chromium") : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), browser === "chrome" ? "google-chrome" : "chromium");
  return join(base, "NativeMessagingHosts", HOST + ".json");
}
function register(browser: string) {
  const runtime = process.execPath, launch = join(HOME, "runner.cjs"), executable = join(HOME, process.platform === "win32" ? "native-host.cmd" : "native-host.sh");
  if (/[\r\n"]/.test(runtime + HOME) || (process.platform === "win32" && /[%!]/.test(runtime + HOME))) throw new Error("Unsupported characters in installation path");
  writeFileSync(launch, `const fs=require('fs'),p=require('path'),cp=require('child_process');\nconst home=${JSON.stringify(HOME)};\nconst v=JSON.parse(fs.readFileSync(p.join(home,'current.json'),'utf8')).version;\nif(!/^\\d+\\.\\d+\\.\\d+$/.test(v))throw Error('Invalid installed version');\nconst c=cp.spawn(${JSON.stringify(runtime)},[p.join(home,'versions',v,'dist','cli.js'),...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,WEBMCP_HOME:home}});\nc.on('error',e=>{console.error(e.message);process.exit(1)});c.on('exit',code=>process.exit(code??1));\n`);
  const sh = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
  writeFileSync(executable, process.platform === "win32" ? `@echo off\r\n"${runtime}" "${launch}" native %*\r\n` : `#!/bin/sh\nexec ${sh(runtime)} ${sh(launch)} native "$@"\n`, { mode: 0o700 });
  const path = nativeManifestPath(browser); mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ name: HOST, description: "WebMCP Bridge native connector", path: executable, type: "stdio", allowed_origins: [`chrome-extension://${EXTENSION_ID}/`] }, null, 2));
  if (process.platform === "win32") execFileSync("reg", ["add", `HKCU\\Software\\${browser === "chrome" ? "Google\\Chrome" : "Chromium"}\\NativeMessagingHosts\\${HOST}`, "/ve", "/t", "REG_SZ", "/d", path, "/f"], { stdio: "ignore" });
  writeFileSync(join(HOME, "installation.json"), JSON.stringify({ browser, runtime, manifest: path }));
}
export async function install(version = VERSION, localArchive?: string, browser = "chrome") {
  if (!validVersion(version)) throw new Error("Invalid version");
  credential(true);
  const lock = join(HOME, "install.lock");
  try { writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 }); } catch { throw new Error("Another installation is running. Inspect install.lock before recovery."); }
  const stage = join(HOME, "staging-" + randomUUID()), extensionStage = join(HOME, "extension-stage-" + randomUUID());
  try {
    const archive = localArchive ? readFileSync(resolve(localArchive)) : await verifiedRuntime(version);
    mkdirSync(stage); extract(archive, stage);
    const pkg = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
    const ext = JSON.parse(readFileSync(join(stage, "dist/extension/manifest.json"), "utf8"));
    const id = createHash("sha256").update(Buffer.from(ext.key, "base64")).digest("hex").slice(0, 32).replace(/[0-9a-f]/g, s => String.fromCharCode(97 + parseInt(s, 16)));
    if (pkg.name !== "@themakers/webmcp-bridge-ext" || pkg.version !== version || ext.version !== version || id !== EXTENSION_ID || !existsSync(join(stage, "dist/cli.js"))) throw new Error("Unexpected runtime or extension identity");
    const old = current(), versionDir = join(HOME, "versions", version);
    mkdirSync(dirname(versionDir), { recursive: true });
    if (existsSync(versionDir)) rmSync(stage, { recursive: true }); else renameSync(stage, versionDir);
    cpSync(join(versionDir, "dist/extension"), extensionStage, { recursive: true });
    const extension = join(HOME, "extension"), backup = join(HOME, "extension.previous");
    rmSync(backup, { recursive: true, force: true });
    if (existsSync(extension)) renameSync(extension, backup);
    try { renameSync(extensionStage, extension); writeFileSync(join(HOME, "current.next"), JSON.stringify({ version, previous: old?.version === version ? old.previous : old?.version })); renameSync(join(HOME, "current.next"), join(HOME, "current.json")); }
    catch (e) { rmSync(extension, { recursive: true, force: true }); if (existsSync(backup)) renameSync(backup, extension); throw e; }
    register(browser);
    return { version, extensionDirectory: extension, nativeManifest: nativeManifestPath(browser), endpoint: "http://127.0.0.1:8777/mcp", extensionId: EXTENSION_ID, restartRequired: true };
  } finally { rmSync(stage, { recursive: true, force: true }); rmSync(extensionStage, { recursive: true, force: true }); rmSync(lock, { force: true }); }
}
export function installedCLI() { const c = current(); if (!c) throw new Error("Run install first"); return join(HOME, "versions", c.version, "dist", "cli.js"); }
export function installInfo() { try { return JSON.parse(readFileSync(join(HOME, "installation.json"), "utf8")); } catch { return undefined; } }
