// The public-API limiter counts in fixed one-minute windows that line up with the wall clock (lib/apiRateLimit.ts: floor(epoch / 60)).
// A test that sends up to the limit in a row and then expects a 429 is only meaningful if all of those requests land in ONE window. If
// a minute boundary falls in the middle of the run (it does, about once in every few dozen runs on a busy machine), the count restarts,
// the "61st" request is really the 14th of a new window, and the test fails with 200 instead of 429.
//
// windowRoom() makes that impossible: when fewer than `minSeconds` remain in the current window it waits for the next one to begin,
// so a run that needs a few seconds always starts with room to spare. It changes no assertion and no production code, and costs
// nothing in most runs (it only waits when started in the last `minSeconds` of a minute, and then at most that long, once).
// Call it from beforeEach, before any fake timers are installed (it uses the real clock).
export async function windowRoom(minSeconds = 15): Promise<void> {
  const left = 60 - ((Date.now() / 1000) % 60);
  if (left < minSeconds) await new Promise<void>((resolve) => setTimeout(resolve, Math.ceil((left + 0.25) * 1000)));
}
