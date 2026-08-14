(function () {
  const STORAGE_KEY = 'victor-vsc-md-zoom';
  const DEFAULT_SIZE = 14;
  const MIN_SIZE = 8;
  const MAX_SIZE = 40;

  function applyZoom(px) {
    document.body.style.fontSize = px + 'px';
  }

  function getStored() {
    const val = localStorage.getItem(STORAGE_KEY);
    return val ? parseFloat(val) : null;
  }

  function saveZoom(px) {
    localStorage.setItem(STORAGE_KEY, px);
  }

  // re-apply saved zoom on load
  const saved = getStored();
  if (saved) applyZoom(saved);

  window.addEventListener('wheel', function (e) {
    if (!e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();

    const current = parseFloat(getComputedStyle(document.body).fontSize) || DEFAULT_SIZE;
    const delta = e.deltaY < 0 ? 1 : -1;
    const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, current + delta));

    applyZoom(next);
    saveZoom(next);
  }, { passive: false, capture: true });
})();
