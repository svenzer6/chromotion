// RFC 4180 CSV with spreadsheet formula-injection protection on export.

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export const escapeCell = (value: unknown): string => {
  let s = value === undefined || value === null ? '' : String(value);
  if (FORMULA_PREFIX.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
};

export const unescapeFormula = (s: string): string => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

export const toCsv = (header: string[], rows: unknown[][]): string =>
  [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';

export const parseCsv = (input: string): string[][] => {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
};
