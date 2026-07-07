(function () {
  const THEME_KEY = 'writeai_web_theme';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document.getElementById('theme-icon-dark')?.classList.toggle('hidden', theme === 'light');
    document.getElementById('theme-icon-light')?.classList.toggle('hidden', theme !== 'light');
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
  }

  function installExtension() {
    showToast('Open chrome://extensions → Enable Developer mode → Load unpacked → select the writeai-extension folder.');
  }

  function initHeroTyping() {
    const el = document.getElementById('hero-result');
    if (!el) return;

    const demos = [
      { tool: 'Fix', text: 'Recreate a style you like and build an outfit you love.' },
      { tool: 'Translate', text: 'دوبارہ تخلیق کریں — ایک انداز جو آپ کو پسند ہو۔' },
      { tool: 'Rephrase', text: 'Craft a look you adore by recreating a style that speaks to you.' }
    ];
    let idx = 0;

    function cycle() {
      const d = demos[idx];
      document.querySelectorAll('.demo-tool').forEach((btn) => {
        btn.classList.toggle('on', btn.dataset.tool === d.tool);
      });
      el.innerHTML = '';
      let i = 0;
      const span = document.createElement('span');
      span.className = 'typing';
      el.appendChild(span);

      const timer = setInterval(() => {
        span.textContent = d.text.slice(0, i++);
        if (i > d.text.length) {
          clearInterval(timer);
          setTimeout(() => {
            idx = (idx + 1) % demos.length;
            cycle();
          }, 2200);
        }
      }, 28);
    }

    cycle();
  }

  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach((el) => obs.observe(el));
  }

  function initMobileNav() {
    const toggle = document.getElementById('nav-mobile-toggle');
    const drawer = document.getElementById('mobile-nav');
    const close = document.getElementById('mobile-nav-close');

    toggle?.addEventListener('click', () => drawer?.classList.add('open'));
    close?.addEventListener('click', () => drawer?.classList.remove('open'));
    drawer?.addEventListener('click', (e) => {
      if (e.target === drawer) drawer.classList.remove('open');
    });
    drawer?.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => drawer.classList.remove('open'));
    });
  }

  function initPins() {
    const sections = Array.from(document.querySelectorAll('[data-pin]'));
    if (!sections.length) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pins = [];
    let ticking = false;

    function update() {
      ticking = false;
      pins.forEach((p) => {
        const rect = p.section.getBoundingClientRect();
        const scrolled = Math.min(Math.max(-rect.top, 0), p.distance);
        p.track.style.transform = 'translate3d(' + (-scrolled) + 'px,0,0)';
        if (p.fill) {
          p.fill.style.width = (p.distance ? (scrolled / p.distance) * 100 : 0) + '%';
        }
      });
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    function build() {
      // reset
      pins.forEach((p) => {
        p.section.style.height = '';
        p.section.classList.remove('is-pinned');
        p.track.style.transform = '';
      });
      pins = [];

      const enable = window.innerWidth >= 900 && !reduce;

      sections.forEach((section) => {
        const viewport = section.querySelector('.pin-viewport');
        const track = section.querySelector('.pin-track');
        const fill = section.querySelector('.pin-progress-fill');
        if (!viewport || !track || !enable) return;

        section.classList.add('is-pinned');
        const distance = Math.max(0, track.scrollWidth - viewport.clientWidth);
        section.style.height = (window.innerHeight + distance) + 'px';
        pins.push({ section, track, fill, distance });
      });

      update();
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(build, 150);
    });

    // Rebuild after fonts/images settle
    build();
    window.addEventListener('load', build);
    setTimeout(build, 400);
  }

  function initExtensionButtons() {
    document.querySelectorAll('[data-install-ext]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        installExtension();
      });
    });
  }

  // Boot
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  if (window.WriteAIApi?.getToken()) {
    location.href = '/app';
  }

  initHeroTyping();
  initReveal();
  initMobileNav();
  initExtensionButtons();
  initPins();
})();
