import type { Instrumentation } from "next";

// Next calls these hooks (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// The real work is in instrumentation-node.ts, which is only loaded on the Node.js runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await (await import("./instrumentation-node")).registerNode();
}

/** Called by Next for every error it catches while handling a request (pages, routes, server actions). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") await (await import("./instrumentation-node")).reportRequestError(err, request, context);
};
