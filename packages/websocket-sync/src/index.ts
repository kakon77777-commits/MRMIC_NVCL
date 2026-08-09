import { createHash } from 'node:crypto'
import type { StateVectorSyncRoom, StateVector, PresenceState, SyncUpdate, StateReplacementUpdate } from '../../state-vector-sync/src/index.js'

interface SocketLike { write(data: string | Uint8Array): void; end(): void; destroy(): void; on(event: string, listener: (...args: any[]) => void): void }
interface Peer { clientId?: string; socket: SocketLike; buffer: Uint8Array }

function acceptKey(key: string): string {
  return createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
}
function frameText(text: string): Uint8Array {
  const payload = new TextEncoder().encode(text); const n = payload.length
  if (n < 126) return Uint8Array.from([0x81, n, ...payload])
  if (n < 65536) return Uint8Array.from([0x81, 126, (n >> 8) & 255, n & 255, ...payload])
  throw new Error('Frame too large for MVP transport')
}
function concat(a: Uint8Array,b:Uint8Array){ const out=new Uint8Array(a.length+b.length); out.set(a); out.set(b,a.length); return out }
function decodeFrames(input: Uint8Array): { messages: string[]; rest: Uint8Array; closed: boolean } {
  const messages:string[]=[]; let offset=0; let closed=false
  while (input.length-offset>=2) {
    const b0=input[offset]!, b1=input[offset+1]!; const opcode=b0&15; const masked=(b1&128)!==0; let len=b1&127; let head=2
    if (len===126) { if(input.length-offset<4) break; len=(input[offset+2]!<<8)|input[offset+3]!; head=4 }
    if (len===127) throw new Error('64-bit WebSocket frames are not supported in MVP')
    const maskLen=masked?4:0; if(input.length-offset<head+maskLen+len) break
    const mask=masked?input.slice(offset+head,offset+head+4):undefined; const payload=input.slice(offset+head+maskLen,offset+head+maskLen+len)
    if(mask) for(let i=0;i<payload.length;i++) payload[i]=(payload[i]??0)^mask[i%4]!
    offset+=head+maskLen+len
    if(opcode===1) messages.push(new TextDecoder().decode(payload)); else if(opcode===8) { closed=true; break }
  }
  return {messages,rest:input.slice(offset),closed}
}

export class CanvasWebSocketHub {
  readonly #room: StateVectorSyncRoom
  readonly #peers = new Set<Peer>()
  constructor(room: StateVectorSyncRoom) {
    this.#room=room
    room.subscribe(event=>{
      if(event.type==='update') this.broadcast({type:'update',update:event.update,stateVector:room.stateVector()})
      else if(event.type==='presence') this.broadcast({type:'presence',presence:event.presence})
      else this.broadcast({type:'presence_removed',clientId:event.clientId})
    })
  }
  handleUpgrade(request:any,socket:SocketLike,head:Uint8Array):void {
    const key=String(request.headers['sec-websocket-key']??''); if(!key){socket.destroy();return}
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`)
    const peer:Peer={socket,buffer:new Uint8Array(0)}; this.#peers.add(peer)
    const onData=(chunk:Uint8Array)=>{ peer.buffer=concat(peer.buffer,chunk); const decoded=decodeFrames(peer.buffer); peer.buffer=decoded.rest
      for(const text of decoded.messages) this.#onMessage(peer,text).catch(error=>this.send(peer,{type:'error',message:error instanceof Error?error.message:String(error)}))
      if(decoded.closed) this.#remove(peer)
    }
    socket.on('data',onData); socket.on('close',()=>this.#remove(peer)); socket.on('error',()=>this.#remove(peer)); if(head?.length) onData(head)
  }
  broadcast(payload:unknown, except?:Peer):void { for(const peer of this.#peers) if(peer!==except) this.send(peer,payload) }
  send(peer:Peer,payload:unknown):void { peer.socket.write(frameText(JSON.stringify(payload))) }
  peerCount():number{return this.#peers.size}
  async #onMessage(peer:Peer,text:string):Promise<void>{
    const message=JSON.parse(text) as any
    if(message.type==='hello') {
      peer.clientId=String(message.clientId); const vector=(message.stateVector??{}) as StateVector
      if(message.presence) this.#room.setPresence(message.presence as PresenceState)
      this.send(peer,{type:'hello_ack',roomId:this.#room.roomId,stateVector:this.#room.stateVector(),missingUpdates:this.#room.diff(vector),presence:this.#room.presenceSnapshot()}); return
    }
    if(message.type==='update'){ await this.#room.apply(message.update as SyncUpdate); return }
    if(message.type==='state_replace'){ await this.#room.applyStateReplacement(message.update as StateReplacementUpdate); return }
    if(message.type==='presence'){ this.#room.setPresence(message.presence as PresenceState); return }
    if(message.type==='ping'){ this.send(peer,{type:'pong',at:new Date().toISOString()}); return }
    throw new Error(`Unknown sync message type: ${String(message.type)}`)
  }
  #remove(peer:Peer):void { if(!this.#peers.delete(peer))return; if(peer.clientId)this.#room.removePresence(peer.clientId); try{peer.socket.end()}catch{} }
}
