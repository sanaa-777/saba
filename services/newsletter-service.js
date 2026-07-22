// Newsletter Email Service
// Handles sending newsletter campaigns via nodemailer

let nodemailer = null;

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  
  if (!host || !user || !pass) {
    console.warn('SMTP not configured — newsletter sending disabled');
    return null;
  }
  
  try {
    if (!nodemailer) nodemailer = require('nodemailer');
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 5000
    });
  } catch (err) {
    console.error('SMTP init error:', err.message);
    return null;
  }
}

/**
 * Send newsletter to all active subscribers
 * @param {Object} db - Database instance
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML email content
 * @returns {Promise<Object>} - { sent, failed, errors }
 */
async function sendCampaign(db, subject, htmlContent) {
  const transporter = getTransporter();
  if (!transporter) {
    return { sent: 0, failed: 0, errors: ['SMTP not configured'] };
  }
  
  const subscribers = db.prepare('SELECT * FROM newsletter_subscribers WHERE is_active = 1').all();
  if (subscribers.length === 0) {
    return { sent: 0, failed: 0, errors: ['No active subscribers'] };
  }
  
  const siteName = 'أوتر نيوز';
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
  
  let sent = 0;
  let failed = 0;
  const errors = [];
  
  // Send in batches of 10 to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < subscribers.length; i += batchSize) {
    const batch = subscribers.slice(i, i + batchSize);
    const promises = batch.map(async (sub) => {
      try {
        await transporter.sendMail({
          from: `"${siteName}" <${fromEmail}>`,
          to: sub.email,
          subject: subject,
          html: buildEmailHtml(subject, htmlContent, sub.name, siteName),
          text: htmlContent.replace(/<[^>]*>/g, '').substring(0, 500)
        });
        sent++;
      } catch (err) {
        failed++;
        errors.push(`${sub.email}: ${err.message}`);
      }
    });
    await Promise.all(promises);
    
    // Small delay between batches
    if (i + batchSize < subscribers.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  // Record campaign
  db.prepare(
    'INSERT INTO newsletter_campaigns (subject, content, sent_at, recipients_count, status) VALUES (?, ?, CURRENT_TIMESTAMP, ?, 1)'
  ).run(subject, htmlContent, sent);
  
  return { sent, failed, errors };
}

/**
 * Build professional HTML email template
 */
function buildEmailHtml(subject, content, subscriberName, siteName) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;">
    <div style="background:linear-gradient(135deg,#1a237e,#0d47a1);padding:24px 30px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">${siteName}</h1>
      <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:13px;">نشرة بريدية</p>
    </div>
    <div style="padding:30px;">
      <h2 style="color:#1a237e;font-size:20px;margin:0 0 16px;">${subject}</h2>
      ${subscriberName ? `<p style="color:#555;font-size:14px;margin:0 0 20px;">مرحباً ${subscriberName}،</p>` : ''}
      <div style="color:#333;font-size:15px;line-height:1.8;">${content}</div>
    </div>
    <div style="background:#f8f9fa;padding:20px 30px;text-align:center;border-top:1px solid #eee;">
      <p style="color:#888;font-size:12px;margin:0;">
        © ${new Date().getFullYear()} ${siteName}. جميع الحقوق محفوظة.
      </p>
    </div>
  </div>
</body></html>`;
}

/**
 * Check if SMTP is configured
 */
function isConfigured() {
  return !!getTransporter();
}

module.exports = {
  sendCampaign,
  isConfigured
};
