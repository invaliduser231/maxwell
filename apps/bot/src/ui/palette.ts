export const palette = {
  north: 0xf26b3a,
  south: 0x3a9eea,
  success: 0x2eb67d,
  warning: 0xf2c14e,
  danger: 0xdc2f55,
  muted: 0x8a8f98,
} as const;

export type Tone = keyof typeof palette;
