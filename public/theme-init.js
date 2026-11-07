// Runs synchronously from <head>, before first paint, so the saved theme is in place with no flash.
// An external file (not inline) so it satisfies the app's `script-src 'self'` CSP.
(function () {
  try {
    var t = localStorage.getItem('atelier.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch {
    /* storage unavailable: follow the system theme */
  }
})();
