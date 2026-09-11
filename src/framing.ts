import { endianness } from "node:os";
import type { Readable, Writable } from "node:stream";
import { MAX_FRAME } from "./shared";
const little = endianness() === "LE";
export function encode(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  if (!body.length || body.length > MAX_FRAME) throw new Error("Native frame exceeds 768 KiB");
  const h = Buffer.alloc(4); little ? h.writeUInt32LE(body.length) : h.writeUInt32BE(body.length);
  return Buffer.concat([h, body]);
}
export class Decoder {
  buffer = Buffer.alloc(0);
  push(chunk: Uint8Array): any[] {
    this.buffer = Buffer.concat([this.buffer, chunk]); const messages = [];
    while (this.buffer.length >= 4) {
      const n = little ? this.buffer.readUInt32LE() : this.buffer.readUInt32BE();
      if (!n || n > MAX_FRAME) throw new Error("Invalid native frame size");
      if (this.buffer.length < n + 4) break;
      messages.push(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(this.buffer.subarray(4, n + 4))));
      this.buffer = this.buffer.subarray(n + 4);
    }
    return messages;
  }
}
export function receive(input: Readable, callback: (m: any) => void, fail: (e: Error) => void) {
  const d = new Decoder(); input.on("data", b => { try { for (const m of d.push(b)) callback(m); } catch (e) { fail(e as Error); } });
}
export function send(output: Writable, m: unknown) {
  if (output.destroyed || output.writableLength > 4 * MAX_FRAME) throw new Error("Native connection unavailable or backpressured");
  output.write(encode(m));
}
