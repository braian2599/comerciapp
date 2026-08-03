/**
 * Helper para registrar entradas en el log de sincronización e-commerce.
 */
import { db } from "@/lib/db";
import type { SyncDirection, SyncEntity, SyncAction, SyncStatus } from "./ecommerce";

export async function logSync(
  storeId: string,
  configId: string,
  direction: SyncDirection,
  entity: SyncEntity,
  entityId: string | null | undefined,
  externalId: string | null | undefined,
  action: SyncAction,
  status: SyncStatus,
  message: string | null | undefined,
  payload?: any
): Promise<void> {
  try {
    await db.ecommerceSyncLog.create({
      data: {
        storeId,
        configId,
        direction,
        entity,
        entityId: entityId || null,
        externalId: externalId || null,
        action,
        status,
        message: message || null,
        payload: payload ? JSON.stringify(payload).slice(0, 4000) : null,
      },
    });
  } catch (e) {
    // Silenciar errores de log para no romper el flujo principal
    console.error("Error logging sync:", e);
  }
}
