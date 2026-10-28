/** Small dense linear algebra for the sketch solver (sketches have at most a few hundred unknowns). */

export type Matrix = number[][];

/** Solve A x = b by Gaussian elimination with partial pivoting; null when A is singular. */
export function solveLinear(A: Matrix, b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * A basis of the null space of J (m × n): the directions the unknowns can move without changing
 * any residual, to first order. Row reduction with partial pivoting, entries below `tol` (relative
 * to the largest) taken as zero.
 */
export function nullSpace(J: Matrix, n: number, tol = 1e-7): number[][] {
  const R = J.map((row) => [...row]);
  const scale = Math.max(1e-300, ...R.flat().map(Math.abs));
  const eps = tol * scale;
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < n && row < R.length; col++) {
    let piv = row;
    for (let r = row + 1; r < R.length; r++) if (Math.abs(R[r][col]) > Math.abs(R[piv][col])) piv = r;
    if (Math.abs(R[piv][col]) <= eps) continue;
    [R[row], R[piv]] = [R[piv], R[row]];
    const p = R[row][col];
    for (let c = col; c < n; c++) R[row][c] /= p;
    for (let r = 0; r < R.length; r++) {
      if (r === row) continue;
      const f = R[r][col];
      if (Math.abs(f) < 1e-300) continue;
      for (let c = col; c < n; c++) R[r][c] -= f * R[row][c];
    }
    pivots.push(col);
    row++;
  }
  const isPivot = new Set(pivots);
  const basis: number[][] = [];
  for (let f = 0; f < n; f++) {
    if (isPivot.has(f)) continue;
    const v = new Array(n).fill(0);
    v[f] = 1;
    pivots.forEach((pc, i) => { v[pc] = -R[i][f]; });
    basis.push(v);
  }
  return basis;
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Orthonormalise vectors (modified Gram–Schmidt), dropping ones already in the span. */
export function orthonormal(vectors: number[][], tol = 1e-9): number[][] {
  const out: number[][] = [];
  for (const v of vectors) {
    const w = [...v];
    for (const u of out) {
      const k = dot(w, u);
      for (let i = 0; i < w.length; i++) w[i] -= k * u[i];
    }
    const len = Math.sqrt(dot(w, w));
    if (len > tol) out.push(w.map((x) => x / len));
  }
  return out;
}

/** v minus its projection on the orthonormal basis U. */
export function reject(v: number[], U: number[][]): number[] {
  const w = [...v];
  for (const u of U) {
    const k = dot(w, u);
    for (let i = 0; i < w.length; i++) w[i] -= k * u[i];
  }
  return w;
}
