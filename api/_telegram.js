/**
 * ==========================================================================
 * SECURE TELEGRAM NOTIFICATION DISPATCHER (api/_telegram.js)
 * ==========================================================================
 * Optional notification channel only.
 * Credentials stored securely in environment variables (never in frontend).
 * Any Telegram failure is non-fatal and will NEVER fail a valid database transaction.
 */

export async function sendTelegramNotification(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    return { skipped: true, reason: 'Telegram credentials not configured in environment.' };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || data.ok !== true) {
      const errMsg = data?.description || `HTTP ${res.status} ${res.statusText}`;
      console.warn('[Telegram] Notification send failed:', errMsg);
      return { success: false, error: errMsg };
    }

    return { success: true, data };
  } catch (err) {
    console.warn('[Telegram] Notification failed (non-fatal):', err.message || err);
    return { success: false, error: err.message };
  }
}
