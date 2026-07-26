export async function loadSettledRecords<T>(
  ids: readonly string[],
  loader: (id: string) => Promise<T>
): Promise<{ records: Record<string, T>; failedIds: string[] }> {
  // Deduplicate at the boundary: with duplicate ids, one success plus one
  // failure would otherwise put the same id in `records` AND `failedIds`,
  // and two successes would silently overwrite each other. Consumers such as
  // src/pages/Performance.tsx render on the postcondition that records keys
  // and failedIds are disjoint.
  const uniqueIds = [...new Set(ids)];
  const settled = await Promise.allSettled(
    uniqueIds.map(async id => [id, await loader(id)] as const)
  );
  const entries: Array<readonly [string, T]> = [];
  const failedIds: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") entries.push(result.value);
    else failedIds.push(uniqueIds[index]);
  });
  return {
    records: Object.fromEntries(entries) as Record<string, T>,
    failedIds,
  };
}
