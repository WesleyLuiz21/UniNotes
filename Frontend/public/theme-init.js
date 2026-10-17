(function () {
  try {
    var pref = localStorage.getItem('uninotes-theme') || 'system';
    var dark =
      pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch {
    /* storage unavailable: fall back to light until React mounts */
  }
})();
