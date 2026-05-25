/**
 * test-email.js
 *
 * Sends a quick test email to verify your Gmail credentials are working.
 * Run via GitHub Actions: Actions → Earnings Alert → Run workflow → test_email: true
 *
 * Does NOT require ANTHROPIC_API_KEY — only Gmail secrets needed.
 */

import nodemailer from "nodemailer";

const gmailUser    = process.env.GMAIL_USER;
const appPassword  = process.env.GMAIL_APP_PASSWORD;
const toEmail      = process.env.TO_EMAIL || gmailUser;

if (!gmailUser || !appPassword) {
  console.error("❌ GMAIL_USER or GMAIL_APP_PASSWORD is not set.");
  console.error("   Go to: Settings → Secrets → Actions and verify both secrets exist.");
  process.exit(1);
}

console.log(`📧 Sending test email...`);
console.log(`   From : ${gmailUser}`);
console.log(`   To   : ${toEmail}`);
console.log(`   Pass : ${"*".repeat(appPassword.length)} (${appPassword.length} chars — should be 16)`);

if (appPassword.length !== 16) {
  console.warn(`⚠️  App Password is ${appPassword.length} characters — expected 16.`);
  console.warn(`   Gmail App Passwords are exactly 16 chars with no spaces.`);
  console.warn(`   Re-generate it at: myaccount.google.com → Security → App passwords`);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: gmailUser, pass: appPassword },
});

try {
  const info = await transporter.sendMail({
    from: `"Earnings Summarizer" <${gmailUser}>`,
    to: toEmail,
    subject: "✅ Earnings Summarizer — Email test successful",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:32px auto;padding:24px;
                  border:1px solid #e2e8f0;border-radius:8px">
        <h2 style="color:#16a34a;margin:0 0 12px">✅ Email delivery is working!</h2>
        <p style="color:#334155;margin:0 0 16px">
          Your Gmail credentials are correctly configured in GitHub Secrets.
          The earnings summarizer will send summaries to this address.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
        <p style="color:#94a3b8;font-size:12px;margin:0">
          Earnings Summarizer · Powered by Claude AI
        </p>
      </div>`,
    text: "Email delivery is working! Your Gmail credentials are correctly configured.",
  });

  console.log(`\n✅ Test email sent successfully!`);
  console.log(`   Message ID : ${info.messageId}`);
  console.log(`   Delivered  : ${toEmail}`);
  console.log(`\n   Check your inbox (and spam folder just in case).`);
} catch (err) {
  console.error(`\n❌ Email failed: ${err.message}`);

  if (err.message.includes("Invalid login") || err.message.includes("Username and Password")) {
    console.error(`\n   Fix: Your App Password is wrong or 2-Step Verification is not enabled.`);
    console.error(`   1. Go to myaccount.google.com → Security`);
    console.error(`   2. Make sure 2-Step Verification is ON`);
    console.error(`   3. Search for "App passwords" → create a new one`);
    console.error(`   4. Copy the 16-char code with NO spaces into the GMAIL_APP_PASSWORD secret`);
  } else if (err.message.includes("ECONNREFUSED") || err.message.includes("ETIMEDOUT")) {
    console.error(`\n   Fix: Network error. Gmail SMTP (port 465/587) may be blocked.`);
  }

  process.exit(1);
}
