import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { env } from '../config/env';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly httpService: HttpService) {}

  async sendOtp(phoneNumber: string, otp: string, fullName: string = 'User'): Promise<boolean> {
    const accessToken = env.whatsappAccessToken;
    const phoneNumberId = env.whatsappPhoneNumberId;

    if (!accessToken || !phoneNumberId) {
      this.logger.warn('Meta WhatsApp API credentials missing. Logging OTP to console.');
      this.logger.log(`[MOCK WHATSAPP] To: ${phoneNumber} | OTP: ${otp}`);
      return true;
    }

    // Clean phone number (remove + and spaces)
    const to = phoneNumber.replace(/\D/g, '');

    const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
    const data = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: 'jaspers_market_order_confirmation_v1',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: fullName }, // Parameter 1 (Name)
              { type: 'text', text: otp }, // Parameter 2 (Order Number -> we use for OTP)
              { type: 'text', text: new Date().toLocaleDateString() }, // Parameter 3 (Date)
            ],
          },
        ],
      },
    };

    try {
      const response = await lastValueFrom(
        this.httpService.post(url, data, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );
      this.logger.log(`WhatsApp message sent to ${to}: ${JSON.stringify(response.data)}`);
      return true;
    } catch (error: any) {
      // Returning success here used to hide delivery failures: the user was
      // asked for a code that had never been sent.
      this.logger.error(
        `Failed to send WhatsApp message to ${to}`,
        error.response?.data || error.message,
      );
      throw new ServiceUnavailableException(
        'Could not send the WhatsApp code right now, please try again.',
      );
    }
  }
}
