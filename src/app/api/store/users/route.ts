import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/store/users - listar usuarios de la tienda (para selectors)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const users = await db.user.findMany({
    where: { storeId, active: true },
    select: { id: true, name: true, email: true, role: true, active: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(users);
}
