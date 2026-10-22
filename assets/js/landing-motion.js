// Landing page scroll motion, on GSAP and ScrollTrigger (assets/js/vendor).
// One effect: the words of each section's title and lead start dim and light up one
// after another as the section scrolls into view. The pinned Features title is plain CSS
// (position: sticky), so it needs no script. Everything here sits behind
// prefers-reduced-motion: no-preference; with reduced motion nothing is dimmed or moved
// and the page is its static end state.
(() => {
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);

  // Wrap each word of a text node in a span. The copy and its order are unchanged, so
  // assistive technology reads the same sentence.
  const splitWords = element => {
    const words = [];
    const walk = node => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          if (!child.textContent.trim()) return;
          const fragment = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { fragment.append(part); return; }
            const span = document.createElement('span');
            span.className = 'tm-w';
            span.textContent = part;
            words.push(span);
            fragment.append(span);
          });
          child.replaceWith(fragment);
        } else if (child.nodeType === Node.ELEMENT_NODE && !child.hidden) {
          walk(child);
        }
      });
    };
    walk(element);
    return words;
  };

  const motion = gsap.matchMedia();
  motion.add('(prefers-reduced-motion: no-preference)', () => {
    const targets = document.querySelectorAll('.section .section-title, .section .lead, .hx-cta .section-title:not([hidden]), .hx-cta .hx-lead:not([hidden])');
    const triggers = [];
    targets.forEach(element => {
      const words = splitWords(element);
      if (!words.length) return;
      const tween = gsap.fromTo(words, { opacity: 0.14 }, {
        opacity: 1, ease: 'none', stagger: 0.12,
        scrollTrigger: { trigger: element, start: 'top 88%', end: 'bottom 52%', scrub: 0.6 },
      });
      triggers.push(tween);
    });
    // Reduced motion (or leaving this mode) puts every word back to full opacity.
    return () => {
      triggers.forEach(tween => { tween.scrollTrigger?.kill(); tween.kill(); });
      document.querySelectorAll('.tm-w').forEach(word => { word.style.opacity = ''; });
    };
  });

  // Images and fonts move the sections, so the trigger positions are measured again.
  window.addEventListener('load', () => ScrollTrigger.refresh());
  if (document.fonts?.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
