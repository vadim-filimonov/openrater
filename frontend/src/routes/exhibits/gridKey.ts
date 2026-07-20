/** Parse a 2-D cell key — accepts "a::b" and "dimA=a|dimB=b". Shared by
 *  the grid tile, the values table, and the CSV export. */
export function parseGridKey(key: string): readonly [string, string] | null {
  const split = key.includes("::")
    ? key.split("::")
    : key.includes("|")
      ? key.split("|").map((p) => p.split("=").pop() ?? "")
      : null;
  if (split === null || split.length !== 2) return null;
  const [a, b] = split;
  if (a === undefined || b === undefined || a === "" || b === "") return null;
  return [a, b];
}
