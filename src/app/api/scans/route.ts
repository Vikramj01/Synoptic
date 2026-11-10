import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runScan } from "@/lib/scan";
import { listScans, saveScan } from "@/lib/store";
import { ENGINES, type Engine, type ScanInput } from "@/lib/types";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function GET() {
  if (!(await getCurrentUser())) return unauthorized();
  return NextResponse.json(await listScans());
}

export async function POST(req: Request) {
  if (!(await getCurrentUser())) return unauthorized();
  const body = await req.json().catch(() => null);
  const list = (v: unknown) =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];
  const input: ScanInput = {
    domain: String(body?.domain ?? "").trim(),
    brand: String(body?.brand ?? "").trim(),
    competitors: list(body?.competitors),
    prompts: list(body?.prompts),
    engines: list(body?.engines).filter((e): e is Engine => ENGINES.includes(e as Engine)),
  };
  if (!input.domain || !input.brand || !input.prompts.length || !input.engines.length) {
    return NextResponse.json(
      { error: "domain, brand, at least one prompt and one engine are required" },
      { status: 400 },
    );
  }
  const scan = await runScan(input);
  await saveScan(scan);
  return NextResponse.json(scan, { status: 201 });
}
