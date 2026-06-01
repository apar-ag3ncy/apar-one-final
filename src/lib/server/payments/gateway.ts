import 'server-only';

/**
 * Payment-gateway abstraction. Phase 4.1.
 *
 * Concrete implementations live alongside this file:
 *   - manual.ts (Phase 4.3) — no-op for bank transfer / UPI / cheque / cash
 *     receipts entered by the accountant. No payment link, no webhook.
 *   - razorpay.ts (Phase 4.2) — NOT IMPLEMENTED in this build per user
 *     request ("phase 4 no razorpay required"). The interface is shaped
 *     so dropping in a Razorpay impl later requires only:
 *       1. `npm install razorpay`
 *       2. env vars RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET /
 *          RAZORPAY_WEBHOOK_SECRET (Zod-validated in lib/env.ts)
 *       3. `lib/server/payments/razorpay.ts` implementing PaymentGateway
 *       4. `lib/server/payments/select.ts` to pick the right impl by
 *          billing_settings.gateway_default
 *       5. `src/app/api/webhooks/razorpay/route.ts` calling
 *          gateway.verifyWebhookSignature + parseWebhookEvent then
 *          invoking the appropriate receipts.ts server action.
 *
 * Everything callers need to drive a payment lives behind this
 * interface; no Razorpay-specific shapes leak above this layer.
 */

export type PaymentGatewayKind = 'razorpay' | 'manual';

export type MintPaymentLinkInput = {
  invoiceId: string;
  invoiceNumber: string;
  /** Amount to collect, in paise. */
  amountPaise: bigint;
  customerEmail: string | null;
  customerPhone: string | null;
  /** Where the customer is redirected after pay (success / failure). */
  callbackUrl: string | null;
  /** Free-form metadata stored on the gateway side (Razorpay: notes). */
  metadata: Record<string, string>;
};

export type PaymentLink = {
  /** Gateway-issued link id (for later cancellation / lookup). Null for manual. */
  linkId: string | null;
  /** Full URL the customer follows to pay. Null for manual. */
  url: string | null;
  /** PNG bytes of a payment-link QR if the gateway returns one. Null for manual. */
  qrPngBytes: Uint8Array | null;
  /** ISO timestamp the link expires, if any. */
  expiresAt: string | null;
};

/**
 * Discriminated event shape the webhook handler dispatches on. The
 * Razorpay impl's `parseWebhookEvent` maps Razorpay's raw payload
 * into this shape; the manual impl never emits events.
 */
export type WebhookEvent =
  | {
      kind: 'payment.captured';
      /** Stable event id for idempotency (becomes receipts.razorpay_event_id). */
      eventId: string;
      /** Gateway-side payment id (becomes receipts.gateway_payment_id). */
      gatewayPaymentId: string;
      /** Mint-time link id; we look up the invoice via receipts.razorpay_payment_link_id. */
      paymentLinkId: string;
      amountPaise: bigint;
      /** Gateway fee deducted from the captured amount; posted to 6600 Bank Charges. */
      feePaise: bigint;
      /** ISO timestamp the gateway captured the payment. */
      capturedAt: string;
    }
  | {
      kind: 'payment.failed';
      eventId: string;
      gatewayPaymentId: string | null;
      paymentLinkId: string;
      reason: string;
    }
  | {
      kind: 'payment.link.expired';
      eventId: string;
      paymentLinkId: string;
    };

/**
 * Common interface every gateway implementation honours. Designed to be
 * straightforward to mock in unit tests.
 */
export interface PaymentGateway {
  /** Stable identifier — 'razorpay' | 'manual'. */
  readonly kind: PaymentGatewayKind;

  /**
   * Mint a payment link for the invoice. The Manual impl returns a
   * null-filled `PaymentLink`. Throws if the gateway is misconfigured
   * or refuses to mint (e.g. invalid amount).
   */
  mintPaymentLink(input: MintPaymentLinkInput): Promise<PaymentLink>;

  /**
   * True iff `signature` matches the HMAC of `rawPayload` under the
   * shared webhook secret. Manual impl returns false unconditionally
   * (no webhooks expected).
   */
  verifyWebhookSignature(rawPayload: string, signature: string): Promise<boolean>;

  /**
   * Parse a verified webhook payload into a discriminated `WebhookEvent`.
   * Returns null if the event kind isn't one we care about.
   */
  parseWebhookEvent(rawPayload: string): Promise<WebhookEvent | null>;
}
