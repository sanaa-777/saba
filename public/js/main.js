/* ============================================
   Awtar - Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', function() {

  // ============================================
  // Language Switcher
  // ============================================
  const langToggle = document.getElementById('langToggle');
  const langDropdown = document.getElementById('langDropdown');
  if (langToggle && langDropdown) {
    langToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      langDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => langDropdown.classList.remove('open'));
  }

  // ============================================
  // Comment Form
  // ============================================
  const commentForm = document.getElementById('commentForm');
  if (commentForm) {
    commentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('commentMessage');
      const formData = new FormData(commentForm);
      const data = Object.fromEntries(formData);
      
      try {
        const res = await fetch('/api/comments/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await res.json();
        msg.style.display = 'block';
        msg.textContent = result.message;
        msg.className = 'comment-message ' + (result.success ? 'success' : 'error');
        if (result.success) commentForm.reset();
      } catch (err) {
        msg.style.display = 'block';
        msg.textContent = 'حدث خطأ';
        msg.className = 'comment-message error';
      }
    });
  }

  // ============================================
  // Poll Voting
  // ============================================
  document.querySelectorAll('.poll-vote-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const pollId = this.dataset.poll;
      const optionId = this.dataset.option;
      
      try {
        const res = await fetch('/api/polls/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poll_id: pollId, option_id: optionId })
        });
        const result = await res.json();
        
        if (result.success) {
          // Update UI
          const widget = document.getElementById('pollWidget');
          if (widget) {
            const options = widget.querySelectorAll('.poll-option');
            options.forEach((opt, i) => {
              if (result.options[i]) {
                const pct = result.totalVotes > 0 ? Math.round(result.options[i].votes / result.totalVotes * 100) : 0;
                opt.querySelector('.poll-bar-fill').style.width = pct + '%';
                opt.querySelector('.poll-percent').textContent = pct + '% (' + result.options[i].votes + ')';
                opt.querySelector('.poll-vote-btn').classList.add('voted');
                opt.querySelector('.poll-vote-btn').disabled = true;
              }
            });
            document.getElementById('pollTotalVotes').textContent = result.totalVotes;
          }
        } else {
          alert(result.message);
        }
      } catch (err) {
        alert('حدث خطأ');
      }
    });
  });

  // ============================================
  // Newsletter Form
  // ============================================
  const newsletterForm = document.getElementById('newsletterForm');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('newsletterMessage');
      const email = newsletterForm.querySelector('input[name="email"]').value;
      
      try {
        const res = await fetch('/api/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const result = await res.json();
        if (msg) {
          msg.style.display = 'block';
          msg.textContent = result.message;
          msg.className = 'newsletter-message ' + (result.success ? 'success' : 'error');
        }
        if (result.success) newsletterForm.reset();
      } catch (err) {
        if (msg) {
          msg.style.display = 'block';
          msg.textContent = 'حدث خطأ';
          msg.className = 'newsletter-message error';
        }
      }
    });
  }

  // ============================================
  // Socket.IO - Real-time Breaking News
  // ============================================
  if (typeof io !== 'undefined') {
    const socket = io();
    socket.on('breaking-news', (data) => {
      const ticker = document.querySelector('.ticker-track');
      if (ticker && data.text) {
        const item = document.createElement('a');
        item.href = data.link || '#';
        item.className = 'ticker-item';
        item.textContent = data.text;
        ticker.prepend(item);
      }
    });

    // New news counter
    socket.on('new-news', (data) => {
      const counter = document.querySelector('.new-news-count');
      if (counter) {
        counter.textContent = data.count;
        counter.style.display = 'inline-block';
      }
    });
  }

  // ============================================
  // Mobile Navigation
  // ============================================
  const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
  const mobileNav = document.getElementById('mobileNav');
  const mobileNavOverlay = document.getElementById('mobileNavOverlay');
  const mobileNavClose = document.querySelector('.mobile-nav-close');

  function openMobileNav() {
    if (mobileNav) mobileNav.classList.add('open');
    if (mobileNavOverlay) mobileNavOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileNav() {
    if (mobileNav) mobileNav.classList.remove('open');
    if (mobileNavOverlay) mobileNavOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (mobileMenuToggle) mobileMenuToggle.addEventListener('click', openMobileNav);
  if (mobileNavClose) mobileNavClose.addEventListener('click', closeMobileNav);
  if (mobileNavOverlay) mobileNavOverlay.addEventListener('click', closeMobileNav);

  // ============================================
  // Sidebar Tabs
  // ============================================
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const tabId = this.getAttribute('data-tab');
      const parent = this.closest('.sidebar-widget');
      if (!parent) return;
      parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      const content = parent.querySelector('#tab-' + tabId);
      if (content) content.classList.add('active');
    });
  });

  // ============================================
  // Main Slider
  // ============================================
  const slides = document.querySelectorAll('.slide');
  const dots = document.querySelectorAll('.dot');
  const thumbnails = document.querySelectorAll('.thumbnail');
  const prevBtn = document.querySelector('.slider-prev');
  const nextBtn = document.querySelector('.slider-next');
  let currentSlide = 0;
  let slideInterval;

  function goToSlide(index) {
    if (slides.length === 0) return;
    slides.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));
    thumbnails.forEach(t => t.classList.remove('active'));
    currentSlide = ((index % slides.length) + slides.length) % slides.length;
    if (slides[currentSlide]) slides[currentSlide].classList.add('active');
    if (dots[currentSlide]) dots[currentSlide].classList.add('active');
    if (thumbnails[currentSlide]) thumbnails[currentSlide].classList.add('active');
  }

  function nextSlide() { goToSlide(currentSlide + 1); }
  function prevSlide() { goToSlide(currentSlide - 1); }

  function startSlider() {
    if (slides.length > 1) {
      slideInterval = setInterval(nextSlide, 5000);
    }
  }

  function stopSlider() {
    clearInterval(slideInterval);
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => { stopSlider(); prevSlide(); startSlider(); });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => { stopSlider(); nextSlide(); startSlider(); });
  }

  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => { stopSlider(); goToSlide(i); startSlider(); });
  });

  thumbnails.forEach((thumb, i) => {
    thumb.addEventListener('click', () => { stopSlider(); goToSlide(i); startSlider(); });
  });

  startSlider();

  // ============================================
  // Breaking News Ticker Pause on Hover
  // ============================================
  const tickerTrack = document.querySelector('.ticker-track');
  if (tickerTrack) {
    tickerTrack.addEventListener('mouseenter', () => {
      tickerTrack.style.animationPlayState = 'paused';
    });
    tickerTrack.addEventListener('mouseleave', () => {
      tickerTrack.style.animationPlayState = 'running';
    });
  }

  // ============================================
  // Lazy Loading Images
  // ============================================
  if ('IntersectionObserver' in window) {
    const lazyImages = document.querySelectorAll('img[loading="lazy"]');
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          imageObserver.unobserve(img);
        }
      });
    });
    lazyImages.forEach(img => imageObserver.observe(img));
  }

  // ============================================
  // View Counter (track article views)
  // ============================================
  const articlePage = document.querySelector('.article-page');
  if (articlePage) {
    const articleId = window.location.pathname.split('/').pop();
    const viewedKey = 'viewed_' + articleId;
    if (!sessionStorage.getItem(viewedKey)) {
      sessionStorage.setItem(viewedKey, '1');
    }
  }

  // ============================================
  // Smooth scroll to top
  // ============================================
  const scrollTopBtn = document.createElement('button');
  scrollTopBtn.innerHTML = '↑';
  scrollTopBtn.className = 'scroll-top-btn';
  scrollTopBtn.style.cssText = `
    position: fixed; bottom: 30px; left: 30px;
    width: 45px; height: 45px; border-radius: 50%;
    background: var(--primary, #1a237e); color: #fff;
    border: none; font-size: 20px; cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    opacity: 0; visibility: hidden; transition: all 0.3s;
    z-index: 999; display: flex; align-items: center; justify-content: center;
  `;
  document.body.appendChild(scrollTopBtn);

  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      scrollTopBtn.style.opacity = '1';
      scrollTopBtn.style.visibility = 'visible';
    } else {
      scrollTopBtn.style.opacity = '0';
      scrollTopBtn.style.visibility = 'hidden';
    }
  });

  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ============================================
  // Date display (Hijri + Gregorian)
  // ============================================
  function updateDates() {
    const gregorianEl = document.querySelector('.date-gregorian');
    const hijriEl = document.querySelector('.date-hijri');
    if (gregorianEl) {
      const now = new Date();
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      gregorianEl.textContent = now.toLocaleDateString('ar-YE', options);
    }
    if (hijriEl) {
      try {
        const now = new Date();
        const hijriDate = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }).format(now);
        hijriEl.textContent = hijriDate;
      } catch (e) {
        if (hijriEl) hijriEl.textContent = '';
      }
    }
  }
  updateDates();

  // ============================================
  // Print article
  // ============================================
  const printBtn = document.querySelector('.share-btn.print');
  if (printBtn) {
    printBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.print();
    });
  }

  // ============================================
  // Newsletter form
  // ============================================
  const newsletterForm = document.querySelector('.newsletter-form');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = newsletterForm.querySelector('input[type="email"]');
      if (email && email.value) {
        alert('شكراً لاشتراكك في النشرة البريدية!');
        email.value = '';
      }
    });
  }

  // ============================================
  // Search form enhancements
  // ============================================
  const searchInput = document.querySelector('.header-search input');
  if (searchInput) {
    searchInput.addEventListener('focus', () => {
      searchInput.parentElement.style.borderColor = 'var(--primary, #1a237e)';
    });
    searchInput.addEventListener('blur', () => {
      searchInput.parentElement.style.borderColor = '';
    });
  }

  // ============================================
  // Keyboard navigation for slider
  // ============================================
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { stopSlider(); nextSlide(); startSlider(); }
    if (e.key === 'ArrowRight') { stopSlider(); prevSlide(); startSlider(); }
  });

  // ============================================
  // Touch swipe for slider
  // ============================================
  const sliderContainer = document.querySelector('.slider-container');
  if (sliderContainer) {
    let touchStartX = 0;
    let touchEndX = 0;

    sliderContainer.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    sliderContainer.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      const diff = touchStartX - touchEndX;
      if (Math.abs(diff) > 50) {
        stopSlider();
        if (diff > 0) nextSlide();
        else prevSlide();
        startSlider();
      }
    }, { passive: true });
  }

  // ============================================
  // Auto-hide breaking news on scroll
  // ============================================
  const ticker = document.querySelector('.breaking-news-ticker');
  if (ticker) {
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
      const currentScroll = window.scrollY;
      if (currentScroll > 200) {
        ticker.style.transform = 'translateY(-100%)';
        ticker.style.transition = 'transform 0.3s ease';
      } else {
        ticker.style.transform = 'translateY(0)';
      }
      lastScroll = currentScroll;
    });
  }

  // ============================================
  // Active nav link
  // ============================================
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('active');
    }
  });

  // ============================================
  // Fade in animations
  // ============================================
  const observerOptions = { threshold: 0.1, rootMargin: '0px 0px -50px 0px' };
  const fadeObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('fade-in');
        fadeObserver.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.section-block, .news-card, .featured-card').forEach(el => {
    el.style.opacity = '0';
    fadeObserver.observe(el);
  });

});
