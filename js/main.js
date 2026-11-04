/**
 * ===================================================================
 * MẪU 1 · FLYTHROUGH — liên kết trang
 * Bộ chọn ngôn ngữ, bản đồ Leaflet, đo mốc cảnh, một vòng rAF duy nhất,
 * chế độ dự phòng (giảm chuyển động / không WebGL / tắt JS).
 * ===================================================================
 */
(function () {
  'use strict';

  var SCENE_IDS = ['hero', 'origins', 'challenge', 'core', 'evolution', 'epilogue'];
  var NAV_IDS = ['origins', 'challenge', 'core', 'evolution'];

  var stations = [];   // {id, top, height}
  var vh = 0;
  var fly = null;      // FlyScene
  var rafId = 0;
  var lastT = 0;
  var currentScene = '';
  var reduceMotion = false;

  document.addEventListener('DOMContentLoaded', boot);

  function boot() {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) document.documentElement.classList.add('reduced');

    initLanguageSelector();
    initReveal();
    initMap();
    initFlythrough();
  }

  /* ===================================================================
     Bộ chọn ngôn ngữ (giữ nguyên văn từ docs/original/main.js, chỉ đổi
     URL đã xuất bản sang URL của repo mẫu này)
     =================================================================== */
  function initLanguageSelector() {
    const selector = document.getElementById('language-select');
    if (!selector) return;

    // GitHub Pages project URL used when the site is opened from a local preview.
    const publishedUrl = 'https://musual-moncra.github.io/svthm-flythrough/';
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

  /* ===================================================================
     Hiển thị dần nội dung khi vào khung nhìn (không bắt buộc để đọc)
     =================================================================== */
  function initReveal() {
    var elements = document.querySelectorAll('.story-chapter [data-story-reveal], #epilogue [data-story-reveal]');
    if (!elements.length || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var observer = new IntersectionObserver(function (entries, activeObserver) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('story-entry-visible');
        activeObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    Array.prototype.forEach.call(elements, function (element) { observer.observe(element); });
  }

  /* ===================================================================
     Bản đồ "ĐỊA ĐIỂM · PHÚ HÒA ĐÔNG" — theo docs/original/region-map.js.
     Khác biệt duy nhất theo DESIGN.md: cuộn chuột phải cuộn trang,
     không zoom bản đồ (scrollWheelZoom: false).
     =================================================================== */
  function initMap() {
    var element = document.getElementById('origin-leaflet-map');
    if (!element || typeof window.L === 'undefined') return;

    var center = [11.0309829, 106.565394];
    var mapBounds = window.L.latLngBounds([11.018, 106.552], [11.044, 106.579]);
    var map = window.L.map(element, {
      center: center,
      zoom: 16,
      minZoom: 15,
      maxZoom: 17,
      maxBounds: mapBounds,
      maxBoundsViscosity: 1,
      bounceAtZoomLimits: false,
      zoomControl: true,
      scrollWheelZoom: false,
      doubleClickZoom: true,
      keyboard: true,
      worldCopyJump: false
    });

    window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      minZoom: 15,
      maxZoom: 17,
      noWrap: true,
      attribution: 'Imagery &copy; <a href="https://www.esri.com/en-us/legal/terms/web-site-service">Esri</a>, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community.'
    }).addTo(map);

    window.L.circle(center, {
      radius: 240,
      color: '#168449',
      weight: 2,
      fillColor: '#55ad73',
      fillOpacity: 0.1,
      interactive: false,
      className: 'map-focus-boundary'
    }).addTo(map);

    window.L.marker(center, {
      interactive: false,
      keyboard: false,
      icon: window.L.divIcon({
        className: 'map-pulse-icon',
        html: '<span class="map-pulse-ring"><i></i></span>',
        iconSize: [126, 126],
        iconAnchor: [63, 63]
      })
    }).addTo(map);

    window.L.circleMarker(center, {
      radius: 6,
      color: '#ffffff',
      weight: 3,
      fillColor: '#138249',
      fillOpacity: 1,
      interactive: false
    }).addTo(map);

    map.setMaxBounds(mapBounds);
    window.addEventListener('resize', function () { map.invalidateSize({ pan: false }); });
  }

  /* ===================================================================
     FLYTHROUGH — đo mốc, một vòng rAF duy nhất, dừng khi tab ẩn
     =================================================================== */
  function initFlythrough() {
    var canvas = document.getElementById('fly-canvas');
    var threeReady = typeof THREE !== 'undefined' && typeof window.FlyScene === 'object';

    measure();

    if (!reduceMotion && threeReady && canvas) {
      try {
        var ok = window.FlyScene.init(canvas, { phone: isPhone() });
        if (ok) {
          fly = window.FlyScene;
          document.documentElement.classList.add('fly-3d');
          startLoop();
        }
      } catch (err) {
        fly = null;
      }
    }

    if (!fly) document.documentElement.classList.add('no-webgl');

    // Đo lại khi thay đổi kích thước, khi ảnh/font tải xong
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('orientationchange', scheduleMeasure);
    window.addEventListener('load', scheduleMeasure);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scheduleMeasure).catch(function () {});
    }
  }

  function isPhone() {
    return window.innerWidth <= 720 ||
      (window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 1024);
  }

  var measureQueued = false;
  function scheduleMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    (window.requestAnimationFrame)(function () {
      measureQueued = false;
      measure();
    });
  }

  function measure() {
    vh = window.innerHeight || 1;
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
    stations = SCENE_IDS.map(function (id) {
      var el = document.getElementById(id);
      if (!el) return { id: id, top: 0, height: 0 };
      var rect = el.getBoundingClientRect();
      return { id: id, top: rect.top + scrollTop, height: rect.height };
    });
  }

  /* Tiến trình trạm:
     - trong đoạn đọc của cảnh i → prog = i (cam giữ cố định), sub = % đọc
     - trong khoảng bay giữa hai cảnh → prog = i + frac, paused = false     */
  function computeState(y) {
    if (!stations.length) return { id: 'hero', prog: 0, paused: true, sub: 0 };

    for (var i = 0; i < stations.length; i++) {
      var st = stations[i];
      var pauseEnd = st.top + Math.max(st.height - vh, 0);

      if (i === 0 && y < st.top) {
        // đầu trang: dừng ở cảnh 0
        return { id: st.id, prog: 0, paused: true, sub: 0 };
      }

      if (y >= st.top && y <= Math.max(pauseEnd, st.top)) {
        // đang đọc cảnh i
        var span = Math.max(pauseEnd - st.top, 1);
        var sub = (pauseEnd > st.top + 1) ? (y - st.top) / span : 0;
        return { id: st.id, prog: i, paused: true, sub: Math.min(Math.max(sub, 0), 1) };
      }

      if (y < st.top && i > 0) {
        // chưa tới cảnh i: giai đoạn bay giữa hai cảnh
        var prev = stations[i - 1];
        var prevPauseEnd = prev.top + Math.max(prev.height - vh, 0);
        var gapLen = Math.max(st.top - prevPauseEnd, 700);
        var frac = (y - prevPauseEnd) / gapLen;
        frac = Math.min(Math.max(frac, 0), 1);
        return { id: prev.id, prog: (i - 1) + frac, paused: false, sub: 1 };
      }
    }

    // cuối trang: cảnh 5 giữ đến hết
    var last = stations[stations.length - 1];
    var lastPauseEnd = last.top + Math.max(last.height - vh, 0);
    if (y > lastPauseEnd) {
      return { id: last.id, prog: stations.length - 1, paused: true, sub: 1 };
    }
    return { id: last.id, prog: stations.length - 1, paused: true, sub: 1 };
  }

  function applyBeats(state) {
    var mapFrame = document.getElementById('origin-leaflet-map');
    if (mapFrame) {
      mapFrame.classList.toggle('is-mapped', state.id === 'origins' && state.paused && state.sub > 0.8);
    }
    var thumbs = document.querySelectorAll('.challenge-photo-thumb');
    var thresholds = [0.26, 0.52, 0.78];
    Array.prototype.forEach.call(thumbs, function (fig, k) {
      var lit = state.id === 'challenge' && state.paused && state.sub > thresholds[k];
      fig.classList.toggle('is-lit', lit);
    });
    var pillar = document.querySelector('.mission-pillars .glass-card[data-pillar="2"]');
    if (pillar) {
      pillar.classList.toggle('is-band', state.id === 'core' && state.paused && state.sub > 0.85);
    }
  }

  function setNavActive(id) {
    if (currentScene === id) return;
    currentScene = id;
    var links = document.querySelectorAll('.nav-chapters a, .mobile-chapter-links a');
    Array.prototype.forEach.call(links, function (link) {
      var href = link.getAttribute('href') || '';
      var isActive = href === '#' + id;
      link.classList.toggle('active', isActive);
      if (isActive) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  function startLoop() {
    stopLoop();
    lastT = performance.now();
    rafId = window.requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function tick(t) {
    rafId = window.requestAnimationFrame(tick);
    var dt = Math.min(0.05, Math.max(0.001, (t - lastT) / 1000));
    lastT = t;

    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var state = computeState(y);
    setNavActive(state.id);
    applyBeats(state);

    if (fly) {
      fly.update(dt, { prog: state.prog, paused: state.paused, sub: state.sub });
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (!fly) return;
    if (document.hidden) {
      stopLoop();
    } else {
      scheduleMeasure();
      startLoop();
    }
  });
})();
