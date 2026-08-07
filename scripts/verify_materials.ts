import { store, initDatabase } from "../src/db.js";
import { signToken } from "../src/auth.js";
import request from "supertest";
import { app } from "../server.js";

async function main() {
  await initDatabase();
  const email = `test_mats_${Date.now()}@workshop.os`;
  const user = store.createUser(email, 'SecurePass123!');
  const token = signToken({ userId: user.id, email: user.email });

  const materials = [
    { name: "Listón Roble 2x4 x 3.2m", quantity: 8, unit: "piezas", category: "Madera", status: "to_buy" },
    { name: "Cola Fría Titebond III 500ml", quantity: 2, unit: "litros", category: "Adhesivos/Barniz", status: "in_stock" },
    { name: "Tornillos Drywall 1 5/8 (Caja 500u)", quantity: 1, unit: "cajas", category: "Tornillería", status: "to_buy" }
  ];

  console.log("=================================================");
  console.log("  VERIFICACIÓN EN SANDBOX: AGREGAR 3 MATERIALES ");
  console.log("=================================================");
  
  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i];
    const res = await request(app)
      .post("/materials/add")
      .set("Origin", "http://127.0.0.1")
      .set("Cookie", `workshop_session=${token}`)
      .set("Accept", "application/json")
      .send(mat);

    console.log(`[Material ${i + 1}] HTTP ${res.status} | OK: ${res.body.success} | Nombre: "${res.body.material?.name}" | ID: ${res.body.material?.id}`);
  }

  console.log("\n=================================================");
  console.log("  LISTA COMPLETA DE MATERIALES EN SECCIÓN        ");
  console.log("=================================================");
  const listRes = await request(app)
    .get("/api/materials")
    .set("Origin", "http://127.0.0.1")
    .set("Cookie", `workshop_session=${token}`)
    .set("Accept", "application/json");

  console.log(`Total materiales registrados: ${listRes.body.materials.length}`);
  console.log(JSON.stringify(listRes.body.materials.map((m: any) => ({
    id: m.id,
    name: m.name,
    quantity: m.quantity,
    unit: m.unit,
    category: m.category,
    status: m.status,
    project_name: m.project_name
  })), null, 2));
}

main().catch(console.error);
