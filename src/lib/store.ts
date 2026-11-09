import { promises as fs } from "fs";
import path from "path";
import type { Scan } from "./types";

// Simple JSON-file store for development. Swap for Postgres/Supabase when deploying.
const FILE = path.join(process.cwd(), "data", "scans.json");

async function readAll(): Promise<Scan[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Scan[];
  } catch {
    return [];
  }
}

export async function listScans(): Promise<Scan[]> {
  return (await readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveScan(scan: Scan): Promise<void> {
  const all = await readAll();
  all.push(scan);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2));
}
