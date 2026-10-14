// Test-only external WebSocket boundary; VueUse and Vue Query remain real.
export class TestSocket {
  static instances: TestSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = 0
  sent: string[] = []
  onopen: ((event: Event) => unknown) | null = null
  onclose: ((event: CloseEvent) => unknown) | null = null
  onerror: ((event: Event) => unknown) | null = null
  onmessage: ((event: MessageEvent) => unknown) | null = null
  constructor(public url: string) {
    TestSocket.instances.push(this)
  }
  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error('Socket closed')
    this.sent.push(data)
  }
  message(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }
  close(code = 1000) {
    this.readyState = 3
    this.onclose?.(new CloseEvent('close', { code }))
  }
}
