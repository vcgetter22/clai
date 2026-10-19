// getclai.vercel.app: pick the right download, copy the install command, reveal sections once.
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Apple silicon is the default; switch to Intel only when the browser says so.
  async function architecture() {
    try {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        const { architecture: arch } = await navigator.userAgentData.getHighEntropyValues(['architecture']);
        if (arch === 'x86') return 'intel';
        if (arch === 'arm') return 'arm';
      }
    } catch {
      /* fall through */
    }
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      if (/Apple (M\d|GPU)/i.test(renderer)) return 'arm';
      if (/Intel|AMD|Radeon/i.test(renderer)) return 'intel';
    } catch {
      /* fall through */
    }
    return 'unknown';
  }

  const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent);
  architecture().then((arch) => {
    if (!isMac || arch !== 'intel') return;
    document.querySelectorAll('[data-download]').forEach((a) => a.setAttribute('href', '/download/mac-intel'));
    document.querySelectorAll('[data-download-meta]').forEach((el) => (el.textContent = 'Intel · 34 MB · macOS 14 or later'));
    document.querySelectorAll('[data-other-arch]').forEach((a) => {
      a.setAttribute('href', '/download/mac');
      a.textContent = 'Apple silicon? Get that version';
    });
  });
  if (!isMac) {
    document.querySelectorAll('[data-download-meta]').forEach((el) => (el.textContent = 'For Macs with macOS 14 or later'));
  }

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
