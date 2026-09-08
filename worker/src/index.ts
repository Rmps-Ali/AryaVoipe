import { DurableObject } from 'cloudflare:workers'

export interface Env {
  CALL_SIGNAL: DurableObjectNamespace<CallSignal>
  DB: D1Database
  SESSION_SECRET?: string
}

type SignalMessage = {
  type: string
  callId?: string
  from?: string
  to?: string
  payload?: unknown
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function cors(response: Response) {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-headers', 'content-type, authorization')
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS')
  return new Response(response.body, { status: response.status, headers })
}

export class CallSignal extends DurableObject<Env> {
  private sockets = new Set<WebSocket>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket required', { status: 426 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)
    this.sockets.add(server)

    server.addEventListener('close', () => this.sockets.delete(server))
    server.addEventListener('error', () => this.sockets.delete(server))

    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let message: SignalMessage
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON' }))
      return
    }

    const encoded = JSON.stringify(message)
    for (const socket of this.sockets) {
      if (socket !== ws) {
        try { socket.send(encoded) } catch { this.sockets.delete(socket) }
      }
    }
  }

  webSocketClose(ws: WebSocket) {
    this.sockets.delete(ws)
  }

  webSocketError(ws: WebSocket) {
    this.sockets.delete(ws)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return cors(json({ ok: true, service: 'AryaVoipe API' }))
    }

    if (url.pathname === '/api/members' && request.method === 'GET') {
      const result = await env.DB.prepare(
        'SELECT id, username, display_name, role, department, active FROM users WHERE active = 1 ORDER BY display_name'
      ).all()
      return cors(json(result.results))
    }

    if (url.pathname === '/api/call-room' && request.method === 'POST') {
      const body = await request.json<{ callId?: string }>().catch(() => ({}))
      const callId = body.callId || crypto.randomUUID()
      const stub = env.CALL_SIGNAL.getByName(callId)
      const wsUrl = new URL(request.url)
      wsUrl.pathname = `/ws/${callId}`
      const response = await stub.fetch(new Request(wsUrl, {
        headers: { Upgrade: 'websocket' },
      }))
      return cors(json({ callId, websocket: wsUrl.toString().replace(/^http/, 'ws'), status: response.status }))
    }

    if (url.pathname.startsWith('/ws/')) {
      const callId = url.pathname.slice('/ws/'.length)
      if (!callId) return cors(json({ error: 'Missing call id' }, 400))
      const stub = env.CALL_SIGNAL.getByName(callId)
      return stub.fetch(request)
    }

    return cors(json({ error: 'Not found' }, 404))
  },
} satisfies ExportedHandler<Env>
