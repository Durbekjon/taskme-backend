import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { env } from '../config/env';

/** "+998901234567" -> "+99890•••4567" so logs don't hold full numbers. */
function mask(phone: string) {
  return phone.length > 7 ? `${phone.slice(0, 5)}•••${phone.slice(-4)}` : '•••';
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Sends a one-time code with Meta's Cloud API.
   *
   * Uses an "Authentication" category template: Meta requires OTPs to go out
   * through one, it carries the code in the body and in the copy-code button,
   * and it is the only category priced and delivered as authentication.
   */
  async sendOtp(phoneNumber: string, otp: string): Promise<void> {
    const to = phoneNumber.replace(/\D/g, '');

    if (!env.whatsappConfigured) {
      // Without credentials there is no way to deliver the code. That is
      // acceptable in development only; in production it would let anyone
      // "verify" a number they don't own.
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'WhatsApp OTP requested but META_WA_* credentials are not set',
        );
        throw new ServiceUnavailableException(
          'Phone verification is temporarily unavailable.',
        );
      }
      this.logger.warn(`[DEV WHATSAPP] To: ${mask(phoneNumber)} | OTP: ${otp}`);
      return;
    }

    const url = `https://graph.facebook.com/${env.whatsappApiVersion}/${env.whatsappPhoneNumberId}/messages`;
    const data = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: env.whatsappOtpTemplate,
        language: { code: env.whatsappOtpLanguage },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: otp }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: otp }],
          },
        ],
      },
    };

    try {
      const response = await lastValueFrom(
        this.httpService.post(url, data, {
          headers: {
            Authorization: `Bearer ${env.whatsappAccessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        }),
      );
      const id = (response.data as { messages?: { id: string }[] })
        ?.messages?.[0]?.id;
      this.logger.log(
        `WhatsApp OTP sent to ${mask(phoneNumber)} (message ${id ?? 'n/a'})`,
      );
    } catch (error: unknown) {
      const e = error as {
        response?: { data?: { error?: { code?: number; message?: string } } };
        message?: string;
      };
      const meta = e.response?.data?.error;
      this.logger.error(
        `WhatsApp OTP to ${mask(phoneNumber)} failed: ${meta?.code ?? ''} ${meta?.message ?? e.message}`,
      );
      // 131026: recipient can't receive (no WhatsApp / old app); tell the user.
      if (meta?.code === 131026) {
        throw new ServiceUnavailableException(
          'This number does not appear to use WhatsApp. Check the number and try again.',
        );
      }
      throw new ServiceUnavailableException(
        'Could not send the WhatsApp code right now, please try again.',
      );
    }
  }
}
