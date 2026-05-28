import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const sb = getSupabaseServerClient();
  await sb.auth.signOut();
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/`, { status: 303 });
}

// Pratique pour debug en local — en prod on préférera un form POST avec CSRF
export async function GET(request: Request) {
  return POST(request);
}
