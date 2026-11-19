/** Solve A·x = b with Gaussian elimination and partial pivoting. A is modified in place. */
export function solve(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  const x = new Float64Array(n);
  const rhs = Float64Array.from(b);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r][col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-12) continue; // singular column: leave coefficient at 0
    if (piv !== col) {
      [A[col], A[piv]] = [A[piv], A[col]];
      [rhs[col], rhs[piv]] = [rhs[piv], rhs[col]];
    }
    const diag = A[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / diag;
      if (f === 0) continue;
      const rowR = A[r];
      const rowC = A[col];
      for (let c = col; c < n; c++) rowR[c] -= f * rowC[c];
      rhs[r] -= f * rhs[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = rhs[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = Math.abs(A[r][r]) < 1e-12 ? 0 : s / A[r][r];
  }
  return x;
}
