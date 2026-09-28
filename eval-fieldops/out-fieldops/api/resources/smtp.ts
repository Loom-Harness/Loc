import nodemailer from "nodemailer";

// mailer 'fieldMail' — SMTP transport (dev: Mailpit on :1025).
export const fieldMailFrom = process.env.FIELD_MAIL_FROM ?? "no-reply@fieldops.example";
export const fieldMailTransport = nodemailer.createTransport(process.env.FIELD_MAIL_URL ?? "smtp://fieldMail:1025");

export async function fieldMail$send(to: string, subject: string, body: string): Promise<void> {
  await fieldMailTransport.sendMail({ from: fieldMailFrom, to, subject, text: body });
}

