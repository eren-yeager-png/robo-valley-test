// Holds the pool that the mocked "../src/lib/db" hands to the application during a test.
// Deliberately has NO imports: the vi.mock factory loads this module while ./helpers is still being loaded,
// so depending on ./helpers there would create a circular import (and hang).
let current: unknown;
export const getPool = (): any => current;
export const setPool = (p: unknown): void => { current = p; };
