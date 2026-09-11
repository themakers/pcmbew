import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
export const HOME = process.env.WEBMCP_HOME || join(homedir(), ".webmcp-bridge-ext");
export const PIPE = process.platform === "win32" ? "\\\\.\\pipe\\webmcp-bridge-" + createHash("sha256").update(HOME).digest("hex").slice(0, 20) : join(HOME, "broker.sock");
export function privateFile(path: string) {
  if (process.platform === "win32") {
    const user = (process.env.USERDOMAIN ? process.env.USERDOMAIN + "\\" : "") + userInfo().username;
    execFileSync("icacls", [path, "/inheritance:r", "/grant:r", `${user}:(F)`], { stdio: "ignore" });
  } else chmodSync(path, 0o600);
}
export function credential(create = false): string {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const path = join(HOME, "auth.json");
  if (create) { try { writeFileSync(path, JSON.stringify({ token: randomBytes(32).toString("hex") }), { flag: "wx", mode: 0o600 }); privateFile(path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; } }
  const token = JSON.parse(readFileSync(path, "utf8")).token;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid local credentials. Run install/doctor from the harness.");
  return token;
}
export function equalSecret(a: unknown, b: string) { if (typeof a !== "string") return false; const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
