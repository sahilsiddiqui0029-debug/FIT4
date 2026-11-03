/**
 * Lightweight Zero-Token Support Response Classifier
 * Matches incoming customer support queries to predefined high-quality templates.
 */

const TEMPLATES = {
  DOWNLOAD_APK: {
    match: ['download', 'apk', 'android', 'install', 'app link', 'where to get'],
    subject: 'Direct Android APK Download Link — FIT4 Support',
    html: `<div style="font-family: sans-serif; background: #030712; color: #fff; padding: 28px; border-radius: 14px;"><h3 style="color: #a3e635;">FIT4 Mobile App Download</h3><p style="color: #9ca3ai;">You can download the refined FIT4 Android application directly using the public link below:</p><a href="https://xulciccsrbaqcdxxuumm.supabase.co/storage/v1/object/public/apks/fit4-app.apk" style="background: #a3e635; color: #030712; padding: 12px 24px; border-radius: 999px; font-weight: bold; text-decoration: none; display: inline-block;">Download FIT4 Android APK</a></div>`
  },
  ACCOUNT_DELETION: {
    match: ['delete account', 'remove data', 'privacy', 'dpdp', 'delete my data'],
    subject: 'Account & Data Deletion Request — FIT4 Support',
    html: `<div style="font-family: sans-serif; background: #030712; color: #fff; padding: 28px; border-radius: 14px;"><h3 style="color: #38bdf8;">Data Privacy & Account Deletion</h3><p style="color: #9ca3af;">In accordance with DPDP regulations, you can submit an automated deletion request anytime at our portal:</p><a href="https://fit4.in/delete" style="background: #38bdf8; color: #030712; padding: 12px 24px; border-radius: 999px; font-weight: bold; text-decoration: none; display: inline-block;">Account Deletion Portal</a></div>`
  },
  DEFAULT_RECEIPT: {
    match: [],
    subject: 'Support Ticket Acknowledgment — FIT4 Support',
    html: `<div style="font-family: sans-serif; background: #030712; color: #fff; padding: 28px; border-radius: 14px;"><h3 style="color: #a3e635;">Support Inquiry Received</h3><p style="color: #9ca3ai;">Thank you for reaching out to FIT4 Support. Our automated system has logged your inquiry and our team will review it shortly.</p></div>`
  }
};

function classifyAndRespond(messageText) {
  const query = (messageText || '').toLowerCase();
  for (const key of ['DOWNLOAD_APK', 'ACCOUNT_DELETION']) {
    const template = TEMPLATES[key];
    if (template.match.some(keyword => query.includes(keyword))) {
      return template;
    }
  }
  return TEMPLATES.DEFAULT_RECEIPT;
}

module.exports = { classifyAndRespond, TEMPLATES };
