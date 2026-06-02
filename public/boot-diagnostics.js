(function () {
  var statusEl;

  function setStatus(message) {
    try {
      statusEl = statusEl || document.getElementById('jc-boot-status');
      if (statusEl) {
        statusEl.style.whiteSpace = 'pre-wrap';
        statusEl.style.textAlign = 'left';
        statusEl.textContent = message;
      }
    } catch (_) {}
  }

  function formatStack(error, fallback) {
    if (error && error.stack) return String(error.stack);
    return fallback;
  }

  window.__JC_BOOT_DIAGNOSTICS__ = [];
  window.__JC_BOOT_STATUS__ = setStatus;

  window.addEventListener('error', function (event) {
    var message = event && event.message ? event.message : '未知脚本错误';
    var stack = formatStack(event && event.error, message);
    window.__JC_BOOT_DIAGNOSTICS__.push({
      type: 'error',
      message: message,
      stack: stack,
      source: event && event.filename,
      line: event && event.lineno,
      column: event && event.colno,
    });
    setStatus(
      '启动失败：' + message +
      '\nsource: ' + (event && event.filename ? event.filename : '-') +
      '\nline: ' + (event && event.lineno ? event.lineno : '-') +
      ' column: ' + (event && event.colno ? event.colno : '-') +
      '\n\n' + stack
    );
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? reason.message : String(reason || '未知 Promise 错误');
    var stack = formatStack(reason, message);
    window.__JC_BOOT_DIAGNOSTICS__.push({ type: 'unhandledrejection', message: message, stack: stack });
    setStatus('启动失败：' + message + '\n\n' + stack);
  });

  setStatus('正在加载应用脚本...');
})();
