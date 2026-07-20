;(function () {
  var BOOT_TIMEOUT_MS = 15000
  var splashEl = document.getElementById('jc-boot-screen')
  var bootErrors = []

  window.addEventListener(
    'error',
    function (event) {
      var message =
        event.message ||
        (event.target && event.target.src ? 'Failed to load: ' + event.target.src : 'Unknown error')
      bootErrors.push({
        ts: Date.now(),
        msg: message,
        filename: event.filename,
        lineno: event.lineno,
      })
      clearTimeout(slowTimer)
      slowTimer = setTimeout(hide, 5000)
    },
    true,
  )

  function hide() {
    if (!splashEl) return
    splashEl.classList.add('jc-boot-fade-out')
    setTimeout(function () {
      if (splashEl && splashEl.parentNode) splashEl.remove()
    }, 400)
  }

  var slowTimer = setTimeout(hide, BOOT_TIMEOUT_MS)
  window.__JC_EARLY_ERRORS__ = bootErrors
})()
