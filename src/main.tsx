import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Member = { name: string; role: string; online: boolean };

const members: Member[] = [
  { name: 'مدیر سیستم', role: 'مدیریت', online: true },
  { name: 'عضو نمونه ۱', role: 'حقوقی', online: true },
  { name: 'عضو نمونه ۲', role: 'پژوهش', online: false },
  { name: 'عضو نمونه ۳', role: 'اداری', online: true },
];

function App() {
  const [selected, setSelected] = useState<Member | null>(null);
  const [calling, setCalling] = useState(false);

  const startCall = (member: Member) => {
    if (!member.online) return;
    setSelected(member);
    setCalling(true);
  };

  return (
    <main className="app" dir="rtl">
      <header className="topbar">
        <div>
          <div className="brand">AryaVoipe</div>
          <div className="subtitle">ارتباط صوتی داخلی سازمان</div>
        </div>
        <div className="status"><span /> آنلاین</div>
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
          <span>{members.filter(m => m.online).length} نفر آنلاین</span>
        </div>

        <div className="members">
          {members.map(member => (
            <article className="member" key={member.name}>
              <div className="avatar">{member.name.slice(0, 1)}</div>
              <div className="member-info">
                <strong>{member.name}</strong>
                <small>{member.role} · {member.online ? 'آنلاین' : 'آفلاین'}</small>
              </div>
              <button
                className="call"
                disabled={!member.online}
                onClick={() => startCall(member)}
                aria-label={`تماس با ${member.name}`}
              >☎</button>
            </article>
          ))}
        </div>
      </section>

      {calling && selected && (
        <div className="call-overlay">
          <div className="call-card">
            <div className="call-avatar">{selected.name.slice(0, 1)}</div>
            <span className="calling-label">در حال برقراری تماس</span>
            <h2>{selected.name}</h2>
            <p>تماس صوتی امن</p>
            <button className="hangup" onClick={() => setCalling(false)}>پایان تماس</button>
          </div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
