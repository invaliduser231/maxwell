export function amount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function signed(value: number, symbol: string): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${amount(Math.abs(value))} ${symbol}`;
}
