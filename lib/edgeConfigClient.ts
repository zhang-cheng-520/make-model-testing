// lib/edgeConfigClient.ts
import { get, getAll } from '@vercel/edge-config';

/**
 * Get a single value from Edge Config.
 */
export async function getEdgeValue<T>(key: string): Promise<T | null> {
  try {
    const value = await get<T>(key);
    return value ?? null;
  } catch (error) {
    console.error('Error getting Edge Config value:', error);
    return null;
  }
}

/**
 * Get all values from Edge Config.
 */
export async function getAllEdgeValues(): Promise<Record<string, any>> {
  try {
    const values = await getAll();
    return values;
  } catch (error) {
    console.error('Error getting all Edge Config values:', error);
    return {};
  }
}
