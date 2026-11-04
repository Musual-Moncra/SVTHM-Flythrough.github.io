/**
 * ===================================================================
 * MAIN CLIENT SCRIPT
 * Lenis Smooth Scroll, GSAP Narrative ScrollTrigger, Custom Cursor,
 * Ambient Web Audio Synthesizer, and Dynamic Chapter Tracking
 * ===================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initLanguageSelector();

  // 1. Initialize Lenis Smooth Scroll
  let lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      direction: 'vertical',
      gestureDirection: 'vertical',
      smooth: true,
      mouseMultiplier: 1,
      smoothTouch: false,
      touchMultiplier: 2,
    });

    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
  }

  // 2. Initialize Three.js 3D Hero
  let hero3D = null;
  if (window.Hero3D) {
    hero3D = new Hero3D('hero-3d-canvas');
  }

  // 3. Setup GSAP & ScrollTrigger
  if (window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);

    // Sync Lenis with ScrollTrigger if Lenis exists
    if (lenis) {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => {
        lenis.raf(time * 1000);
      });
      gsap.ticker.lagSmoothing(0);
    }

    initScrollAnimations();
  }

  // 3a. Reveal the story chapters as they enter view.
  initStoryEntryAnimations();
  initVideoAutoplay();

  // 4. Top Scroll Progress Bar
  const progressBar = document.getElementById('scroll-progress-bar');
  window.addEventListener('scroll', () => {
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (totalHeight > 0) {
      const progress = (window.scrollY / totalHeight) * 100;
      if (progressBar) progressBar.style.width = `${progress}%`;
      if (hero3D) hero3D.updateScroll(window.scrollY / totalHeight);
    }
  }, { passive: true });

  // 5. Custom Cursor
  initCustomCursor();

  // 6. Chapter Active State Tracker
  initChapterTracker(lenis);

  // 7. Ambient Audio Synthesizer
  initAmbientSound();

  // 8. Template Guide Drawer Modal
  initGuideModal();
});

/** Translate the published page through Google's page translator when requested. */
function initLanguageSelector() {
  const selector = document.getElementById('language-select');
  if (!selector) return;

  // GitHub Pages project URL used when the site is opened from a local preview.
  const publishedUrl = 'https://musual-moncra.github.io/INT.github.io/';
  const currentUrl = /^https?:$/.test(window.location.protocol)
    ? window.location.href
    : publishedUrl;
  const sourceUrl = currentUrl.includes('translate.google.') ? publishedUrl : currentUrl;
  const parsedSource = new URL(sourceUrl);
  const currentLanguage = parsedSource.searchParams.get('int_lang');
  if (['en', 'ja', 'ko', 'zh-CN'].includes(currentLanguage)) selector.value = currentLanguage;
  parsedSource.searchParams.delete('int_lang');
  const originalUrl = parsedSource.href;

  selector.addEventListener('change', () => {
    const language = selector.value;
    if (language === 'vi') {
      window.location.assign(originalUrl);
      return;
    }

    const translatedSource = new URL(originalUrl);
    translatedSource.searchParams.set('int_lang', language);
    const translatorUrl = new URL('https://translate.google.com/translate');
    translatorUrl.searchParams.set('sl', 'vi');
    translatorUrl.searchParams.set('tl', language);
    translatorUrl.searchParams.set('u', translatedSource.href);
    window.location.assign(translatorUrl.href);
  });
}

/** Keep the white palette while letting visitors switch and remember theme. */
function initThemeToggle() {
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;

  const syncControl = () => {
    const isDark = root.dataset.theme === 'dark';
    const label = isDark ? 'Bật chế độ sáng' : 'Bật chế độ tối';
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  };

  syncControl();
  toggle.addEventListener('click', () => {
    const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = nextTheme;
    root.dataset.palette = 'white';
    syncControl();
    try {
      localStorage.setItem('int-theme', nextTheme);
    } catch (error) {
      // Theme switching still works for this page when storage is unavailable.
    }
  });
}

/**
 * Lightweight, one-time entrance animation for the story chapters.
 * Content remains visible by default; unsupported browsers and reduced-motion
 * preferences simply skip the animation.
 */
