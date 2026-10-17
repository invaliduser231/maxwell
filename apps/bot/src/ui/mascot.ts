import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const moods = ['neutral', 'happy', 'error', 'thinking', 'skeptical', 'sleeping'] as const;

export type Mood = (typeof moods)[number];

export interface MascotArt {
  file: { name: string; data: Uint8Array };
  url: string;
}

export class Mascot {
  readonly #art = new Map<Mood, MascotArt>();

  constructor(dir = join(import.meta.dirname, '..', '..', '..', '..', 'assets', 'png', 'mascot')) {
    for (const mood of moods) {
      const path = join(dir, `${mood}.png`);
      if (!existsSync(path)) continue;
      const name = `maxwell-${mood}.png`;
      this.#art.set(mood, {
        file: { name, data: readFileSync(path) },
        url: `attachment://${name}`,
      });
    }
  }

  get(mood: Mood): MascotArt | null {
    return this.#art.get(mood) ?? null;
  }
}
