import { DurableObject } from 'cloudflare:workers'
import { createSessionToken, hashPassword, hashToken, verifyPassword, sessionCookie, clearSessionCookie } from './auth'

export interface Env { CALL_SIGNAL: DurableObjectNamespace<CallSignal>; DB: D1Database; ALLOW_ORIGIN?: string }
type SignalMessage = { type: string; callId?: string; from?: string; to?: string; payload?: unknown }
const id = () => crypto.randomUUID()
function json(data: unknown, status = 200, headers?: HeadersInit) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...(headers || {}) } }) }
function cors(response: Response, env: Env) { const h = new Headers(response.headers); h.set('access-control-allow-origin', env.ALLOW_ORIGIN || '*'); h.set('access-control-allow-credentials', 'true'); h.set('access-control-allow-headers', 'content-type'); h.set('access-control-allow-methods', 'GET,POST,OPTIONS'); return new Response(response.body, { status: response.status, headers: h }) }
async function currentUser(request: Request, env: Env) { const token = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)aryavoipe_session=([^;]+)/)?.[1]; if (!token) return null; return env.DB.prepare('SELECT u.id,u.username,u.display_name,u.role,u.department FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').bind(await hashToken(token), Date.now()).first<any>() }

export class CallSignal extends DurableObject<Env> {
  private sockets = new Set<WebSocket>()
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env) }
  async fetch(request: Request) { if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 }); const pair = new WebSocketPair(); const client = pair[0], server = pair[1]; this.ctx.acceptWebSocket(server); this.sockets.add(server); server.addEventListener('close', () => this.sockets.delete(server)); server.addEventListener('error', () => this.sockets.delete(server)); return new Response(null, { status: 101, webSocket: client }) }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let message: SignalMessage; try { message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) } catch { ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON' })); return }
    if (message.type === 'CALL_ACCEPT' || message.type === 'CALL_REJECT' || message.type === 'HANGUP') {
      const callId = message.callId; if (callId) { const now = Date.now(); if (message.type === 'CALL_ACCEPT') await this.env.DB.prepare('UPDATE calls SET status=?,answered_at=? WHERE id=?').bind('answered', now, callId).run(); if (message.type === 'CALL_REJECT') await this.env.DB.prepare('UPDATE calls SET status=?,ended_at=? WHERE id=?').bind('rejected', now, callId).run(); if (message.type === 'HANGUP') await this.env.DB.prepare('UPDATE calls SET status=?,ended_at=?,duration=? WHERE id=?').bind('ended', now, now, callId).run() }
    }
    const encoded = JSON.stringify(message); for (const socket of this.sockets) if (socket !== ws && socket.readyState === WebSocket.OPEN) { try { socket.send(encoded) } catch { this.sockets.delete(socket) } }
  }
  webSocketClose(ws: WebSocket) { this.sockets.delete(ws) }
  webSocketError(ws: WebSocket) { this.sockets.delete(ws) }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env)
    const url = new URL(request.url)
    try {
      if (url.pathname === '/api/health') return cors(json({ ok: true, service: 'AryaVoipe API' }), env)
      if (url.pathname === '/api/auth/register' && request.method === 'POST') { const b = await request.json<{username?:string;password?:string;displayName?:string;department?:string}>(); if (!b.username || !b.displayName || !b.password || b.password.length < 8) return cors(json({ error: 'اطلاعات ورود نامعتبر است.' },400),env); const username=b.username.trim().toLowerCase(); if(await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()) return cors(json({error:'این نام کاربری قبلاً ثبت شده است.'},409),env); const userId=id(), passwordHash=await hashPassword(b.password); await env.DB.prepare('INSERT INTO users(id,username,display_name,password_hash,role,department,active,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(userId,username,b.displayName.trim(),passwordHash,'member',b.department||null,1,Date.now()).run(); return cors(json({ok:true,userId},201),env) }
      if (url.pathname === '/api/auth/login' && request.method === 'POST') { const b=await request.json<{username?:string;password?:string}>(); const user=await env.DB.prepare('SELECT * FROM users WHERE username=?').bind((b.username||'').trim().toLowerCase()).first<any>(); if(!user||!user.active||!(await verifyPassword(b.password||'',user.password_hash))) return cors(json({error:'نام کاربری یا رمز عبور اشتباه است.'},401),env); const token=createSessionToken(); await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hashToken(token),user.id,Date.now()+604800000).run(); return cors(json({user:{id:user.id,username:user.username,displayName:user.display_name,role:user.role,department:user.department}},200,{'Set-Cookie':sessionCookie(token)}),env) }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') { const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)aryavoipe_session=([^;]+)/)?.[1]; if(token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hashToken(token)).run(); return cors(json({ok:true},200,{'Set-Cookie':clearSessionCookie()}),env) }
      const user=await currentUser(request,env); if(!user) return cors(json({error:'احراز هویت لازم است.'},401),env)
      if(url.pathname==='/api/me') return cors(json({user}),env)
      if(url.pathname==='/api/members'&&request.method==='GET'){const r=await env.DB.prepare('SELECT id,username,display_name,role,department,active FROM users WHERE active=1 AND id<>? ORDER BY display_name').bind(user.id).all();return cors(json(r.results),env)}
      if(url.pathname==='/api/calls'&&request.method==='POST'){const b=await request.json<{calleeId?:string}>();if(!b.calleeId||b.calleeId===user.id)return cors(json({error:'مقصد تماس نامعتبر است.'},400),env);const callee=await env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1').bind(b.calleeId).first();if(!callee)return cors(json({error:'کاربر مقصد پیدا نشد.'},404),env);const callId=id();await env.DB.prepare('INSERT INTO calls(id,caller_id,callee_id,started_at,status) VALUES(?,?,?,?,?)').bind(callId,user.id,b.calleeId,Date.now(),'ringing').run();return cors(json({callId},201),env)}
      if(url.pathname==='/api/calls/pending'&&request.method==='GET'){const r=await env.DB.prepare(`SELECT c.id AS call_id,c.caller_id,u.display_name AS caller_name,c.started_at FROM calls c JOIN users u ON u.id=c.caller_id WHERE c.callee_id=? AND c.status='ringing' ORDER BY c.started_at DESC LIMIT 5`).bind(user.id).all();return cors(json(r.results),env)}
      if(url.pathname.startsWith('/ws/')){const callId=url.pathname.slice(4);const call=await env.DB.prepare('SELECT id FROM calls WHERE id=? AND (caller_id=? OR callee_id=?)').bind(callId,user.id,user.id).first();if(!call)return cors(json({error:'Forbidden'},403),env);return env.CALL_SIGNAL.getByName(callId).fetch(request)}
      return cors(json({error:'Not found'},404),env)
    } catch(e){console.error(e);return cors(json({error:'خطای داخلی سرور'},500),env)}
  },
} satisfies ExportedHandler<Env>
