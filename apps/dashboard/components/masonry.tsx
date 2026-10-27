'use client';

import { type ReactNode, useLayoutEffect, useRef } from 'react';

const ROW = 4;
const GAP = 16;

function spanClass(element: HTMLElement): number | null {
  const match = /\bmx-s(\d+)\b/.exec(element.className);
  return match ? Number(match[1]) : null;
}

function greedy(sizes: number[]): number[] {
  const heights = [0, 0];
  return sizes.map((size) => {
    const side = (heights[0] as number) <= (heights[1] as number) ? 0 : 1;
    heights[side] = (heights[side] as number) + size;
    return side;
  });
}

export function balance(sizes: number[], start: [number, number] = [0, 0]): number[] {
  const base = greedy(sizes);
  if (sizes.length > 14) return base;
  let best = base;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 1 << sizes.length; mask++) {
    const heights = [...start];
    let moved = 0;
    const sides = sizes.map((size, index) => {
      const side = (mask >> index) & 1;
      heights[side] = (heights[side] as number) + size;
      if (side !== base[index]) moved++;
      return side;
    });
    const score = Math.abs((heights[0] as number) - (heights[1] as number)) + moved * 8;
    if (score < bestScore) {
      bestScore = score;
      best = sides;
    }
  }
  return best;
}

function place(grid: HTMLElement) {
  const children = Array.from(grid.children) as HTMLElement[];
  for (const child of children) {
    child.style.alignSelf = '';
    child.style.marginBottom = '';
    child.style.gridColumn = '';
  }
  const spans = children.map((child) =>
    Math.max(1, Math.ceil((child.getBoundingClientRect().height + GAP) / ROW)),
  );
  const widths = children.map((child) => {
    const style = getComputedStyle(child);
    const match = /span (\d+)/.exec(`${style.gridColumnStart} ${style.gridColumnEnd}`);
    return match ? Number(match[1]) : (spanClass(child) ?? 12);
  });

  let index = 0;
  while (index < children.length) {
    const width = widths[index] as number;
    let end = index;
    while (end < children.length && widths[end] === width) end++;
    if (width === 3 && end - index > 1) {
      for (let row = index; row < end; row += 4) {
        const group = Math.min(end, row + 4);
        const tallest = Math.max(...spans.slice(row, group));
        for (let cell = row; cell < group; cell++) {
          spans[cell] = tallest;
          const child = children[cell] as HTMLElement;
          child.style.alignSelf = 'stretch';
          child.style.marginBottom = `${GAP}px`;
        }
      }
    }
    if (width === 6 && end - index > 2) {
      const sides = balance(spans.slice(index, end));
      sides.forEach((side, offset) => {
        (children[index + offset] as HTMLElement).style.gridColumn =
          side === 0 ? '1 / span 6' : '7 / span 6';
      });
    }
    if (width >= 4 && width <= 8 && width !== 6) {
      const other = 12 - width;
      let cursor = index;
      while (cursor < children.length && (widths[cursor] === width || widths[cursor] === other)) {
        (children[cursor] as HTMLElement).style.gridColumn =
          widths[cursor] === width ? `1 / span ${width}` : `${width + 1} / span ${other}`;
        cursor++;
      }
      end = Math.max(end, cursor);
    }
    index = Math.max(end, index + 1);
  }

  children.forEach((child, position) => {
    child.style.gridRowEnd = `span ${spans[position]}`;
  });
  grid.classList.add('mx-masonry');
}

export function Masonry({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = root.current;
    if (!grid) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => place(grid));
    };
    place(grid);
    const sizes = new ResizeObserver(schedule);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(grid);
      for (const child of Array.from(grid.children)) sizes.observe(child);
    };
    watch();
    const mutations = new MutationObserver(() => {
      watch();
      schedule();
    });
    mutations.observe(grid, { childList: true });
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      mutations.disconnect();
    };
  }, []);

  return (
    <div ref={root} className="mx-grid">
      {children}
    </div>
  );
}
