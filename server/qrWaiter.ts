export function createQrWaiter(timeoutMs = 45000) {
  let settled = false;
  let resolvePromise!: (payload: string) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectPromise(new Error("Timed out waiting for a live WhatsApp QR code after reconnect attempts"));
    }
  }, timeoutMs);
  return {
    promise,
    resolve(payload: string) { if (!settled) { settled = true; clearTimeout(timeout); resolvePromise(payload); } },
    cancel() { if (!settled) { settled = true; clearTimeout(timeout); } },
  };
}
