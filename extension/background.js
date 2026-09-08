chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'INCOMING_CALL') return

  chrome.notifications.create(`aryavoipe-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icon128.png',
    title: 'AryaVoipe',
    message: message.callerName ? `تماس ورودی از ${message.callerName}` : 'تماس صوتی ورودی',
    priority: 2,
  })
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() || {} } catch { data = {} }

  event.waitUntil(
    chrome.notifications.create(`aryavoipe-push-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'AryaVoipe',
      message: data.callerName ? `تماس ورودی از ${data.callerName}` : 'تماس صوتی ورودی',
      priority: 2,
    })
  )
})
