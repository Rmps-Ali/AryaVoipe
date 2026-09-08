export type CallState = 'connecting' | 'ringing' | 'connected' | 'ended' | 'error'

type SignalMessage = {
  type: 'PEER_READY' | 'OFFER' | 'ANSWER' | 'ICE' | 'CALL_ACCEPT' | 'CALL_REJECT' | 'HANGUP'
  callId: string
  from?: string
  payload?: any
}

export class AudioCall {
  private socket?: WebSocket
  private peer?: RTCPeerConnection
  private stream?: MediaStream
  private remoteAudio?: HTMLAudioElement
  private pendingIce: RTCIceCandidateInit[] = []
  private remoteDescriptionSet = false
  private callId = ''
  private userId = ''
  private initiator = false
  private onState?: (state: CallState) => void

  async start(callId: string, signalingUrl: string, initiator: boolean, userId: string, onState?: (state: CallState) => void) {
    this.callId = callId
    this.userId = userId
    this.initiator = initiator
    this.onState = onState
    this.onState?.('connecting')

    this.remoteAudio = document.createElement('audio')
    this.remoteAudio.autoplay = true
    this.remoteAudio.setAttribute('playsinline', 'true')
    document.body.appendChild(this.remoteAudio)

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    this.peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] })
    this.stream.getTracks().forEach((track) => this.peer!.addTrack(track, this.stream!))
    this.peer.ontrack = (event) => { if (this.remoteAudio) this.remoteAudio.srcObject = event.streams[0] }
    this.peer.onicecandidate = (event) => {
      if (this.socket?.readyState === WebSocket.OPEN && event.candidate) this.send({ type: 'ICE', payload: event.candidate.toJSON() })
    }
    this.peer.onconnectionstatechange = () => {
      const state = this.peer?.connectionState
      if (state === 'connected') this.onState?.('connected')
      if (state === 'failed' || state === 'disconnected') this.onState?.('error')
    }

    await new Promise<void>((resolve, reject) => {
      this.socket = new WebSocket(signalingUrl)
      this.socket.onopen = () => { this.send({ type: 'PEER_READY' }); resolve() }
      this.socket.onerror = () => reject(new Error('signaling connection failed'))
    })

    this.socket.onmessage = async (event) => {
      const message = JSON.parse(event.data) as SignalMessage
      if (message.callId !== this.callId || message.from === this.userId || !this.peer) return
      try {
        if (message.type === 'CALL_ACCEPT') {
          if (this.initiator) await this.createOffer()
        } else if (message.type === 'OFFER') {
          await this.peer.setRemoteDescription(message.payload)
          this.remoteDescriptionSet = true
          await this.flushIce()
          const answer = await this.peer.createAnswer()
          await this.peer.setLocalDescription(answer)
          this.send({ type: 'ANSWER', payload: answer })
        } else if (message.type === 'ANSWER') {
          await this.peer.setRemoteDescription(message.payload)
          this.remoteDescriptionSet = true
          await this.flushIce()
        } else if (message.type === 'ICE') {
          if (this.remoteDescriptionSet) await this.peer.addIceCandidate(message.payload)
          else this.pendingIce.push(message.payload)
        } else if (message.type === 'HANGUP' || message.type === 'CALL_REJECT') {
          this.onState?.('ended')
          this.stop()
        }
      } catch { this.onState?.('error') }
    }
    this.socket.onclose = () => { if (this.peer?.connectionState !== 'closed') this.onState?.('ended') }
  }

  accept() { this.send({ type: 'CALL_ACCEPT' }) }

  reject() { this.send({ type: 'CALL_REJECT' }); this.stop() }

  private send(message: Omit<SignalMessage, 'callId' | 'from'>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ ...message, callId: this.callId, from: this.userId }))
  }

  private async createOffer() {
    if (!this.peer) return
    const offer = await this.peer.createOffer({ offerToReceiveAudio: true })
    await this.peer.setLocalDescription(offer)
    this.send({ type: 'OFFER', payload: offer })
    this.onState?.('ringing')
  }

  private async flushIce() {
    if (!this.peer) return
    for (const candidate of this.pendingIce) await this.peer.addIceCandidate(candidate)
    this.pendingIce = []
  }

  hangup() { this.send({ type: 'HANGUP' }); this.stop() }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.peer?.close()
    this.socket?.close()
    this.remoteAudio?.remove()
    this.stream = undefined; this.peer = undefined; this.socket = undefined; this.remoteAudio = undefined
  }
}
