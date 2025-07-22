// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  console.log('🔍 Middleware triggered for:', request.nextUrl.pathname);
  return NextResponse.next(); // Always allow
}

export const config = {
  matcher: ['/api/:path*'], // Apply only to API routes
};
