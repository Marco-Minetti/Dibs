import nodemailer from 'nodemailer';
import { config } from '../config.js';

export async function sendLoginCode(email, code) {
  // Development: just print it so you can log in without an email provider.
  if (!config.isProd || !config.gmailUser || !config.gmailAppPassword) {
    console.log(`\n  ✶ [dibs] login code for ${email}: ${code}\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.gmailUser,
      pass: config.gmailAppPassword,
    },
  });

  await transporter.sendMail({
    from: `dibs ✶ <${config.gmailUser}>`,
    to: email,
    subject: `Your dibs code: ${code}`,
    text:
      `Welcome to dibs ✶\n\n` +
      `Your verification code is ${code}\n` +
      `It expires in ${config.codeTtlMinutes} minutes.\n\n` +
      `If you didn't request this, you can ignore this email.`,
  });
}