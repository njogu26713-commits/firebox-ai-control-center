import { describe, expect, it } from "vitest";
import { createQrWaiter } from "./qrWaiter";

describe("QR waiter", () => {
  it("delivers a QR event that arrives after a reconnect delay", async () => {
    const waiter = createQrWaiter(250);
    setTimeout(() => waiter.resolve("live-baileys-qr"), 10);
    await expect(waiter.promise).resolves.toBe("live-baileys-qr");
  });

  it("does not settle after cancellation", async () => {
    const waiter = createQrWaiter(20);
    waiter.cancel();
    waiter.resolve("stale-qr");
    const result = await Promise.race([waiter.promise, new Promise(resolve => setTimeout(() => resolve("still-pending"), 30))]);
    expect(result).toBe("still-pending");
  });
});
