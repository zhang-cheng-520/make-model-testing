import type { NextApiRequest, NextApiResponse } from 'next'

function parseMachines(env?: string) {
  const map = new Map<string, string>()
  if (!env) return map

  env.split(',').forEach(pair => {
    const [id, secret] = pair.split(':')
    if (id && secret) map.set(id.trim(), secret.trim())
  })

  return map
}

// 🔒 Per-client route permissions
const CLIENT_ROUTE_ALLOWLIST: Record<string, string[]> = {
  "38lptb6vmt1m0jdljnfuhfdh6v": [
    "/api/v1/o3/policyholder-icno/by-icno"
  ]
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const { client_id, api_route, method = 'GET', body_request } = req.body

    if (!client_id || !api_route) {
      return res.status(400).json({ error: 'Missing client_id or api_route' })
    }

    // 🔒 Basic validation
    if (!api_route.startsWith('/') || api_route.includes('..')) {
      return res.status(400).json({ error: 'Invalid route' })
    }

    const machines = parseMachines(process.env.VERIFIED_MACHINES)
    const clientSecret = machines.get(client_id)

    if (!clientSecret) {
      return res.status(401).json({ error: 'Unauthorized client_id' })
    }

    // 🔒 Check allowlist for this client
    const allowedRoutes = CLIENT_ROUTE_ALLOWLIST[client_id]

    if (!allowedRoutes) {
      return res.status(403).json({ error: 'No route permissions for client' })
    }

    const isAllowed = allowedRoutes.some(route =>
      api_route.startsWith(route)
    )

    if (!isAllowed) {
      return res.status(403).json({ error: 'Route not allowed for this client' })
    }

    // 🔐 Get Cognito token
    const tokenRes = await fetch(process.env.COGNITO_TOKEN_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id,
        client_secret: clientSecret
      })
    })

    const tokenData = await tokenRes.json()

    if (!tokenRes.ok) {
      return res.status(500).json({ error: 'Token fetch failed', details: tokenData })
    }

    const accessToken = tokenData.access_token

    // 🚀 Build target URL
    const url = `${process.env.TARGET_API_BASE}${api_route}`

    // 🚀 Call AWS API
    const apiRes = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-token-used': accessToken,
        'Content-Type': 'application/json'
      },
      body: method !== 'GET' && body_request
        ? JSON.stringify(body_request)
        : undefined
    })

    const data = await apiRes.json()

    return res.status(apiRes.status).json(data)

  } catch (err: any) {
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    })
  }
}