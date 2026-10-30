// getclai.vercel.app: copy the install command, reveal sections once.
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Copy buttons.
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const source = document.getElementById(button.getAttribute('data-copy'));
      if (!source) return;
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        button.textContent = 'Copied';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(source);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = 'Press ⌘C';
      }
      setTimeout(() => (button.textContent = 'Copy'), 1800);
    });
  });

  // Count a figure up once when it first scrolls into view.
  function countUp(el) {
    const target = Number(el.getAttribute('data-count-to'));
    const decimals = Number(el.getAttribute('data-count-decimals') || 0);
    if (!Number.isFinite(target) || reduceMotion) return;
    const start = performance.now();
    const duration = 1100;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = (target * eased).toFixed(decimals);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const revealables = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealables.forEach((el) => el.classList.add('in'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        entry.target.querySelectorAll('[data-count-to]').forEach(countUp);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
  );
  revealables.forEach((el) => observer.observe(el));
})();
