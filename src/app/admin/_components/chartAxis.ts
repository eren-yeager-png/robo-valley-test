// The x-axis settings of the admin charts, in one place, so every chart over days (line or bar) looks the same.

export const AXIS_TICK = { fontSize: 12, fill: "currentColor" } as const;

/** "2026-11-05" -> "11-05": the short label under the axis. The tooltip shows the full date. */
export const shortDay = (day: unknown): string => String(day).slice(5);

/**
 * The x-axis of a chart over days. Recharts drops the labels in between by itself: it keeps the first and the last one and only those
 * others that leave at least `minTickGap` pixels, whatever the number of days (7, 30, 90) and however narrow the card is. Never give
 * a chart over days `interval={0}`: that prints every label, and they run into each other.
 */
export const DAY_AXIS = { tick: AXIS_TICK, tickFormatter: shortDay, interval: "preserveStartEnd", minTickGap: 24 } as const;

/** The x-axis of a chart over names (categories, roles): every name is printed, at an angle. */
export const NAME_AXIS = { tick: AXIS_TICK, interval: 0, angle: -30, textAnchor: "end" } as const;

/** The widest a bar may get, so a few bars do not turn into blocks; with many days a bar simply fills its day. */
export const MAX_BAR = 28;
