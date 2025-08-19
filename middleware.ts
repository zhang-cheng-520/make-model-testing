// // middleware.ts
// import { NextResponse } from 'next/server';
// import type { NextRequest } from 'next/server';
// import { jwtVerify } from 'jose'

// export async function middleware(request: NextRequest, response: NextResponse) {

//     // Public routes
//     const publicRoutes = [];

//     if (publicRoutes.includes(request.nextUrl.pathname)) {
//         return NextResponse.next();
//     }

//     // Private routes
//     let token = null;
//     const authHeader = request.headers.get('authorization');
//     if (authHeader && authHeader.startsWith('Bearer ')) {
//         token = authHeader.substring(7); // Remove 'Bearer ' prefix
//     }

//     if (!token) {
//         // Redirect to login if not authenticated
//         return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
//     }

//     try {
//         let { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_PARTNER_SECRET));

//         // hard check for TDT for now. 
//         // TODO: in future have a database of partner access or AWS Cognito or similar
//         if (payload.userId !== process.env.TDT_API_ID) {
//             return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
//         }

//         return NextResponse.next();
//     } catch (err) {
//         // Invalid or expired token
//         return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
//     }
// }

// export const config = {
//     matcher: ['/', '/dashboard', '/api/:path*'], // Protect these routes
// };
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'], // runs only on API routes
};
