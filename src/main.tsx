import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import { AudioCall } from './lib/webrtc'

type Member = { id: string; name: string; role: string; online: boolean }

const fallbackMembers: Member[] = [
  { id: 'admin', name: 'مدیر سیستم', role: 'مدیریت', online: true },
  { id: 'member-1', name: 'عضو نمونه ۱', role: 'حقوقی', online: true },
  { id: 'member-2', name: 'عضو نمونه ۲', role: 'پژوهش', online: false },
  { id: 'member-3', name: 'عضو نمونه ۳', role: 'اداری', online: true },
]

const API_URL = import.meta.env.VITE_API_URL || ''

function App() {
  const [members, setMembers] = useState<Member[]>(fallbackMembers)
  const [selected, setSelected] = useState<Member | null>(null)
  const [calling, setCalling] = useState(false)
  const [status, setStatus] = useState('آماده')
  const [call, setCall] = useState<AudioCall | null>(null)

  useEffect(() => {
    if (!API_URL) return
    fetch(`${API_URL}/api/members`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data: Member[]) => setMembers(data.map((m) => ({ ...m, online: true }))))
      .catch(() => undefined)
  }, [])

  const startCall = async (member: Member) => {
    if (!member.online) return
    setSelected(member)
    setCalling(true)
    setStatus('در حال اتصال...')

    if (!API_URL) {
      setStatus('Backend هنوز متصل نشده')
      return
    }

    try {
      const response = await fetch(`${API_URL}/api/call-room`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!response.ok) throw new Error('room failed')
      const data = await response.json() as { websocket: string }
      const instance = new AudioCall()
      setCall(instance)
      await instance.start(data.websocket, data.websocket, true, setStatus)
      setStatus('در حال تماس صوتی')
    } catch {
      setStatus('اتصال تماس ناموفق بود')
    }
  }

  const endCall = () => {
    call?.hangup()
    setCall(null)
    setCalling(false)
    setSelected(null)
    setStatus('آماده')
  }

  return (
    <main className="app" dir="rtl">
      <header className="topbar">
        <div>
          <div className="brand">AryaVoipe</div>
          <div className="subtitle">ارتباط صوتی داخلی سازمان</div>
        </div>
        <div className="status"><span /> {status}</div>
      </header>

      <section className="content">
        <div className="hero">
          <div>
            <p className="eyebrow">VOICE · PRIVATE · SIMPLE</p>
            <h1>ارتباط داخلی، بدون پیچیدگی</h1>
            <p>از طریق مرورگر یا افزونه دسکتاپ با اعضای سازمان تماس صوتی برقرار کنید.</p>
          </div>
          <div className="orb">☎</div>
        </div>

        <div className="section-head">
          <h2>اعضای سازمان</h2>
          <span>{members.filter((m) => m.online).length} نفر آنلاین</span>
        </div>

        <div className="members">
          {members.map((member) => (
            <article className="member" key={member.id}>
              <div className="avatar">{member.name.slice(0, 1)}</div>
              <div className="member-info">
                <strong>{member.name}</strong>
                <small>{member.role} · {member.online ? 'آنلاین' : 'آفلاین'}</small>
              </div>
              <button className="call" disabled={!member.online} onClick={() => startCall(member)} aria-label={`تماس با ${member.name}`}>☎</button>
            </article>
          ))}
        </div>
      </section>

      {calling && selected && (
        <div className="call-overlay">
          <div className="call-card">
            <div className="call-avatar">{selected.name.slice(0, 1)}</div>
            <span className="calling-label">{status}</span>
            <h2>{selected.name}</h2>
            <p>تماس صوتی فقط صدا</p>
            <button className="hangup" onClick={endCall}>پایان تماس</button>
          </div>
        </div>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
