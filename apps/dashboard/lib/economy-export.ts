import type { Transaction } from '@maxwell/core/stores/economy';

const FORMULA = /^[-+=@\t\r]/;

function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",;\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function text(value: string | null): string {
  return cell(value !== null && FORMULA.test(value) ? `'${value}` : value);
}

export function transactionRow(row: Transaction): string {
  return [
    cell(row.id),
    cell(row.createdAt.toISOString()),
    cell(row.userId),
    cell(row.amount),
    cell(row.balance),
    text(row.kind),
    text(row.note),
    text(row.ref),
    cell(row.counterpartId),
  ].join(',');
}
