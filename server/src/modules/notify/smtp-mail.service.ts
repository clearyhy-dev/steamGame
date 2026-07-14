import nodemailer from 'nodemailer';
import type { Env } from '../../config/env';
import { logger } from '../../utils/logger';

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export class SmtpMailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private env: Env) {}

  isConfigured(): boolean {
    return !!(this.env.smtpHost && this.env.smtpUser && this.env.smtpPass && this.env.mailFrom);
  }

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;
    if (!this.isConfigured()) {
      throw new Error('SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM)');
    }
    this.transporter = nodemailer.createTransport({
      host: this.env.smtpHost,
      port: this.env.smtpPort,
      secure: this.env.smtpPort === 465,
      auth: {
        user: this.env.smtpUser,
        pass: this.env.smtpPass,
      },
    });
    return this.transporter;
  }

  async send(message: MailMessage): Promise<void> {
    const to = String(message.to ?? '').trim();
    if (!to) throw new Error('Missing email recipient');
    const transport = this.getTransporter();
    const fromName = this.env.mailFromName?.trim() || 'Steam Game Deals';
    const from = `"${fromName}" <${this.env.mailFrom}>`;
    await transport.sendMail({
      from,
      to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    logger.info(`[smtp] sent to=${to} subject=${message.subject}`);
  }
}
