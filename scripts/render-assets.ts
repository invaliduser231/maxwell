import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = join(import.meta.dirname, '..', 'assets');
const widths: Record<string, number> = { icons: 160, emoji: 160, mascot: 256, brand: 1024 };
const overrides: Record<string, number> = { 'brand/banner': 1500 };

function render(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

const written: string[] = [];
for (const group of readdirSync(join(root, 'svg'))) {
  for (const file of readdirSync(join(root, 'svg', group)).filter((f) => f.endsWith('.svg'))) {
    const name = `${group}/${basename(file, '.svg')}`;
    const width = overrides[name] ?? widths[group] ?? 512;
    const out = join(root, 'png', `${name}.png`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, render(readFileSync(join(root, 'svg', group, file), 'utf8'), width));
    written.push(`${name} ${width}px`);
  }
}

const preview = process.argv[2];
if (preview) {
  const groups = ['icons', 'emoji', 'mascot'];
  const sizes = [22, 32, 64];
  const cells: string[] = [];
  let y = 24;
  for (const background of ['#1A1A1E', '#FFFFFF']) {
    cells.push(
      `<rect x="0" y="${y - 24}" width="1200" height="${groups.length * 3 * 80 + 24}" fill="${background}"/>`,
    );
    for (const group of groups) {
      for (const size of sizes) {
        let x = 24;
        for (const file of readdirSync(join(root, 'svg', group))) {
          const inner = readFileSync(join(root, 'svg', group, file), 'utf8').replace(
            '<svg ',
            `<svg x="${x}" y="${y}" width="${size}" height="${size}" `,
          );
          cells.push(inner);
          x += Math.max(size, 32) + 24;
        }
        y += 80;
      }
    }
    y += 24;
  }
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${y}">${cells.join('')}</svg>`;
  writeFileSync(preview, render(sheet, 1200));
  written.push(`preview ${preview}`);
}

console.log(written.join('\n'));
