// Original synthesized tones; no recordings or third-party assets. Rebuild with Node.js.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

const directory = new URL('../apps/web/public/sounds/', import.meta.url);
mkdirSync(directory, { recursive: true });
const rate = 16000;
const sounds = {
  operation: [0.14, 660, 880],
  special: [0.22, 784, 1047],
  win: [0.28, 880, 1320],
  draw: [0.22, 440, 330],
  settled: [0.16, 523, 659],
};
for (const [name, [duration, first, second]] of Object.entries(sounds)) {
  const samples = Math.round(rate * duration);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const envelope = Math.min(t / 0.012, 1) * (1 - t / duration) ** 2;
    const tone = Math.sin(2 * Math.PI * first * t) + 0.4 * Math.sin(2 * Math.PI * second * t);
    wav.writeInt16LE(Math.round(6500 * envelope * tone), 44 + i * 2);
  }
  writeFileSync(new URL(`${name}.wav`, directory), wav);
}
