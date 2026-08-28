/**
 * Sanitiza textos para evitar errores de parseo en mensajes de Telegram con formato Markdown.
 * Reemplaza o elimina caracteres especiales reservadas (_, *, [, ], `, \) por espacios seguros.
 */
export function sanitizeMarkdown(text?: string | null): string {
  if (!text) return "";
  return text.replace(/[_*`\[\]\\]/g, " ").replace(/\s+/g, " ").trim();
}
