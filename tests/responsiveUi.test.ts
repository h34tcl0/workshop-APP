import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Responsive UI & Mobile Design Contract Tests", () => {
  const viewsDir = path.resolve(process.cwd(), "views");

  it("Test 1: Verifica existencia del meta viewport responsive en index.ejs", () => {
    const indexPath = path.join(viewsDir, "index.ejs");
    expect(fs.existsSync(indexPath)).toBe(true);

    const indexContent = fs.readFileSync(indexPath, "utf-8");
    expect(indexContent).toMatch(/<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width[^"']*["']/i);
    expect(indexContent).toMatch(/initial-scale=1\.0/i);
    expect(indexContent).toContain("overflow-x-hidden");
  });

  it("Test 2: Valida presencia de la barra de navegación móvil (bottom_nav.ejs con clase md:hidden)", () => {
    const bottomNavPath = path.join(viewsDir, "components", "bottom_nav.ejs");
    expect(fs.existsSync(bottomNavPath)).toBe(true);

    const navContent = fs.readFileSync(bottomNavPath, "utf-8");
    expect(navContent).toContain("md:hidden");
    expect(navContent).toContain("fixed bottom-0");
    expect(navContent).toContain("mobile-bottom-nav");
    expect(navContent).toContain("mobile-nav-add-task");
    expect(navContent).toContain("mobile-nav-backlog");

    // Verificar workshop bottom nav también
    const wsBottomNavPath = path.join(viewsDir, "components", "workshop", "_workshop_bottom_nav.ejs");
    if (fs.existsSync(wsBottomNavPath)) {
      const wsNavContent = fs.readFileSync(wsBottomNavPath, "utf-8");
      expect(wsNavContent).toContain("md:hidden");
      expect(wsNavContent).toContain("fixed bottom-0");
    }
  });

  it("Test 3: Valida que los modales críticos posean clases de contenedor responsive (inset-0, overflow-y-auto, w-full)", () => {
    const taskModalPath = path.join(viewsDir, "components", "task_modal.ejs");
    const taskContent = fs.readFileSync(taskModalPath, "utf-8");
    expect(taskContent).toContain("fixed inset-0");
    expect(taskContent).toContain("overflow-y-auto");
    expect(taskContent).toContain("w-full max-w-lg");

    const settingsModalPath = path.join(viewsDir, "components", "settings_modal.ejs");
    const settingsContent = fs.readFileSync(settingsModalPath, "utf-8");
    expect(settingsContent).toContain("fixed inset-0");
    expect(settingsContent).toContain("w-full");
    expect(settingsContent).toContain("sm:hidden"); // selector móvil
    expect(settingsContent).toContain("hidden sm:grid"); // tabs desktop

    const endShiftPath = path.join(viewsDir, "partials", "_end_shift_modals.ejs");
    const endShiftContent = fs.readFileSync(endShiftPath, "utf-8");
    expect(endShiftContent).toContain("fixed inset-0");
    expect(endShiftContent).toContain("w-full");
    expect(endShiftContent).toContain("overflow-y-auto");
  });

  it("Test 4: Valida que el panel horario y las tarjetas de agenda se adapten a móvil", () => {
    const agendaPath = path.join(viewsDir, "components", "agenda.ejs");
    const agendaContent = fs.readFileSync(agendaPath, "utf-8");
    expect(agendaContent).toContain("grid-cols-1 md:grid-cols-2 xl:grid-cols-3");
    expect(agendaContent).toContain("max-w-full");

    const rightRailPath = path.join(viewsDir, "components", "right_rail.ejs");
    const rightRailContent = fs.readFileSync(rightRailPath, "utf-8");
    // Tira horizontal en mobile, lista vertical en desktop
    expect(rightRailContent).toContain("flex md:hidden flex-row gap-2 overflow-x-auto");
    expect(rightRailContent).toContain("hidden md:block");

    const leftRailPath = path.join(viewsDir, "components", "left_rail.ejs");
    const leftRailContent = fs.readFileSync(leftRailPath, "utf-8");
    expect(leftRailContent).toContain("hidden md:flex");
  });

  it("Test 5: Valida que el visor 3D y el banner flotante de check-in incluyan clases responsive", () => {
    const viewer3dPath = path.join(viewsDir, "components", "workshop", "_tool_viewer_3d.ejs");
    const viewerContent = fs.readFileSync(viewer3dPath, "utf-8");
    expect(viewerContent).toContain("min-h-[380px] sm:min-h-[460px]");
    expect(viewerContent).toContain("touch-action: none");

    const bannerPath = path.join(viewsDir, "components", "agenda", "_checkin_floating_banner.ejs");
    const bannerContent = fs.readFileSync(bannerPath, "utf-8");
    expect(bannerContent).toContain("bottom-20 md:bottom-6");
    expect(bannerContent).toContain("left-1/2 -translate-x-1/2");
    expect(bannerContent).toContain("w-[92%]");
  });

  it("Test 6: Valida que el botón de término de jornada en _card_header dependa estrictamente de show_end_shift_prompt y el cliente limpie el DOM", () => {
    const cardHeaderPath = path.join(viewsDir, "components", "agenda", "_card_header.ejs");
    const cardHeaderContent = fs.readFileSync(cardHeaderPath, "utf-8");
    expect(cardHeaderContent).toContain("locals.show_end_shift_prompt");
    expect(cardHeaderContent).toContain("id=\"btn-end-shift-today\"");

    const clientScriptsPath = path.join(viewsDir, "partials", "_client_scripts.ejs");
    const clientScriptsContent = fs.readFileSync(clientScriptsPath, "utf-8");
    expect(clientScriptsContent).toContain("checkin-floating-banner");
    expect(clientScriptsContent).toContain("btn-end-shift-today");
    expect(clientScriptsContent).toContain("setTimeout(() => floatingBanner.remove()");
  });

  it("Test 7: Valida la taxonomía de badges en _card_header y right_rail (No Laborable vs Disponible vs Bloqueado vs Agendado)", () => {
    const cardHeaderPath = path.join(viewsDir, "components", "agenda", "_card_header.ejs");
    const cardHeaderContent = fs.readFileSync(cardHeaderPath, "utf-8");
    expect(cardHeaderContent).toContain("is_non_working");
    expect(cardHeaderContent).toContain("Agendado");
    expect(cardHeaderContent).toContain("No Laborable");
    expect(cardHeaderContent).toContain("Bloqueado");
    expect(cardHeaderContent).toContain("Disponible");
    expect(cardHeaderContent).toContain("Concluida");

    const rightRailPath = path.join(viewsDir, "components", "right_rail.ejs");
    const rightRailContent = fs.readFileSync(rightRailPath, "utf-8");
    expect(rightRailContent).toContain("is_non_working");
    expect(rightRailContent).toContain("Agendado");
    expect(rightRailContent).toContain("No Laborable");
    expect(rightRailContent).toContain("Bloqueado");
    expect(rightRailContent).toContain("Disponible");
  });
});
