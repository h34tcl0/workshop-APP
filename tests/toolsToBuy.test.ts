import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { store, initDatabase } from "../src/db.js";
import { signToken } from "../src/auth.js";
import { app } from "../server.js";
import { ToolStatus } from "../src/types.js";
import { TelegramBotService } from "../src/telegramBot.js";

describe("Tools 'Por Comprar' (To Buy) Status & Reports", () => {
  beforeEach(async () => {
    await initDatabase();
  });

  const getOrCreateUser = (baseEmail: string) => {
    const uniqueEmail = `${baseEmail.split('@')[0]}_${Date.now()}_${Math.floor(Math.random() * 1000)}@workshop.os`;
    return store.createUser(uniqueEmail, "Password123!");
  };

  it("permite registrar y actualizar una herramienta con estado 'to_buy'", async () => {
    const user = getOrCreateUser("tool_tobuy@workshop.os");

    const tool = store.addTool(user.id, {
      name: "Sierra de Cadena Makita",
      category: "Herramientas Eléctricas",
      status: ToolStatus.TO_BUY,
      notes: "Inalámbrica 18V x2"
    });

    expect(tool.status).toBe("to_buy");

    const pendingTools = store.getPendingTools(user.id);
    expect(pendingTools.length).toBe(1);
    expect(pendingTools[0].name).toBe("Sierra de Cadena Makita");

    // Cambiar estado a disponible
    store.setToolStatus(user.id, tool.id, ToolStatus.AVAILABLE);
    expect(store.getPendingTools(user.id).length).toBe(0);

    // Cambiar de vuelta a to_buy mediante updateTool
    store.updateTool(user.id, tool.id, { status: ToolStatus.TO_BUY });
    expect(store.getPendingTools(user.id).length).toBe(1);
  });

  it("incluye herramientas 'Por Comprar' en la exportación de contexto para IA (/api/inventory/export-context)", async () => {
    const user = getOrCreateUser("export_tool_tobuy@workshop.os");
    const token = signToken({ userId: user.id, email: user.email });

    store.addTool(user.id, {
      name: "Formón de Esquina 25mm",
      category: "Herramientas Manuales",
      status: ToolStatus.TO_BUY,
      notes: "Requerido para ensambles"
    });

    const res = await request(app)
      .get("/api/inventory/export-context")
      .set("Origin", "http://127.0.0.1")
      .set("Cookie", `workshop_session=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.text).toContain("Formón de Esquina 25mm");
    expect(res.body.text).toContain("[HERRAMIENTA POR COMPRAR]");
    expect(res.body.summary.to_buy).toBeGreaterThanOrEqual(1);
  });

  it("incluye herramientas 'Por Comprar' en la respuesta del bot de Telegram (/materiales)", async () => {
    const user = getOrCreateUser("telegram_tool_tobuy@workshop.os");
    
    // Crear un chat ID simulado de telegram
    const chatId = "987654321";
    store.updateAppSettings(user.id, { telegram_chat_id: chatId });

    store.addTool(user.id, {
      name: "Prensa F 120cm Heavy Duty",
      category: "Prensas y Sujeción",
      status: ToolStatus.TO_BUY,
      notes: "Para encolado de tableros"
    });

    const telegramBot = new TelegramBotService();
    
    // Espiar sendRequest de TelegramBotService para capturar el mensaje enviado
    let sentMessageText = "";
    vi.spyOn(TelegramBotService.prototype, "sendRequest").mockImplementation(async (method: string, params: any) => {
      if (method === "sendMessage") {
        sentMessageText = params.text;
      }
      return true as any;
    });

    const result = await telegramBot.handleIncomingMessage({
      message_id: 1,
      from: { id: 987654321, first_name: "Test" },
      chat: { id: 987654321, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text: "/materiales"
    });

    expect(result.status).toBe("ok");
    expect(sentMessageText).toContain("Prensa F 120cm Heavy Duty");
    expect(sentMessageText).toContain("Herramientas Por Comprar");
  });
});
