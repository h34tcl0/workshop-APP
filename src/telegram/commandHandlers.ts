import { store } from "../db.js";
import { sendRequest } from "./apiClient.js";

type SendRequestFn = (method: string, payload: any) => Promise<boolean>;

export async function handleIncomingMessage(
  msg: any,
  token: string,
  sendRequestFn?: SendRequestFn
): Promise<{ status: string; message: string }> {
  const rawChatId = msg.chat?.id || msg.from?.id;
  if (!rawChatId) {
    return { status: "error", message: "No chat ID in message" };
  }

  const chatStr = String(rawChatId).trim();
  const text: string = (msg.text || "").trim();
  const cleanText = text.toLowerCase().trim();
  const user = store.getUserByTelegramChatId(chatStr);
  const req: SendRequestFn = sendRequestFn || ((method, payload) => sendRequest(token, chatStr, method, payload));

  // Permitir /start y /help ANTES de verificar usuario para mostrar Chat ID si no está vinculado
  if (cleanText.startsWith("/start") || cleanText.startsWith("/help")) {
    let startMsg = `👋 *¡Hola!*\nTu Chat ID de Telegram es: \`${chatStr}\`\n\n`;
    if (user) {
      startMsg += `✅ Tu cuenta está correctamente vinculada a AGENDAPP con el correo *${user.email}*.\n\n*Comandos disponibles:*\n• \`/materiales\` - Ver insumos pendientes por comprar (🔴)`;
    } else {
      startMsg += `⚠️ *Aviso:* Este Chat ID no está vinculado a ninguna cuenta en AGENDAPP.\nAsegúrate de copiar el número \`${chatStr}\` y registrarlo en la Configuración de AGENDAPP.`;
    }

    await req("sendMessage", { chat_id: chatStr, text: startMsg, parse_mode: "Markdown" });
    return { status: "ok", message: "Responded to /start" };
  }

  // /vincular <código> tiene que poder ejecutarse ANTES de la verificación de usuario
  if (cleanText.startsWith("/vincular") || cleanText.startsWith("vincular")) {
    const parts = text.trim().split(/\s+/);
    const code = parts.length > 1 ? parts[1] : "";

    if (!code) {
      await req("sendMessage", {
        chat_id: chatStr,
        text: `⚠️ Escribí el código junto al comando, por ejemplo:\n\`/vincular 123456\`\n\nGenerá tu código desde Ajustes en la app web.`,
        parse_mode: "Markdown"
      });
      return { status: "ok", message: "Missing code for /vincular" };
    }

    const result = store.consumeTelegramLinkCode(code, chatStr);
    if (result.success) {
      await req("sendMessage", {
        chat_id: chatStr,
        text: `✅ *¡Vinculación exitosa!*\nEste chat quedó conectado a AGENDAPP con el correo *${result.email}*.\n\n*Comandos disponibles:*\n• \`/materiales\` - Ver insumos pendientes por comprar (🔴)`,
        parse_mode: "Markdown"
      });
    } else {
      await req("sendMessage", {
        chat_id: chatStr,
        text: `⚠️ ${result.error || "Código inválido o expirado. Generá uno nuevo desde la app."}`,
        parse_mode: "Markdown"
      });
    }
    return { status: result.success ? "ok" : "invalid_code", message: result.success ? "Telegram linked" : "Invalid or expired code" };
  }

  if (!user) {
    await req("sendMessage", {
      chat_id: chatStr,
      text: `⚠️ Este chat de Telegram no está vinculado a ninguna cuenta en AGENDAPP.\n\nTu Chat ID es: \`${chatStr}\`.\nPara vincularlo: generá un código desde *Ajustes* en la app web, y mandalo acá como \`/vincular 123456\`.`,
      parse_mode: "Markdown"
    });
    return {
      status: "unauthorized",
      message: "⚠️ Este chat de Telegram no está vinculado a ninguna cuenta en AGENDAPP."
    };
  }

  if (user.status !== 'active') {
    await req("sendMessage", {
      chat_id: chatStr,
      text: `⚠️ Tu cuenta se encuentra suspendida o inactiva. Contacta al administrador de AGENDAPP.`
    });
    return {
      status: "forbidden",
      message: "User account is inactive or blocked"
    };
  }

  if (cleanText === "/materiales" || cleanText === "materiales" || cleanText.startsWith("/materiales")) {
    const pendingByProject = store.getPendingMaterialsGroupedByProject(user.id);
    const pendingTools = store.getPendingTools(user.id);

    if (pendingByProject.length === 0 && pendingTools.length === 0) {
      await req("sendMessage", {
        chat_id: chatStr,
        text: `📦 *COMPRAS PENDIENTES* (🔴)\n\n✅ ¡Excelente! No tienes insumos ni herramientas pendientes por comprar.`,
        parse_mode: "Markdown"
      });
    } else {
      let msgText = `📦 *RESUMEN DE COMPRAS PENDIENTES* (🔴)\n\n`;
      let totalItems = 0;
      if (pendingByProject.length > 0) {
        msgText += `*Insumos / Materiales:*\n`;
        for (const projGroup of pendingByProject) {
          msgText += `📁 *Proyecto: ${projGroup.project_name}*\n`;
          for (const m of projGroup.materials) {
            const icon = m.status === "out_of_stock" ? "⚠️" : "🔴";
            msgText += `  • ${icon} *${m.quantity} ${m.unit}* - ${m.name} _[${m.category}]_\n`;
            totalItems++;
          }
          msgText += `\n`;
        }
      }
      if (pendingTools.length > 0) {
        msgText += `🛠️ *Herramientas Por Comprar:*\n`;
        for (const t of pendingTools) {
          msgText += `  • 🔴 *${t.name}* _[${t.category}]_${t.notes ? ` - ${t.notes}` : ""}\n`;
          totalItems++;
        }
        msgText += `\n`;
      }
      msgText += `📌 *Total:* ${totalItems} ítems pendientes por comprar.`;
      await req("sendMessage", {
        chat_id: chatStr,
        text: msgText,
        parse_mode: "Markdown"
      });
    }
  } else {
    await req("sendMessage", {
      chat_id: chatStr,
      text: `🤖 *AGENDAPP (Workshop OS)* (${user.email})\nRecibido: "${text}".\nUsa \`/materiales\` para consultar insumos pendientes o responde a las alertas de taller.`,
      parse_mode: "Markdown"
    });
  }

  return { status: "ok", message: "Message processed" };
}
