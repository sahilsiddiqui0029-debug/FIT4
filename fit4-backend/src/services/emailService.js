const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.larksuite.com',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: true,
  auth: {
    user: process.env.SMTP_USER || 'agent@fit4.in',
    pass: process.env.SMTP_PASS,
  },
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendWelcomeNotification(toEmail, userName) {
  const safeName = escapeHtml(userName || 'Health Pioneer');
  const maskedEmail = String(toEmail || '').replace(/^(..).*(@.*)$/, '$1***$2');
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || '"FIT4 Automated Agent" <agent@fit4.in>',
      to: toEmail,
      subject: 'Welcome to FIT4 — Metabolic & Food Chemical Intelligence',
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #030712; color: #f9fafb; padding: 32px; border-radius: 16px;">
          <div style="color: #a3e635; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.15em; margin-bottom: 12px;">FIT4 AUTOMATED SYSTEM</div>
          <h2 style="font-size: 24px; font-weight: 800; margin-bottom: 16px;">Welcome aboard, ${safeName}!</h2>
          <p style="color: #9ca3ai; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">Your FIT4 account is now active. You have full access to our on-device visual food chemical scanner, metabolic spike predictions, and ingredient triage reports.</p>
          <a href="https://fit4.in/scan" style="background-color: #a3e635; color: #030712; padding: 14px 28px; border-radius: 999px; font-weight: bold; text-decoration: none; display: inline-block; font-size: 13px; text-transform: uppercase;">Run Instant Web Audit</a>
          <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 32px 0;" />
          <p style="color: #6b7220; font-size: 12px;">FIT4 Health Technologies · agent@fit4.in</p>
        </div>
      `,
    });
    console.log(`[EmailService] Welcome email sent to ${maskedEmail}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[EmailService] Failed to send welcome email to ${maskedEmail}:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  transporter,
  sendWelcomeNotification,
};
