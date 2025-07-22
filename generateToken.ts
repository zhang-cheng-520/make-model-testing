import 'dotenv/config';
import { SignJWT } from 'jose'

export async function generateToken(userId: string): Promise<string> {

    const token = await new SignJWT({ userId }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(process.env.JWT_PARTNER_SECRET));
    console.log(`Generated token for user ${userId}: ${token}`);
    return token;
}

// TODO: change file to include ARG inputs to accomodate for more partners
// For now, just generate a token for TDT API ID
if (!process.env.TDT_API_ID) {
    throw new Error('TDT_API_ID is not set in the environment variables');
}
generateToken(process.env.TDT_API_ID);