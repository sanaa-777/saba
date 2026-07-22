document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const body = document.body;

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  /* ============================================
     Theme mode
     ============================================ */
  const savedTheme = localStorage.getItem('awtar-theme');
  const preferredDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const applyTheme = (theme) => {
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
  };
  applyTheme(savedTheme || (preferredDark ? 'dark' : 'light'));

  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const nextTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('awtar-theme', nextTheme);
      applyTheme(nextTheme);
    });
  }

  /* ============================================
     Language switcher
     ============================================ */
  const langToggle = $('#langToggle');
  const langDropdown = $('#langDropdown');
  if (langToggle && langDropdown) {
    langToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      langDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => langDropdown.classList.remove('open'));
  }

  /* ============================================
     Mobile Slide Panel
     ============================================ */
  const mobilePanel = $('#mobilePanel');
  const mobilePanelOverlay = $('#mobilePanelOverlay');
  const mobileMenuBtn = $('#mobileMenuBtn');
  const mobilePanelClose = $('#mobilePanelClose');

  const openPanel = () => {
    if (!mobilePanel) return;
    mobilePanel.classList.add('active');
    mobilePanelOverlay?.classList.add('active');
    body.style.overflow = 'hidden';
  };

  const closePanel = () => {
    mobilePanel?.classList.remove('active');
    mobilePanelOverlay?.classList.remove('active');
    body.style.overflow = '';
  };

  mobileMenuBtn?.addEventListener('click', openPanel);
  mobilePanelClose?.addEventListener('click', closePanel);
  mobilePanelOverlay?.addEventListener('click', closePanel);
  $$('#mobilePanel a').forEach((link) => link.addEventListener('click', closePanel));

  /* ============================================
     Mobile Theme Toggle
     ============================================ */
  const mobileThemeBtn = $('#mobileThemeBtn');
  mobileThemeBtn?.addEventListener('click', () => {
    const isDark = root.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('awtar-theme', newTheme);
  });

  /* ============================================
     Date display
     ============================================ */
  const updateDates = () => {
    const gregorianEl = $('.date-gregorian');
    const hijriEl = $('.date-hijri');
    const now = new Date();

    if (gregorianEl) {
      gregorianEl.textContent = now.toLocaleDateString('ar-YE', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    }

    if (hijriEl) {
      try {
        hijriEl.textContent = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }).format(now);
      } catch (error) {
        hijriEl.textContent = '';
      }
    }
  };
  updateDates();

  /* ============================================
     Sidebar tabs
     ============================================ */
  $$('.sidebar-widget').forEach((widget) => {
    const tabs = $$('.tab-btn', widget);
    if (!tabs.length) return;

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;
        tabs.forEach((item) => item.classList.remove('active'));
        $$('.tab-content', widget).forEach((panel) => panel.classList.remove('active'));
        tab.classList.add('active');
        $(`#tab-${tabId}`, widget)?.classList.add('active');
      });
    });
  });

  /* ============================================
     Smooth scroll top button
     ============================================ */
  const scrollTopBtn = document.createElement('button');
  scrollTopBtn.className = 'scroll-top-btn';
  scrollTopBtn.setAttribute('aria-label', 'العودة إلى الأعلى');
  scrollTopBtn.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 19V5"></path>
      <path d="m5 12 7-7 7 7"></path>
    </svg>
  `;
  body.appendChild(scrollTopBtn);

  const toggleScrollTop = () => {
    scrollTopBtn.classList.toggle('visible', window.scrollY > 340);
  };
  toggleScrollTop();
  window.addEventListener('scroll', toggleScrollTop, { passive: true });
  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ============================================
     Comment form
     ============================================ */
  const commentForm = $('#commentForm');
  if (commentForm) {
    commentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = $('#commentMessage');
      const submitBtn = $('button[type="submit"]', commentForm);
      const formData = new FormData(commentForm);
      const payload = Object.fromEntries(formData.entries());

      submitBtn?.setAttribute('disabled', 'disabled');
      if (message) {
        message.style.display = 'none';
        message.textContent = '';
      }

      try {
        const response = await fetch('/api/comments/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (message) {
          message.style.display = 'block';
          message.textContent = result.message || 'تم إرسال التعليق.';
          message.className = `comment-message ${result.success ? 'success' : 'error'}`;
        }
        if (result.success) commentForm.reset();
      } catch (error) {
        if (message) {
          message.style.display = 'block';
          message.textContent = 'تعذر إرسال التعليق حالياً.';
          message.className = 'comment-message error';
        }
      } finally {
        submitBtn?.removeAttribute('disabled');
      }
    });
  }

  /* ============================================
     Newsletter forms
     ============================================ */
  const bindNewsletterForm = (form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const emailInput = $('input[name="email"]', form);
      const message = form.parentElement?.querySelector('.newsletter-message') || $('#newsletterMessage');
      const submitBtn = $('button[type="submit"]', form);
      const email = emailInput?.value?.trim();
      if (!email) return;

      submitBtn?.setAttribute('disabled', 'disabled');
      try {
        const response = await fetch('/api/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const result = await response.json();
        if (message) {
          message.style.display = 'block';
          message.textContent = result.message || 'تم استلام طلب الاشتراك.';
          message.className = `newsletter-message ${result.success ? 'success' : 'error'}`;
        }
        if (result.success) form.reset();
      } catch (error) {
        if (message) {
          message.style.display = 'block';
          message.textContent = 'تعذر تنفيذ الاشتراك حالياً.';
          message.className = 'newsletter-message error';
        }
      } finally {
        submitBtn?.removeAttribute('disabled');
      }
    });
  };
  $$('.newsletter-form').forEach(bindNewsletterForm);

  /* ============================================
     Poll voting
     ============================================ */
  $$('.poll-vote-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const pollId = button.dataset.poll;
      const optionId = button.dataset.option;
      const widget = $('#pollWidget');
      if (!pollId || !optionId || !widget) return;

      $$('.poll-vote-btn', widget).forEach((btn) => btn.setAttribute('disabled', 'disabled'));

      try {
        const response = await fetch('/api/polls/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poll_id: pollId, option_id: optionId })
        });
        const result = await response.json();

        if (!result.success) {
          alert(result.message || 'تعذر تسجيل التصويت.');
          $$('.poll-vote-btn', widget).forEach((btn) => btn.removeAttribute('disabled'));
          return;
        }

        const options = Array.isArray(result.options) ? result.options : [];
        const totalVotes = result.totalVotes || 0;
        $$('.poll-option', widget).forEach((optionEl, index) => {
          const option = options[index];
          if (!option) return;
          const percentage = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
          const fill = $('.poll-bar-fill', optionEl);
          const text = $('.poll-percent', optionEl);
          fill && (fill.style.width = `${percentage}%`);
          text && (text.textContent = `${percentage}% (${option.votes})`);
          const voteBtn = $('.poll-vote-btn', optionEl);
          voteBtn?.classList.add('voted');
          voteBtn?.setAttribute('disabled', 'disabled');
        });
        const totalEl = $('#pollTotalVotes');
        if (totalEl) totalEl.textContent = String(totalVotes);
      } catch (error) {
        alert('حدث خطأ أثناء تسجيل التصويت.');
        $$('.poll-vote-btn', widget).forEach((btn) => btn.removeAttribute('disabled'));
      }
    });
  });

  /* ============================================
     Share / print actions
     ============================================ */
  $('.share-btn.print')?.addEventListener('click', (event) => {
    event.preventDefault();
    window.print();
  });

  /* ============================================
     Simple reveal animation
     ============================================ */
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });

    $$('.story-card, .news-list-item, .sidebar-widget, .cat-section, .media-card, .article-page, .section-panel').forEach((element) => {
      element.style.opacity = '0';
      element.style.transform = 'translateY(12px)';
      element.style.transition = 'opacity 420ms ease, transform 420ms ease';
      observer.observe(element);
    });
  }

  /* ============================================
     Generic media modal helpers
     ============================================ */
  const videoModal = $('#videoModal');
  const imageModal = $('#imageModal');

  const closeModal = (modal) => {
    if (!modal) return;
    modal.classList.remove('open');
    body.classList.remove('modal-open');
    const video = $('video', modal);
    if (video) {
      video.pause();
      const source = $('source', video);
      if (source) source.src = '';
      video.load();
    }
    const image = $('img', modal);
    if (image) image.src = '';
  };

  window.openVideoModal = (src, title = '') => {
    if (!videoModal) return;
    const video = $('video', videoModal);
    const source = $('source', video);
    const titleEl = $('.media-modal-title', videoModal) || $('#globalVideoTitle') || $('#videoTitle');
    if (source) source.src = src;
    if (video) video.load();
    if (titleEl) titleEl.textContent = title;
    videoModal.classList.add('open');
    body.classList.add('modal-open');
  };

  window.closeVideoModal = () => closeModal(videoModal);

  window.openImageModal = (src, title = '') => {
    if (!imageModal) return;
    const image = $('img', imageModal);
    const titleEl = $('.media-modal-title', imageModal) || $('#globalModalTitle') || $('#modalTitle');
    if (image) image.src = src;
    if (titleEl) titleEl.textContent = title;
    imageModal.classList.add('open');
    body.classList.add('modal-open');
  };

  window.closeImageModal = () => closeModal(imageModal);

  [videoModal, imageModal].forEach((modal) => {
    if (!modal) return;
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
    $('.media-modal-close', modal)?.addEventListener('click', () => closeModal(modal));
  });

  /* ============================================
     Live News Checker — polls for new articles every 2 minutes
     ============================================ */
  let lastCheckedAt = new Date().toISOString();
  const newsCheckerInterval = 120000; // 2 minutes

  function checkForNewNews() {
    fetch(`/api/new-news-count?since=${encodeURIComponent(lastCheckedAt)}`)
      .then(r => r.json())
      .then(data => {
        if (data.count > 0) {
          showNewNewsBanner(data.count);
        }
        lastCheckedAt = new Date().toISOString();
      })
      .catch(() => {});
  }

  function showNewNewsBanner(count) {
    // Remove existing banner
    const existing = document.querySelector('.new-news-banner');
    if (existing) existing.remove();

    const banner = document.createElement('a');
    banner.href = '/';
    banner.className = 'new-news-banner';
    banner.innerHTML = `<span class="new-news-dot"></span> ${count} خبر جديد — اضغط للتحديث`;
    banner.style.cssText = `
      position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;
      background:linear-gradient(135deg,#1a237e,#0d47a1);color:#fff;
      padding:10px 24px;border-radius:0 0 12px 12px;font-size:14px;font-weight:600;
      font-family:inherit;text-decoration:none;display:flex;align-items:center;gap:8px;
      box-shadow:0 4px 20px rgba(0,0,0,0.3);animation:slideDown 300ms ease;
    `;
    document.body.appendChild(banner);

    // Auto-hide after 15 seconds
    setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transition = 'opacity 300ms ease';
      setTimeout(() => banner.remove(), 300);
    }, 15000);
  }

  // Start checking only on homepage
  if (window.location.pathname === '/') {
    setInterval(checkForNewNews, newsCheckerInterval);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal(videoModal);
      closeModal(imageModal);
      closeNav();
      langDropdown?.classList.remove('open');
    }
  });
});

/* ============================================
   Video & YouTube Auto-Embed
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Auto-embed YouTube links in article content
  document.querySelectorAll('.article-content a, .article-content p').forEach(el => {
    const text = el.textContent || el.href || '';
    const ytMatch = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      const videoId = ytMatch[1];
      const embed = document.createElement('div');
      embed.className = 'video-embed';
      embed.innerHTML = '<iframe src="https://www.youtube.com/embed/' + videoId + '" allowfullscreen loading="lazy"></iframe>';
      el.parentNode.replaceChild(embed, el);
    }
  });

  // Handle video elements with custom play button
  document.querySelectorAll('.video-container').forEach(container => {
    const video = container.querySelector('video');
    const btn = container.querySelector('.video-play-btn');
    if (video && btn) {
      btn.addEventListener('click', () => {
        video.play();
        btn.style.display = 'none';
      });
      video.addEventListener('pause', () => { btn.style.display = 'flex'; });
      video.addEventListener('ended', () => { btn.style.display = 'flex'; });
    }
  });

  // Handle broken images - hide them gracefully
  document.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', function() {
      this.style.display = 'none';
      // If parent is only child, hide parent too
      if (this.parentNode && this.parentNode.children.length === 1) {
        if (this.parentNode.tagName === 'A') {
          this.parentNode.style.display = 'none';
        }
      }
    });
  });

  // Lazy load images with IntersectionObserver
  if ('IntersectionObserver' in window) {
    const imgObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          imgObserver.unobserve(img);
        }
      });
    }, { rootMargin: '200px' });

    document.querySelectorAll('img[data-src]').forEach(img => imgObserver.observe(img));
  }
});

// Copy link to clipboard
function copyLink() {
  const url = window.location.href;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('تم نسخ الرابط');
    }).catch(() => {
      fallbackCopy(url);
    });
  } else {
    fallbackCopy(url);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showToast('تم نسخ الرابط');
}

function showToast(msg) {
  const existing = document.querySelector('.copy-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a237e;color:#fff;padding:10px 24px;border-radius:8px;font-size:14px;font-family:inherit;z-index:9999;animation:slideUp 300ms ease;';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 300ms'; setTimeout(() => toast.remove(), 300); }, 2000);
}
