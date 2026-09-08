function notify(callerName) {
  return chrome.notifications.create(`aryavoipe-${Date.now()}`, {
    type: 'basic',
    title: 'AryaVoipe',
    message: callerName ? `تماس ورودی از ${callerName}` : 'تماس صوتی ورودی',
    priority: 2,
  })
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'INCOMING_CALL') notify(message.callerName)
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() || {} } catch { data = {} }
  event.waitUntil(notify(data.callerName))
})
