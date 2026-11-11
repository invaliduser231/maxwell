import { describe, expect, it } from 'vitest';
import { printable } from '../src/cards/glyphs.js';
import { fonts, registerFonts } from '../src/cards/theme.js';

registerFonts();
const body = `600 34px "${fonts.body}"`;
const display = `700 80px "${fonts.display}"`;

describe('printable card text', () => {
  it('turns decorated names into readable ones', () => {
    expect(printable('. ݁₊ ⊹ 𝙰𝚙𝚛𝚒𝚌𝚘𝚝. ݁₊ ⊹ . ݁', body).text).toBe('Apricot');
    expect(printable('ᴀᴘʀɪᴄᴏᴛ', body).text).toBe('APRICOT');
    expect(printable('Ⓛⓔⓝⓐ', body).text).toBe('Lena');
    expect(printable('Ｌｅｎａ', body).text).toBe('Lena');
  });

  it('leaves names alone that the font can show', () => {
    expect(printable('~Kai~', body).text).toBe('~Kai~');
    expect(printable('Zoë & Ana', body).text).toBe('Zoë & Ana');
    expect(printable('Lena…', body).text).toBe('Lena…');
    expect(printable('½ Moon', body).text).toBe('½ Moon');
  });

  it('switches to the body font when the display font lacks letters', () => {
    const shown = printable('Привет', display);
    expect(shown.text).toBe('Привет');
    expect(shown.font).toContain(fonts.body);
    expect(printable('Lena', display).font).toBe(display);
  });

  it('never returns an empty string', () => {
    expect(printable('⊹⊹', body).text).toBe('?');
  });
});
