/**
 * Facade / Barrel Export for WorkshopOS Scheduling & Climate Engine.
 * Re-exports all climate and scheduling modular services to ensure 100% backwards compatibility.
 */

// Climate calculation, maps, segments and windowing
export * from "./climate/segments.js";

// Climate presentation, audit, cutoff and risk detection
export * from "./climate/audit.js";

// Task and phase climate compliance rules
export * from "./climate/rules.js";

// Backlog package selection and finality rules
export * from "./scheduling/packageSelection.js";

// Timeline generation and task sequencing
export * from "./scheduling/timeline.js";

// Hierarchical unassigned diagnostic reasons
export * from "./scheduling/diagnostics.js";

// Core day feasibility and override orchestrators
export * from "./scheduling/orchestrator.js";
