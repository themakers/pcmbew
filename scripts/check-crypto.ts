import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const body = Buffer.from("WebMCP Bridge release verification compatibility");
const signature = sign(null, body, privateKey);
assert(verify(null, body, publicKey, signature), "Runtime cannot verify Sigstore EC signatures");
assert(!verify(null, Buffer.from("tampered"), publicKey, signature), "Signature accepted changed data");
console.log("Sigstore crypto primitives passed.");