function initStoryEntryAnimations() {
  const elements = document.querySelectorAll('.story-chapter [data-story-reveal]');
  if (!elements.length || !('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const observer = new IntersectionObserver((entries, activeObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('story-entry-visible');
      activeObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  elements.forEach((element) => observer.observe(element));
}

/** Start the field video when it enters view without surprising visitors on load. */
function initVideoAutoplay() {
  const video = document.querySelector('.story-film video');
  if (!video || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Muted inline playback is required for autoplay in most mobile browsers.
  video.muted = true;
  video.defaultMuted = true;

  const playWhenVisible = () => {
    video.play().catch(() => {
      // Browser settings may block autoplay; native controls remain available.
    });
  };

  if (!('IntersectionObserver' in window)) {
    playWhenVisible();
    return;
  }

  const observer = new IntersectionObserver(([entry]) => {
    if (!entry) return;
    if (entry.isIntersecting) playWhenVisible();
    else video.pause();
  }, { threshold: 0.25 });

  observer.observe(video);
}

/**
 * Scroll Animations using GSAP
 */
function initScrollAnimations() {
  // Keep chapter content in normal document flow. Scroll-triggered `from`
  // tweens set opacity to zero before they run, which can leave whole sections
  // blank when a trigger is skipped, restored from a deep link, or delayed.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Animate only the opening hero. Story chapters remain visible without
  // depending on ScrollTrigger timing.
  const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  heroTl.from('.hero-meta-badge', { y: 20, opacity: 0, duration: 0.8, delay: 0.2 })
        .from('.hero-title', { y: 30, opacity: 0, duration: 1 }, '-=0.5')
        .from('.hero-subtitle', { y: 20, opacity: 0, duration: 0.8 }, '-=0.6')
        .from('.hero-3d-stage', { scale: 0.9, opacity: 0, duration: 1.2, ease: 'expo.out' }, '-=0.8')
        .from('.hero-cta-group', { y: 20, opacity: 0, duration: 0.8 }, '-=0.6')
        .from('.hero-scroll-cue', { opacity: 0, duration: 0.8 }, '-=0.4');
}

/**
 * Custom Interactive Cursor with Hover Magnification
 */
function initCustomCursor() {
  const dot = document.querySelector('.custom-cursor-dot');
  const ring = document.querySelector('.custom-cursor-ring');
  if (!dot || !ring) return;

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let ringX = mouseX;
  let ringY = mouseY;

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    dot.style.transform = `translate(${mouseX}px, ${mouseY}px)`;
  });

  function renderRing() {
    ringX += (mouseX - ringX) * 0.15;
    ringY += (mouseY - ringY) * 0.15;
    ring.style.transform = `translate(${ringX}px, ${ringY}px)`;
    requestAnimationFrame(renderRing);
  }
  renderRing();

  // Hover states on clickable items
  const hoverables = document.querySelectorAll('a, button, input, .glass-card, .hero-3d-canvas, .preset-btn');
  hoverables.forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
  });
}

/**
 * Chapter Active Tracker
 */
function initChapterTracker(lenis = null) {
  const chapters = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-chapters a, .mobile-chapter-links a');
  const mobileMenu = document.querySelector('.mobile-chapter-menu');

  function updateActive() {
    const scrollPos = window.scrollY + window.innerHeight * 0.35;
    const activeSection = [...chapters].find(section => {
      const id = section.id;
      const isNavigableChapter = [...navLinks].some(link => link.getAttribute('href') === `#${id}`);
      return isNavigableChapter && scrollPos >= section.offsetTop && scrollPos < section.offsetTop + section.offsetHeight;
    });
    navLinks.forEach(link => {
      const active = Boolean(activeSection && link.getAttribute('href') === `#${activeSection.id}`);
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  window.addEventListener('scroll', updateActive, { passive: true });
  updateActive();

  // Smooth scroll click handler
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const targetElem = document.querySelector(targetId);
      if (targetElem) {
        e.preventDefault();
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (lenis && !reduceMotion) lenis.scrollTo(targetElem, { offset: -parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-offset')) });
        else targetElem.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
      if (mobileMenu?.contains(this)) mobileMenu.open = false;
    });
  });
}

/**
 * Web Audio Ambient Tone Generator (Optional soothing sound)
 */
function initAmbientSound() {
  const soundBtn = document.getElementById('sound-toggle-btn');
  if (!soundBtn) return;

  let audioCtx = null;
  let isPlaying = false;
  let gainNode = null;
  let osc1 = null;
  let osc2 = null;

  soundBtn.addEventListener('click', () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    if (!isPlaying) {
      gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.04, audioCtx.currentTime + 1.5);
      gainNode.connect(audioCtx.destination);

      // Low soothing harmonic tone
      osc1 = audioCtx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(146.83, audioCtx.currentTime); // D3

      osc2 = audioCtx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(220.00, audioCtx.currentTime); // A3

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      osc1.start();
      osc2.start();

      isPlaying = true;
      soundBtn.classList.add('active');
      soundBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
        </svg>
      `;
      soundBtn.setAttribute('title', 'Mute Ambient Sound');
    } else {
      if (gainNode) {
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.8);
        setTimeout(() => {
          if (osc1) osc1.stop();
          if (osc2) osc2.stop();
        }, 850);
      }
      isPlaying = false;
      soundBtn.classList.remove('active');
      soundBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <line x1="23" y1="9" x2="17" y2="15"></line>
          <line x1="17" y1="9" x2="23" y2="15"></line>
        </svg>
      `;
      soundBtn.setAttribute('title', 'Play Ambient Sound');
    }
  });
}

/**
 * Interactive Guide Modal for User Content Customization
 */
function initGuideModal() {
  const guideToggle = document.getElementById('open-guide-btn');
  const guideClose = document.getElementById('close-guide-btn');
  const guideModal = document.getElementById('guide-modal');

  if (guideToggle && guideModal) {
    guideToggle.addEventListener('click', () => {
      guideModal.classList.remove('hidden');
    });
  }

  if (guideClose && guideModal) {
    guideClose.addEventListener('click', () => {
      guideModal.classList.add('hidden');
    });
  }

  if (guideModal) {
    guideModal.addEventListener('click', (e) => {
      if (e.target === guideModal) {
        guideModal.classList.add('hidden');
      }
    });
  }
}
