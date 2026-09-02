import { store } from '../db.js';
import { verifyPassword } from '../auth.js';
import { sendTelegramMessage } from '../telegram/apiClient.js';

export class StepUpAuthError extends Error {
  public code = 'STEP_UP_AUTH_REQUIRED';
  constructor(message: string = 'Autenticación Step-up requerida para esta operación sensible.') {
    super(message);
    this.name = 'StepUpAuthError';
  }
}

/**
 * Verifies admin's current password for sensitive operations (promote, demote, soft-delete).
 */
export function verifyStepUpPassword(adminId: number, sudoPassword?: string): boolean {
  if (!sudoPassword || typeof sudoPassword !== 'string' || sudoPassword.trim() === '') {
    return false;
  }

  const adminUser = store.getUserById(adminId);
  if (!adminUser || !adminUser.password_hash) {
    return false;
  }

  return verifyPassword(sudoPassword.trim(), adminUser.password_hash);
}

/**
 * Dispatches an asynchronous Telegram alert to configured admin(s) when high-impact actions occur.
 */
export async function sendAdminSecurityAlert(
  action: string,
  adminEmail: string,
  targetEmail: string,
  ipAddress: string,
  details?: string
): Promise<void> {
  const timestamp = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });
  const message = [
    `🚨 *ALERTA DE SEGURIDAD ADMIN - AGENDAPP*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚡ *Acción:* \`${action}\``,
    `👤 *Administrador:* \`${adminEmail}\``,
    `🎯 *Objetivo:* \`${targetEmail}\``,
    `🌐 *IP Origen:* \`${ipAddress}\``,
    `📅 *Fecha/Hora:* \`${timestamp}\``,
    details ? `📝 *Detalles:* _${details}_` : ''
  ].filter(Boolean).join('\n');

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token) return;

    const activeAdmins = store.getActiveUsers().filter(u => u.role === 'admin');
    for (const admin of activeAdmins) {
      const settings = store.getAppSettings(admin.id);
      if (settings?.telegram_chat_id) {
        await sendTelegramMessage(token, settings.telegram_chat_id, settings.telegram_chat_id, message, {
          parse_mode: 'Markdown'
        });
      }
    }
  } catch (err) {
    console.error('[ADMIN SECURITY] Error dispatching Telegram security alert:', err);
  }
}

