// Coordinator: session time remap (new scene frame -> original scene frame).
// Narration plays at 1x; the transitions between lines run faster so the scene fits 14 bars.
export const SESSION_KNOTS: Array<[number, number]> = [[0, 0], [4.438, 12], [258.438, 266], [297.637, 372], [437.637, 512], [472.398, 606], [610.398, 744], [665.869, 894], [728.869, 957], [745.51, 1002], [846.51, 1103], [862.411, 1146], [1005.411, 1289], [1008.0, 1296]];

export const sessionSourceFrame = (f: number): number => {
  const k = SESSION_KNOTS;
  for (let i = 1; i < k.length; i++) {
    const [n0, o0] = k[i - 1];
    const [n1, o1] = k[i];
    if (f <= n1) return o0 + ((f - n0) * (o1 - o0)) / (n1 - n0);
  }
  return k[k.length - 1][1];
};
