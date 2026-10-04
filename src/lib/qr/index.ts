import { encode } from 'uqr';

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export function qrModules(payload: string, ecc: QrErrorCorrection, border: number): boolean[][] {
  return encode(payload, { ecc, border }).data;
}

export function qrModulePath(modules: readonly (readonly boolean[])[]): string {
  const runs: string[] = [];

  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) {
        x += 1;
      }
      runs.push(`M${start} ${y}H${x}V${y + 1}H${start}Z`);
    }
  });

  return runs.join('');
}
