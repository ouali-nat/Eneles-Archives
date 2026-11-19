import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly stripeService: StripeService,
  ) {}

  /** Whether paid plans can be bought right now, for the Billing page and the pricing page. Public: it says nothing about anyone. */
  @Public()
  @Get('status')
  status() {
    return { plansActive: this.billingService.plansActive };
  }

  @Get('subscription')
  async getSubscription(@CurrentUser() userId: number) {
    return this.billingService.getSubscription(userId);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('checkout')
  async createCheckoutSession(
    @CurrentUser() userId: number,
    @Body() body: { priceId?: string; plan?: string; interval?: string },
  ) {
    return this.billingService.createCheckoutSession(userId, body);
  }

  @Post('portal')
  async createPortalSession(@CurrentUser() userId: number) {
    return this.billingService.createPortalSession(userId);
  }

  @Get('payment-methods')
  async getPaymentMethods(@CurrentUser() userId: number) {
    return this.billingService.getPaymentMethods(userId);
  }

  @Get('invoices')
  async getInvoices(@CurrentUser() userId: number) {
    return this.billingService.getInvoices(userId);
  }

  @Get('payment-history')
  async getPaymentHistory(@CurrentUser() userId: number) {
    return this.billingService.getPaymentHistory(userId);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('cancel')
  async cancelSubscription(
    @CurrentUser() userId: number,
    @Body() body: { immediate?: boolean },
  ) {
    return this.billingService.cancelSubscription(userId, body.immediate);
  }

  @Post('reactivate')
  async reactivateSubscription(@CurrentUser() userId: number) {
    return this.billingService.reactivateSubscription(userId);
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (this.stripeService.isStubbed) {
      // Nothing can sign a webhook without a secret, and Stripe has no reason
      // to call a stubbed instance. Acknowledge and drop.
      return { received: true, stubbed: true };
    }

    const event = this.stripeService.constructWebhookEvent(
      req.rawBody as Buffer,
      signature,
    );

    await this.billingService.handleWebhook(event);

    return { received: true };
  }
}
