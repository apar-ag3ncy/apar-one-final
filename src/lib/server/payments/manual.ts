import 'server-only';

import type { MintPaymentLinkInput, PaymentGateway, PaymentLink } from './gateway';

/**
 * No-op gateway for bank transfer / UPI / cheque / cash receipts.
 *
 * The accountant records these manually via `recordManualReceipt`
 * (Phase 4.5); there's no online payment link or webhook involved.
 * `mintPaymentLink` returns null-filled fields so callers don't
 * special-case "no gateway" everywhere.
 */
class ManualPaymentGatewayImpl implements PaymentGateway {
  readonly kind = 'manual' as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async mintPaymentLink(_input: MintPaymentLinkInput): Promise<PaymentLink> {
    return { linkId: null, url: null, qrPngBytes: null, expiresAt: null };
  }

  async verifyWebhookSignature(): Promise<boolean> {
    return false;
  }

  async parseWebhookEvent(): Promise<null> {
    return null;
  }
}

export const manualPaymentGateway: PaymentGateway = new ManualPaymentGatewayImpl();
