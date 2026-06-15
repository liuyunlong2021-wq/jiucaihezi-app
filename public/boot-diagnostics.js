(function () {
  var statusEl;
  var startedAt = Date.now();

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

  function resourceUrl(element) {
    return element.src || element.href || '';
  }

  function resourceLabel(element) {
    var url = resourceUrl(element);
    try {
      return new URL(url, window.location.href).pathname;
    } catch (_) {
      return url || '-';
    }
  }

  function checkResource(element) {
    var url = resourceUrl(element);
    if (!url) return Promise.resolve(resourceLabel(element) + ' missing-url');
    return fetch(url, { method: 'HEAD', cache: 'no-store' })
      .then(function (response) {
        return resourceLabel(element) + ' ' + response.status + ' ' + response.statusText;
      })
      .catch(function (error) {
        return resourceLabel(element) + ' failed: ' + (error && error.message ? error.message : String(error));
      });
  }

  function reportStartupTimeout() {
    if (window.__JC_APP_MOUNTED__) return;
    var resources = Array.prototype.slice.call(
      document.querySelectorAll('script[type="module"], link[rel="modulepreload"]')
    );
    setStatus(
      '启动超时：应用脚本已等待 ' + Math.round((Date.now() - startedAt) / 1000) + ' 秒仍未挂载。' +
      '\n正在检查入口脚本和预加载资源...'
    );
    Promise.all(resources.map(checkResource)).then(function (results) {
      if (window.__JC_APP_MOUNTED__) return;
      setStatus(
        '启动超时：应用脚本未完成挂载。' +
        '\n\n资源检查：\n' + (results.length ? results.join('\n') : '未找到 module 脚本。') +
        '\n\n请强制刷新页面；如果仍失败，把这段信息发给开发者。'
      );
    });
  }

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
  setTimeout(reportStartupTimeout, 8000);
})();
