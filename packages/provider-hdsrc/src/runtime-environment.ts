export function productionHdsrcProcessEnv(
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return {
    ...base,
    HDSRC_TEST_STUB_RUNTIME: undefined,
    PYTHONPATH: undefined,
  }
}
