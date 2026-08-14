(function () {
  function totalOffsetLeft(el) {
    let x = 0;
    while (el && el !== document.body) {
      x += el.offsetLeft;
      el = el.offsetParent;
    }
    return x;
  }

  function addLineNumbers() {
    document.querySelectorAll('[data-line]').forEach(el => {
      if (el.querySelector('.md-line-num')) return; // already added
      const line = parseInt(el.getAttribute('data-line')) + 1;
      const badge = document.createElement('span');
      badge.className = 'md-line-num';
      badge.textContent = line;
      badge.style.left = `${4 - totalOffsetLeft(el)}px`;
      el.prepend(badge);
    });
  }

  addLineNumbers();

  // re-run if preview refreshes content dynamically
  new MutationObserver(addLineNumbers).observe(document.body, { childList: true, subtree: true });
})();
