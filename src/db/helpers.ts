import { TaskCategory } from "../types.js";

export function computeRequiresCuring(category: TaskCategory | string, curingHours?: number): boolean {
  const hours = curingHours !== undefined ? Number(curingHours) : 0;
  return (
    hours > 0 ||
    category === TaskCategory.PVA_GLUE ||
    category === TaskCategory.VARNISH_PAINT ||
    category === TaskCategory.EPOXY ||
    category === "pva_glue" ||
    category === "varnish_paint" ||
    category === "epoxy"
  );
}
