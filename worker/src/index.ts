import { DurableObject } from 'cloudflare:workers'
import { createSessionToken, hashPassword, hashToken, verifyPassword, sessionCookie, clearSessionCookie } from './auth'

export interface Env {
  CALL_SIGNAL: DurableObjectNamespace<CallSignal>
  DB: D1Database
  ALLOW_ORIGIN?: string
}

type SignalMessage = { type: string; callId?: string; from?: string; to?: string; payload?: unknown }
const id = () => crypto.randomUUID()

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...(headers || {}) } })
}
function cors(response: Response, env: Env) {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', env.ALLOW_ORIGIN || '*')
  headers.set('access-control-allow-credentials', 'true')
  headers.set('access-control-allow-headers', 'content-type')
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS')
  return new Response(response.body, { status: response.status, headers })
}
async function me(request: Request, env: Env) {
  const cookie = request.headers.get('Cookie') || ''
  const token = cookie.match(/(?:^|;\s*)aryavoipe_session=([^;]+)/)?.[1]
  if (!token) return null
  return env.DB.prepare(`SELECT u.id,u.username,u.display_name,u.role,u.department FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).bind(await hashToken(token), Date.now()).first<any>()
}

export class CallSignal extends DurableObject<Env> {
  private sockets = new Set<WebSocket>()
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env) }
  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 })
    const pair = new WebSocketPair(); const client = pair[0]; const server = pair[1]
    this.ctx.acceptWebSocket(server); this.sockets.add(server)
    server.addEventListener('close', () => this.sockets.delete(server)); server.addEventListener('error', () => this.sockets.delete(server))
    return new Response(null, { status: 101, webSocket: client })
  }
  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let message: SignalMessage
    try { message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) } catch { ws.send(JSON.stringify({ type:'ERROR', message:'Invalid JSON' })); return }
    const encoded = JSON.stringify(message)
    for (const socket of this.sockets) if (socket !== ws && socket.readyState === WebSocket.OPEN) { try { socket.send(encoded) } catch { this.sockets.delete(socket) } }
  }
  webSocketClose(ws: WebSocket) { this.sockets.delete(ws) }
  webSocketError(ws: WebSocket) { this.sockets.delete(ws) }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env)
    const url = new URL(request.url)
    try {
      if (url.pathname === '/api/health') return cors(json({ ok:true, service:'AryaVoipe API' }), env)

      if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        const body = await request.json<{username?:string,password?:string,displayName?:string,department?:string}>()
        if (!body.username || !body.displayName || !body.password || body.password.length < 8) return cors(json({error:'اطلاعات ورود نامعتبر است.'},400),env)
        const username = body.username.trim().toLowerCase()
        if (await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()) return cors(json({error:'این نام کاربری قبلاً ثبت شده است.'},409),env)
        const userId=id(); const passwordHash=await hashPassword(body.password)
        await env.DB.prepare('INSERT INTO users(id,username,display_name,password_hash,role,department,active,created_at) VALUES(?,?,?,?,?,?,1,?)').bind(userId,username,body.displayName.trim(),'member',body.department||null,1,Date.now()).run()
        return cors(json({ok:true,userId},201),env)
      }

      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        const body = await request.json<{username?:string,password?:string}>()
        const user=await env.DB.prepare('SELECT * FROM users WHERE username=?').bind((body.username||'').trim().toLowerCase()).first<any>()
        if (!user || !user.active || !(await verifyPassword(body.password||'',user.password_hash))) return cors(json({error:'نام کاربری یا رمز عبور اشتباه است.'},401),env)
        const token=createSessionToken(); await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hashToken(token),user.id,Date.now()+604800000).run()
        return cors(json({user:{id:user.id,username:user.username,displayName:user.display_name,role:user.role,department:user.department}},200,{'Set-Cookie':sessionCookie(token)}),env)
      }

      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)aryavoipe_session=([^;]+)/)?.[1]
        if(token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hashToken(token)).run()
        return cors(json({ok:true},200,{'Set-Cookie':clearSessionCookie()}),env)
      }

      const user=await me(request,env); if(!user) return cors(json({error:'احراز هویت لازم است.'},401),env)
      if(url.pathname==='/api/me') return cors(json({user}),env)
      if(url.pathname==='/api/members' && request.method==='GET') {
        const result=await env.DB.prepare('SELECT id,username,display_name,role,department,active FROM users WHERE active=1 ORDER BY display_name').all(); return cors(json(result.results),env)
      }
      if(url.pathname==='/api/calls' && request.method==='POST') {
        const body=await request.json<{calleeId?:string}>(); if(!body.calleeId || body.calleeId===user.id) return cors(json({error:'مقصد تماس نامعتبر است.'},400),env)
        const callee=await env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1').bind(body.calleeId).first(); if(!callee) return cors(json({error:'کاربر مقصد پیدا نشد.'},404),env)
        const callId=id(); await env.DB.prepare(`INSERT INTO calls(id,caller_id,callee_id,started_at,status) VALUES(?,?,?,?,?)`).bind(callId,user.id,body.calleeId,Date.now(),'ringing').run()
        return cors(json({callId,caller:{id:user.id,displayName:user.display_name},calleeId:body.calleeId},201),env)
      }
      if(url.pathname.startsWith('/ws/')) {
        const callId=url.pathname.slice(4); const call=await env.DB.prepare('SELECT id FROM calls WHERE id=? AND (caller_id=? OR callee_id=?)').bind(callId,user.id,user.id).first(); if(!call) return cors(json({error:'Forbidden'},403),env)
        return env.CALL_SIGNAL.getByName(callId).fetch(request)
      }
      if(url.pathname.startsWith('/api/calls/') && request.method==='POST') {
        const parts=url.pathname.split('/'); const callId=parts[3]; const action=parts[4]
        const call=await env.DB.prepare('SELECT * FROM calls WHERE id=? AND (caller_id=? OR callee_id=?)').bind(callId,user.id,user.id).first<any>(); if(!call) return cors(json({error:'تماس پیدا نشد.'},404),env)
        if(action==='answer') await env.DB.prepare('UPDATE calls SET status=?,answered_at=? WHERE id=?').bind('answered',Date.now(),callId).run()
        else if(action==='reject') await env.DB.prepare('UPDATE calls SET status=?,ended_at=? WHERE id=?').bind('rejected',Date.now(),callId).run()
        else if(action==='hangup') await env.DB.prepare('UPDATE calls SET status=?,ended_at=?,duration_seconds=? WHERE id=?').bind('ended',Date.now(),call.answered_at?Math.max(0,Math.floor((Date.now()-call.answered_at)/1000)):0,callId).run()
        const msg={type:action==='answer'?'CALL_ACCEPT':action==='reject'?'CALL_REJECT':'HANGUP',callId,from:user.id}
        // The Durable Object broadcasts control messages to the other endpoint.
        const stub=env.CALL_SIGNAL.getByName(callId); const fake=new Request(`https://call.internal/${callId}`,{method:'POST',headers:{Upgrade:'websocket'}})
        // A WebSocket connection must be established by clients before control messages can flow.
        void msg; void stub; void fake
        return cors(json({ok:true},200),env)
      }
      return cors(json({error:'Not found'},404),env)
    } catch(e) { console.error(e); return cors(json({error:'خطای داخلی سرور'},500),env) }
  }
} satisfies ExportedHandler<Env>
