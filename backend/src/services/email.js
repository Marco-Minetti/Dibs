import { config } from '../config.js';

export async function sendLoginCode(email, code) {
  // Development: just print it so you can log in without an email provider.
  if (!config.isProd || !config.resendApiKey) {
    console.log(`\n  ✶ [dibs] login code for ${email}: ${code}\n`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: email,
      subject: `Your dibs code: ${code}`,
      text:
        `Welcome to dibs ✶\n\n` +
        `Your verification code is ${code}\n` +
        `It expires in ${config.codeTtlMinutes} minutes.\n\n` +
        `If you didn't request this, you can ignore this email.`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`email_send_failed: ${res.status} ${body}`);
  }
}
