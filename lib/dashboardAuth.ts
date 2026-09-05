// lib/dashboardAuth.ts
// Minimal session handling for the HR Dashboard's v1 login: one fixed,
// hardcoded email/password pair (no per-user identity, no OAuth — PRD §5.1/§5.5).
import { SignJWT, jwtVerify } from "jose";
import type { NextApiRequest, NextApiResponse } from "next";

export const SESSION_COOKIE_NAME = "dashboard_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h

function secretKey() {
  const secret = process.env.DASHBOARD_SESSION_SECRET || "";
  if (!secret) throw new Error("DASHBOARD_SESSION_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

export function checkCredentials(email: string, password: string): boolean {
  const validEmail = process.env.DASHBOARD_LOGIN_EMAIL || "";
  const validPassword = process.env.DASHBOARD_LOGIN_PASSWORD || "";
  return Boolean(validEmail) && Boolean(validPassword) && email === validEmail && password === validPassword;
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload.authenticated === true;
  } catch {
    return false;
  }
}

export function setSessionCookie(res: NextApiResponse, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=Lax${secure}`
  );
}

export function clearSessionCookie(res: NextApiResponse) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

export async function isAuthenticated(req: NextApiRequest): Promise<boolean> {
  const token = req.cookies[SESSION_COOKIE_NAME];
  if (!token) return false;
  return verifySessionToken(token);
}
