/* ═══════════════════════════════════════════════════════════════════
   SUPERSUITE — WEBSITE BUILDER ENGINE v1.0
   Full Phase 0–5 Implementation
   Password · Templates · Blocks · Drag & Drop · Editing · Export
═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ──────────────────────────────────────────────────────────────────
   STATE STORE — single source of truth
────────────────────────────────────────────────────────────────── */
const State = {
  authenticated: false,
  userTier: 'free',        // SSV26.1: set by Auth.verify on login
  currentTemplate: 'glass',
  currentDevice: 'desktop',
  zoomLevel: 100,
  blocks: [],          // Array of block objects
  selectedBlockId: null,
  selectedElement: null,
  globalStyles: {
    '--primary': '#ff6b35',
    '--secondary': '#1a1a2e',
    '--accent': '#ffd700',
    '--bg': '#ffffff',
    '--text': '#1a1a2e',
    '--font-heading': "'Syne', sans-serif",
    '--font-body': "'DM Sans', sans-serif",
    '--font-base': '16px',
    '--line-height': '1.6',
    '--btn-radius': '8px',
    '--section-pad': '60px',
    '--container': '1200px',
    '--radius': '12px',
    '--shadow': '0 8px 24px rgba(0,0,0,0.15)',
  },
  customCSS: '',
  uploadedImages: {},   // map: key → base64
  blockIdCounter: 1,
};


/* ──────────────────────────────────────────────────────────────────
   FIX 1: REAL-TIME LIVE SYNC — BroadcastChannel-based collab
   Two tabs/windows on the same origin broadcast state changes.
   Last-write-wins with monotonic version counter.
────────────────────────────────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════════════
   LIVE SYNC — cross-device via Base44 relay + local channels
   Architecture:
     PUSH  → POST to relay endpoint (HTTP, debounced 150ms) + BroadcastChannel + localStorage
     POLL  → GET relay every 400ms (only when session active)
   Works on any device, any network, any browser. No third-party services.
   Relay endpoint: https://ai-1a5e84f8.base44.app/functions/collabRelay
═══════════════════════════════════════════════════════════════════ */

const RELAY_URL = 'https://ai-1a5e84f8.base44.app/functions/collabRelay';

const LiveSync = {
  sessionCode: null,
  isOwner: false,
  channel: null,           // BroadcastChannel (same-browser fast path)
  _tabId: Math.random().toString(36).slice(2, 10), // unique per tab
  _lastAppliedTs: 0,
  _syncInProgress: false,
  _pushTimer: null,
  _pollTimer: null,
  _storageListener: null,

  init(code, isOwner) {
    this.sessionCode = code;
    this.isOwner = isOwner;
    this._lastAppliedTs = 0;
    this._syncInProgress = false;

    // ── Local channels (same-browser) ─────────────────────────────
    if (this.channel) { try { this.channel.close(); } catch(e) {} this.channel = null; }
    if (this._storageListener) {
      window.removeEventListener('storage', this._storageListener);
      this._storageListener = null;
    }
    try {
      this.channel = new BroadcastChannel('ss_collab_' + code);
      this.channel.onmessage = (ev) => this._applyPayload(ev.data, 'bc');
    } catch(e) {}

    this._storageListener = (e) => {
      if (e.key !== 'ss_collab_' + code || !e.newValue) return;
      try { this._applyPayload(JSON.parse(e.newValue), 'ls'); } catch(err) {}
    };
    window.addEventListener('storage', this._storageListener);

    // ── Start polling relay for cross-device updates ───────────────
    this._startPolling();
    this._updateUI(true);

    console.log('[LiveSync] Session started:', code, isOwner ? '(owner)' : '(guest)', '| tab:', this._tabId);

    // Request current state from relay immediately on join
    this._pollNow();
  },

  destroy() {
    clearTimeout(this._pushTimer);
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    if (this.channel) { try { this.channel.close(); } catch(e) {} this.channel = null; }
    if (this._storageListener) {
      window.removeEventListener('storage', this._storageListener);
      this._storageListener = null;
    }
    this.sessionCode = null;
    this._syncInProgress = false;
    this._updateUI(false);
  },

  /** Debounced notify — call after any local state mutation */
  notifyChange() {
    if (!this.sessionCode) return;
    if (this._syncInProgress) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this._push(), 150);
  },

  /** Serialize and broadcast state to all peers */
  async _push() {
    if (!this.sessionCode || this._syncInProgress) return;
    const ts = Date.now();
    let stateJSON;
    try {
      stateJSON = JSON.stringify({
        blocks: State.blocks,
        globalStyles: State.globalStyles,
        currentTemplate: State.currentTemplate,
        customCSS: State.customCSS,
        blockIdCounter: State.blockIdCounter,
      });
    } catch(e) { return; }

    const payload = { type: 'STATE_UPDATE', ts, tabId: this._tabId, stateJSON };

    // ── 1. Local channels (instant, same-browser) ──────────────────
    if (this.channel) { try { this.channel.postMessage(payload); } catch(e) {} }
    try { localStorage.setItem('ss_collab_' + this.sessionCode, JSON.stringify(payload)); } catch(e) {}

    // ── 2. Relay (cross-device) ────────────────────────────────────
    this._flashSyncIndicator('syncing');
    try {
      const res = await fetch(RELAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'push',
          code: this.sessionCode,
          ts,
          tabId: this._tabId,
          state: stateJSON,
        }),
      });
      if (res.ok) {
        this._flashSyncIndicator('synced');
        console.log('[LiveSync] Pushed ts=' + ts);
      } else {
        this._flashSyncIndicator('error');
      }
    } catch(e) {
      console.warn('[LiveSync] Relay push failed (offline?):', e.message);
      this._flashSyncIndicator('error');
    }
  },

  _startPolling() {
    clearInterval(this._pollTimer);
    // Poll relay every 400ms for cross-device updates
    this._pollTimer = setInterval(() => this._pollNow(), 400);
  },

  async _pollNow() {
    if (!this.sessionCode) return;
    try {
      const res = await fetch(RELAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'poll',
          code: this.sessionCode,
          since: this._lastAppliedTs,
          tabId: this._tabId,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.hasUpdate && data.state) {
        this._applyPayload({
          type: 'STATE_UPDATE',
          ts: data.ts,
          tabId: data.tabId,
          stateJSON: data.state,
        }, 'relay');
      }
    } catch(e) {
      // Network error — silent, will retry next poll
    }
  },

  _applyPayload(data, src) {
    if (!data || data.type !== 'STATE_UPDATE') return;
    if (data.tabId === this._tabId) return; // ignore own messages
    if (data.ts <= this._lastAppliedTs) return; // drop stale / duplicate

    this._lastAppliedTs = data.ts;
    this._syncInProgress = true;

    try {
      const s = typeof data.stateJSON === 'string'
        ? JSON.parse(data.stateJSON)
        : (data.state || {});

      if (s.blocks !== undefined)           State.blocks         = JSON.parse(JSON.stringify(s.blocks));
      if (s.globalStyles !== undefined)     State.globalStyles   = JSON.parse(JSON.stringify(s.globalStyles));
      if (s.currentTemplate !== undefined)  State.currentTemplate = s.currentTemplate;
      if (s.customCSS !== undefined)        State.customCSS      = s.customCSS;
      if (s.blockIdCounter !== undefined && s.blockIdCounter > State.blockIdCounter)
        State.blockIdCounter = s.blockIdCounter;

      refreshPreview();
      updateLayers();
      this._flashSyncIndicator('synced');
      console.log('[LiveSync] Applied state from ' + src + ' ts=' + data.ts);
    } catch(e) {
      console.error('[LiveSync] Apply failed:', e);
    } finally {
      this._syncInProgress = false;
    }
  },

  _flashSyncIndicator(state) {
    const bar    = document.querySelector('.collab-sync-bar');
    const status = document.getElementById('collab-sync-status');
    if (!bar || !status) return;
    clearTimeout(this._indicatorTimer);
    if (state === 'syncing') {
      bar.className = 'collab-sync-bar syncing';
      status.textContent = 'Syncing…';
    } else if (state === 'error') {
      bar.className = 'collab-sync-bar error';
      status.textContent = 'Sync error';
      this._indicatorTimer = setTimeout(() => {
        bar.className = 'collab-sync-bar';
        status.textContent = '🟡 Local only';
      }, 3000);
    } else {
      bar.className = 'collab-sync-bar';
      status.textContent = 'Synced ✓';
      this._indicatorTimer = setTimeout(() => {
        if (status) status.textContent = '🟢 Live';
      }, 2000);
    }
  },

  _updateUI(active) {
    const section = document.getElementById('collab-active-section');
    const info    = document.getElementById('collab-active-info');
    if (section) section.style.display = active ? 'block' : 'none';
    if (info && active) {
      info.textContent = (this.isOwner ? 'Owner' : 'Collaborator') + ' — Code: ' + this.sessionCode;
    }
  },
}

/* Collab Modal Functions */
function openCollabModal() {
  document.getElementById('collab-modal').style.display = 'flex';
  const codeEl = document.getElementById('collab-code-value');
  const stored = localStorage.getItem('ss_collab_code');
  if (stored) { if (codeEl) codeEl.textContent = stored; }
  if (LiveSync.sessionCode) {
    LiveSync._updateUI(true);
  }
}

function closeCollabModal() {
  document.getElementById('collab-modal').style.display = 'none';
}

function generateCollabCode() {
  const code = Math.random().toString(36).substr(2,4).toUpperCase() +
               Math.random().toString(36).substr(2,4).toUpperCase();
  localStorage.setItem('ss_collab_code', code);
  const el = document.getElementById('collab-code-value');
  if (el) el.textContent = code;
  // Start live session as owner
  if (LiveSync.channel) LiveSync.destroy();
  LiveSync.init(code, true);
  showToast('🔗 Code Generated', 'Share ' + code + ' with collaborators', 'success');
}

function copyCollabCode() {
  const code = document.getElementById('collab-code-value')?.textContent;
  if (!code || code === '—') { showToast('⚠️ No code', 'Generate a code first', 'warning'); return; }
  navigator.clipboard.writeText(code).catch(() => {});
  showToast('📋 Copied!', 'Invite code copied to clipboard', 'success');
}

function joinCollabSession() {
  const input = document.getElementById('collab-join-input');
  const status = document.getElementById('collab-join-status');
  const code = (input?.value || '').trim().toUpperCase();
  if (code.length < 6) {
    if (status) { status.textContent = '❌ Enter a valid code'; status.style.color = 'var(--ui-danger)'; }
    return;
  }
  if (LiveSync.channel) LiveSync.destroy();
  LiveSync.init(code, false);
  if (status) { status.textContent = '🟢 Connected — waiting for sync…'; status.style.color = 'var(--ui-success)'; }
  showToast('🤝 Joined Session', 'Connected to project ' + code, 'success');
  // Request full state from owner via dual-channel
  setTimeout(() => LiveSync._pollNow(), 300);
}

function leaveCollabSession() {
  LiveSync.destroy();
  const status = document.getElementById('collab-join-status');
  if (status) { status.textContent = ''; }
  showToast('👋 Left Session', 'You have left the collaboration session', 'info');
}


/* ──────────────────────────────────────────────────────────────────
   FIX 9: HISTORY STACK — Undo / Redo with nav arrows
────────────────────────────────────────────────────────────────── */
const History = {
  _stack: [],
  _cursor: -1,
  _maxSize: 50,
  _skipNext: false,

  /** Save current state snapshot */
  push() {
    if (this._skipNext) { this._skipNext = false; return; }
    // Trim forward history on new action
    if (this._cursor < this._stack.length - 1) {
      this._stack.splice(this._cursor + 1);
    }
    const snapshot = JSON.stringify({
      blocks: State.blocks,
      globalStyles: State.globalStyles,
      customCSS: State.customCSS,
      blockIdCounter: State.blockIdCounter,
    });
    // Avoid duplicate snapshots
    if (this._stack.length && this._stack[this._cursor] === snapshot) return;
    this._stack.push(snapshot);
    if (this._stack.length > this._maxSize) this._stack.shift();
    this._cursor = this._stack.length - 1;
    this._updateArrows();
  },

  back() {
    if (this._cursor <= 0) return;
    this._cursor--;
    this._apply();
    showToast('↩ Undo', 'Step ' + this._cursor + ' of ' + (this._stack.length-1), 'info');
  },

  forward() {
    if (this._cursor >= this._stack.length - 1) return;
    this._cursor++;
    this._apply();
    showToast('↪ Redo', 'Step ' + this._cursor + ' of ' + (this._stack.length-1), 'info');
  },

  _apply() {
    try {
      const snap = JSON.parse(this._stack[this._cursor]);
      this._skipNext = true;
      State.blocks = snap.blocks || [];
      State.globalStyles = { ...State.globalStyles, ...snap.globalStyles };
      State.customCSS = snap.customCSS || '';
      State.blockIdCounter = snap.blockIdCounter || 1;
      refreshPreview();
      updateLayers();
      this._updateArrows();
    } catch(e) { console.error('History apply error', e); }
  },

  _updateArrows() {
    const back = document.getElementById('hist-back-btn');
    const fwd = document.getElementById('hist-fwd-btn');
    if (back) back.disabled = this._cursor <= 0;
    if (fwd) fwd.disabled = this._cursor >= this._stack.length - 1;
  },
};

function historyBack() { History.back(); }
function historyForward() { History.forward(); }

/* ──────────────────────────────────────────────────────────────────
   BLOCK DEFINITIONS — templates for each block type
────────────────────────────────────────────────────────────────── */
const BlockDefs = {

  nav: {
    label: 'Navigation',
    icon: '🧭',
    defaultData: {
      logo: 'Supersuite',
      links: ['Home', 'Features', 'Pricing', 'Contact'],
      bgColor: '#ffffff',
      textColor: '#1a1a2e',
      sticky: true,
      ctaText: 'Get Started',
      ctaLink: '#cta',
      ctaBgColor: '#ff6b35',
    }
  },

  hero: {
    label: 'Hero Section',
    icon: '⚡',
    defaultData: {
      heading: 'Build Your Dream Website — Fast',
      subheading: 'No code required. Launch in minutes with Supersuite\'s powerful visual builder.',
      bgType: 'gradient',
      bgColor: '#1a1a2e',
      bgColor2: '#16213e',
      bgImage: '',
      textColor: '#ffffff',
      btnText: 'Start Building Free',
      btnLink: '#',
      btnColor: '#ff6b35',
      btnTextColor: '#ffffff',
      btn2Text: 'Watch Demo',
      btn2Link: '#',
      showBadge: true,
      badgeText: '🚀 Now with AI',
      alignment: 'center',
      minHeight: '85vh',
    }
  },

  leadform: {
    label: 'Lead Form',
    icon: '📋',
    defaultData: {
      heading: 'Get Early Access',
      subheading: 'Join 5,000+ builders already on the waitlist.',
      fields: [
        { type: 'text', placeholder: 'Your full name', name: 'name' },
        { type: 'email', placeholder: 'Work email address', name: 'email' },
        { type: 'text', placeholder: 'Company name (optional)', name: 'company' },
      ],
      btnText: 'Claim My Spot →',
      btnColor: '#ff6b35',
      bgColor: '#f8f8ff',
      textColor: '#1a1a2e',
      accentColor: '#ff6b35',
      privacyText: '🔒 No spam. Unsubscribe anytime.',
    }
  },

  testimonials: {
    label: 'Testimonials',
    icon: '💬',
    defaultData: {
      heading: 'Loved by Builders Worldwide',
      subheading: 'Real feedback from real users.',
      bgColor: '#ffffff',
      textColor: '#1a1a2e',
      accentColor: '#ff6b35',
      cards: [
        {
          name: 'Sarah Chen',
          role: 'Founder, Launchpad Co.',
          avatar: '',
          rating: 5,
          quote: 'Supersuite cut our launch time from weeks to hours. The visual editor is incredibly intuitive — our whole team uses it now without any training.',
          bgColor: '#ffffff',
        },
        {
          name: 'Marcus Rivera',
          role: 'Marketing Director',
          avatar: '',
          rating: 5,
          quote: 'We replaced our expensive agency with Supersuite. The revenue blocks alone have increased our conversion rate by 34%. Unbelievable value.',
          bgColor: '#ffffff',
        },
        {
          name: 'Emma Thompson',
          role: 'Solo Entrepreneur',
          avatar: '',
          rating: 5,
          quote: 'As a non-technical founder, I was skeptical. But I had my entire website live in 2 hours. The templates are gorgeous out of the box.',
          bgColor: '#ffffff',
        },
      ]
    }
  },

  pricing: {
    label: 'Pricing / Services',
    icon: '💎',
    defaultData: {
      heading: 'Simple, Transparent Pricing',
      subheading: 'Choose the plan that fits your ambition.',
      bgColor: '#0f0f13',
      textColor: '#ffffff',
      accentColor: '#ff6b35',
      plans: [
        {
          name: 'Starter',
          price: '$0',
          period: '/month',
          description: 'Perfect for testing the waters.',
          features: ['3 pages', '10 blocks', 'Custom domain', 'SSL included', 'Basic analytics'],
          ctaText: 'Start Free',
          ctaLink: '#',
          featured: false,
          bgColor: 'rgba(255,255,255,0.04)',
          borderColor: 'rgba(255,255,255,0.1)',
        },
        {
          name: 'Pro',
          price: '$29',
          period: '/month',
          description: 'For serious builders.',
          features: ['Unlimited pages', 'All blocks', 'Custom domain', 'SSL included', 'Advanced analytics', 'Priority support', 'Export code'],
          ctaText: 'Start Pro Trial',
          ctaLink: '#',
          featured: true,
          bgColor: '#ff6b35',
          borderColor: '#ff6b35',
        },
        {
          name: 'Agency',
          price: '$99',
          period: '/month',
          description: 'Built for teams & agencies.',
          features: ['Everything in Pro', '10 team seats', 'White-label', 'Client handoff', 'API access', 'SLA guarantee'],
          ctaText: 'Contact Sales',
          ctaLink: '#',
          featured: false,
          bgColor: 'rgba(255,255,255,0.04)',
          borderColor: 'rgba(255,255,255,0.1)',
        },
      ]
    }
  },

  cta: {
    label: 'CTA Section',
    icon: '🎯',
    defaultData: {
      heading: 'Ready to Build Something Amazing?',
      subheading: 'Join thousands of businesses already growing with Supersuite.',
      bgType: 'gradient',
      bgColor: '#ff6b35',
      bgColor2: '#ff3d00',
      bgImage: '',
      textColor: '#ffffff',
      btnText: 'Start Building — It\'s Free',
      btnLink: '#',
      btnColor: '#ffffff',
      btnTextColor: '#ff6b35',
      btn2Text: 'Book a Demo',
      btn2Link: '#',
      showBadge: false,
      badgeText: '✓ No credit card required',
    }
  },

  features: {
    label: 'Features',
    icon: '✨',
    defaultData: {
      heading: 'Everything You Need to Launch',
      subheading: 'Powerful features built for modern businesses.',
      bgColor: '#ffffff',
      textColor: '#1a1a2e',
      accentColor: '#ff6b35',
      columns: 3,
      items: [
        { icon: '⚡', title: 'Lightning Fast', description: 'Pages load in under 1 second. Optimized for Core Web Vitals and maximum performance.' },
        { icon: '🎨', title: 'Beautiful Design', description: 'Professionally designed templates created by world-class designers.' },
        { icon: '📱', title: 'Mobile First', description: 'Every page looks perfect on any device — phone, tablet, or desktop.' },
        { icon: '🔌', title: 'Integrations', description: 'Connect with Stripe, Mailchimp, Zapier, and 100+ other tools.' },
        { icon: '📊', title: 'Analytics', description: 'Built-in analytics. See what\'s working and double down on what converts.' },
        { icon: '🔒', title: 'Enterprise Security', description: 'SSL, DDoS protection, and automated backups keep your site safe.' },
      ]
    }
  },

  gallery: {
    label: 'Gallery',
    icon: '🖼️',
    defaultData: {
      heading: 'Our Work',
      subheading: 'A selection of sites built with Supersuite.',
      bgColor: '#0f0f13',
      textColor: '#ffffff',
      columns: 3,
      images: [
        { src: '', alt: 'Project 1', caption: 'E-commerce Store' },
        { src: '', alt: 'Project 2', caption: 'SaaS Landing Page' },
        { src: '', alt: 'Project 3', caption: 'Portfolio Site' },
        { src: '', alt: 'Project 4', caption: 'Agency Website' },
        { src: '', alt: 'Project 5', caption: 'Startup Launch' },
        { src: '', alt: 'Project 6', caption: 'Blog Platform' },
      ]
    }
  },

  footer: {
    label: 'Footer',
    icon: '📌',
    defaultData: {
      logo: 'Supersuite',
      tagline: 'Build. Launch. Grow.',
      bgColor: '#0a0a0f',
      textColor: '#9090b0',
      accentColor: '#ff6b35',
      columns: [
        {
          title: 'Product',
          links: [
            { label: 'Features', url: '#' },
            { label: 'Pricing', url: '#' },
            { label: 'Templates', url: '#' },
            { label: 'Changelog', url: '#' },
          ]
        },
        {
          title: 'Company',
          links: [
            { label: 'About', url: '#' },
            { label: 'Blog', url: '#' },
            { label: 'Careers', url: '#' },
            { label: 'Press', url: '#' },
          ]
        },
        {
          title: 'Support',
          links: [
            { label: 'Docs', url: '#' },
            { label: 'Help Center', url: '#' },
            { label: 'Contact', url: '#' },
            { label: 'Status', url: '#' },
          ]
        },
      ],
      copyright: `© ${new Date().getFullYear()} Supersuite, Inc. All rights reserved.`,
      socialLinks: [
        { platform: 'Twitter', icon: '𝕏', url: '#' },
        { platform: 'LinkedIn', icon: 'in', url: '#' },
        { platform: 'GitHub', icon: '⬡', url: '#' },
      ]
    }
  },

};

/* ──────────────────────────────────────────────────────────────────
   TEMPLATE CONFIGS
────────────────────────────────────────────────────────────────── */
const Templates = {
  glass: {
    name: 'Liquid Glass',
    overrides: {
      '--primary': '#ff6b35',
      '--secondary': '#1a1a2e',
      '--accent': '#a78bfa',
      '--bg': '#f0f0f8',
      '--text': '#1a1a2e',
      '--font-heading': "'Syne', sans-serif",
      '--font-body': "'DM Sans', sans-serif",
      '--radius': '16px',
      '--btn-radius': '50px',
      '--shadow': '0 8px 32px rgba(0,0,0,0.12)',
    },
    extraCSS: `
      body { background: linear-gradient(135deg, #e8e8f8 0%, #f0e8f0 50%, #e8f0f8 100%); }
      .ss-block { backdrop-filter: blur(20px); }
      .ss-hero { background: linear-gradient(135deg, rgba(26,26,46,0.9) 0%, rgba(22,33,62,0.9) 100%) !important; }
      .ss-card { background: rgba(255,255,255,0.5) !important; border: 1px solid rgba(255,255,255,0.6) !important; backdrop-filter: blur(16px) !important; box-shadow: 0 8px 32px rgba(31,38,135,0.15) !important; }
    `
  },
  bold: {
    name: 'Classy Bold',
    overrides: {
      '--primary': '#1a1a2e',
      '--secondary': '#ff6b35',
      '--accent': '#ff6b35',
      '--bg': '#fafaf8',
      '--text': '#1a1a2e',
      '--font-heading': "'Syne', sans-serif",
      '--font-body': "'DM Sans', sans-serif",
      '--radius': '4px',
      '--btn-radius': '4px',
      '--shadow': '4px 4px 0px rgba(26,26,46,0.15)',
    },
    extraCSS: `
      body { background: #fafaf8; }
      .ss-hero:not([data-user-bg]) { background: #1a1a2e; }
      .ss-btn-primary { border: 2px solid var(--primary) !important; box-shadow: 4px 4px 0 var(--primary) !important; }
      .ss-btn-primary:hover { transform: translate(-2px, -2px) !important; box-shadow: 6px 6px 0 var(--primary) !important; }
      .ss-card { border: 2px solid #1a1a2e !important; box-shadow: 4px 4px 0 #1a1a2e !important; }
      .ss-section-title::after { content: ''; display: block; width: 60px; height: 4px; background: var(--accent); margin-top: 8px; }
    `
  },
  custom: {
    name: 'Custom CSS',
    overrides: {},
    extraCSS: ''
  },

  neon: {
    name: 'Neon Dark',
    overrides: {
      '--primary': '#00ff88',
      '--secondary': '#0a0a0f',
      '--accent': '#00d4ff',
      '--bg': '#0a0a0f',
      '--text': '#e0ffe8',
      '--font-heading': "'Syne', sans-serif",
      '--font-body': "'DM Sans', sans-serif",
      '--radius': '4px',
      '--btn-radius': '2px',
      '--shadow': '0 0 24px rgba(0,255,136,0.25)',
    },
    extraCSS: `
      body { background: #0a0a0f; }
      .ss-block { border-top: 1px solid rgba(0,255,136,0.06); }
      .ss-btn-primary { box-shadow: 0 0 20px rgba(0,255,136,0.4) !important; border: 1px solid #00ff88 !important; }
      .ss-card { border: 1px solid rgba(0,255,136,0.25) !important; box-shadow: 0 0 16px rgba(0,255,136,0.08) !important; }
    `
  },

  editorial: {
    name: 'Editorial',
    overrides: {
      '--primary': '#1a1a1a',
      '--secondary': '#c5a35e',
      '--accent': '#c5a35e',
      '--bg': '#faf8f5',
      '--text': '#1a1a1a',
      '--font-heading': "'Playfair Display', Georgia, serif",
      '--font-body': "'DM Sans', sans-serif",
      '--radius': '0px',
      '--btn-radius': '0px',
      '--shadow': 'none',
    },
    extraCSS: `
      body { background: #faf8f5; }
      .ss-hero:not([data-user-bg]) { background: #1a1a1a; }
      .ss-btn-primary { border: 2px solid var(--primary) !important; text-transform: uppercase !important; font-size: 13px !important; letter-spacing: 1px !important; }
      .ss-card { border: 1px solid #d4cfc8 !important; border-left: 4px solid var(--accent) !important; border-radius: 0 !important; }
      .ss-section-title { font-style: italic; }
      .ss-block { border-bottom: 1px solid #d4cfc8; }
    `
  }
};

/* ──────────────────────────────────────────────────────────────────
   HTML GENERATORS — render each block to HTML string
────────────────────────────────────────────────────────────────── */
const BlockRenderers = {

  nav(data) {
    // FIX3: Support bgType like other blocks (solid/gradient/image)
    const bgType = data.bgType || 'solid';
    const navBg = bgType === 'image' && data.bgImage
      ? `url('${data.bgImage}') center/cover no-repeat`
      : bgType === 'gradient'
        ? `linear-gradient(${data.bgGradientAngle||135}deg, ${data.bgColor} 0%, ${data.bgColor2||data.bgColor} 100%)`
        : bgType === 'transparent'
          ? 'transparent'
          : data.bgColor;
    return `
<nav class="ss-block ss-nav" style="background:${navBg};color:${data.textColor};position:${data.sticky?'sticky':'relative'};top:0;z-index:100;border-bottom:1px solid rgba(0,0,0,0.08);padding:0 var(--section-pad);">
  <div class="ss-nav-inner" style="max-width:var(--container);margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:72px;gap:32px;">
    <div class="ss-nav-logo" style="font-family:var(--font-heading);font-weight:800;font-size:24px;color:${data.textColor};letter-spacing:-0.5px;cursor:default;">${data.logo}</div>
    <div class="ss-nav-links" style="display:flex;align-items:center;gap:32px;">
      ${data.links.map(l => `<a href="#" style="color:${data.textColor};text-decoration:none;font-size:15px;font-weight:500;opacity:0.8;transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">${l}</a>`).join('')}
    </div>
    <a href="${data.ctaLink}" style="background:${data.ctaBgColor};color:white;padding:10px 22px;border-radius:var(--btn-radius);font-size:14px;font-weight:600;text-decoration:none;transition:all 0.2s;display:inline-flex;align-items:center;gap:6px;" onmouseover="this.style.opacity='0.9';this.style.transform='translateY(-1px)'" onmouseout="this.style.opacity='1';this.style.transform='translateY(0)'">${data.ctaText} →</a>
  </div>
</nav>`;
  },

  hero(data) {
    const bg = data.bgType === 'image' && data.bgImage
      ? `url('${data.bgImage}') center/cover no-repeat`
      : `linear-gradient(135deg, ${data.bgColor} 0%, ${data.bgColor2} 100%)`;
    return `
<section class="ss-block ss-hero" data-user-bg="1" style="background:${bg};color:${data.textColor};padding:120px var(--section-pad);min-height:${data.minHeight};display:flex;align-items:center;position:relative;overflow:hidden;">
  <div class="ss-hero-orb" style="position:absolute;top:-100px;right:-100px;width:500px;height:500px;background:radial-gradient(circle,rgba(255,107,53,0.15),transparent 70%);border-radius:50%;pointer-events:none;"></div>
  <div class="ss-hero-orb" style="position:absolute;bottom:-150px;left:-50px;width:400px;height:400px;background:radial-gradient(circle,rgba(139,92,246,0.1),transparent 70%);border-radius:50%;pointer-events:none;"></div>
  <div class="ss-hero-inner" style="max-width:var(--container);margin:0 auto;width:100%;text-align:${data.alignment};position:relative;z-index:1;">
    ${data.showBadge ? `<div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:50px;padding:6px 16px;font-size:13px;margin-bottom:24px;backdrop-filter:blur(8px);">${data.badgeText}</div>` : ''}
    <h1 style="font-family:var(--font-heading);font-size:clamp(40px,6vw,80px);font-weight:800;line-height:1.1;margin-bottom:20px;letter-spacing:-2px;">${data.heading}</h1>
    <p style="font-size:clamp(16px,2vw,22px);opacity:0.8;max-width:600px;margin:0 ${data.alignment==='center'?'auto':'0'} 40px;line-height:1.6;">${data.subheading}</p>
    <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:${data.alignment==='center'?'center':'flex-start'};">
      <a href="${data.btnLink}" class="ss-btn-primary" style="background:${data.btnColor};color:${data.btnTextColor};padding:16px 36px;border-radius:var(--btn-radius);font-size:16px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:8px;transition:all 0.3s;box-shadow:0 8px 32px rgba(255,107,53,0.4);" onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 16px 48px rgba(255,107,53,0.5)'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='0 8px 32px rgba(255,107,53,0.4)'">${data.btnText} →</a>
      <a href="${data.btn2Link}" style="background:rgba(255,255,255,0.1);color:${data.textColor};padding:16px 36px;border-radius:var(--btn-radius);font-size:16px;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,0.2);display:inline-flex;align-items:center;gap:8px;transition:all 0.3s;backdrop-filter:blur(8px);" onmouseover="this.style.background='rgba(255,255,255,0.15)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">${data.btn2Text}</a>
    </div>
  </div>
</section>`;
  },

  leadform(data) {
    const fields = data.fields.map(f => `
      <input type="${f.type}" name="${f.name}" placeholder="${f.placeholder}" required style="width:100%;padding:14px 16px;background:white;border:1.5px solid #e5e7eb;border-radius:var(--radius);font-size:15px;font-family:var(--font-body);outline:none;transition:border-color 0.2s;color:${data.textColor};" onfocus="this.style.borderColor='${data.accentColor}'" onblur="this.style.borderColor='#e5e7eb'"/>
    `).join('');
    // FIX11: Webhook-aware form submit handler
    const webhookUrl = data.webhookUrl || '';
    const successMsg = data.successMsg || "You're on the list!";
    const errorMsg = data.errorMsg || "Something went wrong. Please try again.";
    const submitHandler = webhookUrl
      ? `async function ssFormSubmit(form, btn, orig) {
          btn.textContent = '⏳ Sending…'; btn.disabled = true;
          const formData = {}; new FormData(form).forEach((v,k) => formData[k]=v);
          try {
            const res = await fetch('${webhookUrl}', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(formData) });
            if (res.ok) { form.innerHTML = '<div style=\'text-align:center;padding:20px;\'><span style=\'font-size:40px;\'>🎉</span><h3 style=\'margin-top:12px;font-family:var(--font-heading);font-weight:700;\'>${successMsg}</h3></div>'; }
            else { btn.textContent = orig; btn.disabled = false; btn.insertAdjacentHTML('afterend','<p style=\'color:#ef4444;font-size:13px;margin-top:6px;\'>${errorMsg}</p>'); }
          } catch(e) { btn.textContent = orig; btn.disabled = false; btn.insertAdjacentHTML('afterend','<p style=\'color:#ef4444;font-size:13px;margin-top:6px;\'>Network error. Please try again.</p>'); }
        }`
      : `function ssFormSubmit(form, btn, orig) { form.innerHTML = '<div style=\'text-align:center;padding:20px;\'><span style=\'font-size:40px;\'>🎉</span><h3 style=\'margin-top:12px;font-family:var(--font-heading);font-weight:700;\'>${successMsg}</h3></div>'; }`;

    return `
<section class="ss-block ss-leadform" style="background:${data.bgColor};color:${data.textColor};padding:var(--section-pad) var(--section-pad);">
  <div style="max-width:560px;margin:0 auto;text-align:center;">
    <h2 class="ss-section-title" style="font-family:var(--font-heading);font-size:clamp(28px,4vw,44px);font-weight:800;margin-bottom:12px;letter-spacing:-1px;color:${data.textColor};">${data.heading}</h2>
    <p style="font-size:17px;opacity:0.7;margin-bottom:36px;">${data.subheading}</p>
    <script>(${submitHandler})<\/script>
    <form onsubmit="event.preventDefault();var b=this.querySelector('button[type=submit]');ssFormSubmit(this,b,b?b.textContent:'');" style="display:flex;flex-direction:column;gap:12px;text-align:left;">
      ${fields}
      <button type="submit" style="background:${data.btnColor};color:white;padding:16px;border-radius:var(--btn-radius);font-size:16px;font-weight:700;border:none;cursor:pointer;transition:all 0.3s;font-family:var(--font-body);" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 12px 32px rgba(255,107,53,0.4)'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='none'">${data.btnText}</button>
      <p style="text-align:center;font-size:13px;opacity:0.5;margin-top:4px;">${data.privacyText}</p>
    </form>
  </div>
</section>`;
  },

  testimonials(data) {
    const cards = data.cards.map((c, i) => `
      <div class="ss-card ss-testimonial-card" style="background:${c.bgColor};border:1px solid rgba(0,0,0,0.06);border-radius:var(--radius);padding:28px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:16px;transition:transform 0.3s;" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='translateY(0)'">
        <div style="display:flex;gap:2px;color:#ffd700;font-size:16px;">${'★'.repeat(c.rating)}</div>
        <p style="font-size:15px;line-height:1.7;color:${data.textColor};opacity:0.85;font-style:italic;">"${c.quote}"</p>
        <div style="display:flex;align-items:center;gap:12px;margin-top:auto;padding-top:12px;border-top:1px solid rgba(0,0,0,0.05);">
          <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,${data.accentColor},${data.accentColor}88);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:white;flex-shrink:0;">${c.name.charAt(0)}</div>
          <div>
            <div style="font-weight:700;font-size:14px;color:${data.textColor};">${c.name}</div>
            <div style="font-size:12px;color:${data.textColor};opacity:0.5;">${c.role}</div>
          </div>
        </div>
      </div>
    `).join('');
    return `
<section class="ss-block ss-testimonials" style="background:${data.bgColor};padding:var(--section-pad) var(--section-pad);">
  <div style="max-width:var(--container);margin:0 auto;">
    <div style="text-align:center;margin-bottom:56px;">
      <h2 class="ss-section-title" style="font-family:var(--font-heading);font-size:clamp(28px,4vw,48px);font-weight:800;margin-bottom:12px;letter-spacing:-1px;color:${data.textColor};">${data.heading}</h2>
      <p style="font-size:17px;color:${data.textColor};opacity:0.6;">${data.subheading}</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;">${cards}</div>
  </div>
</section>`;
  },

  pricing(data) {
    const plans = data.plans.map((p, i) => `
      <div class="ss-card ss-pricing-card" style="background:${p.bgColor};border:1px solid ${p.borderColor};border-radius:var(--radius);padding:32px;display:flex;flex-direction:column;gap:20px;position:relative;transition:transform 0.3s;" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='translateY(0)'">
        ${p.featured ? `<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:white;color:${data.bgColor};padding:4px 16px;border-radius:50px;font-size:12px;font-weight:700;letter-spacing:0.5px;white-space:nowrap;">MOST POPULAR ⭐</div>` : ''}
        <div>
          <div style="font-size:14px;font-weight:600;color:${p.featured?'rgba(255,255,255,0.8)':data.textColor};opacity:0.7;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">${p.name}</div>
          <div style="display:flex;align-items:baseline;gap:4px;">
            <span style="font-family:var(--font-heading);font-size:52px;font-weight:800;color:${p.featured?'white':data.textColor};line-height:1;">${p.price}</span>
            <span style="font-size:14px;color:${p.featured?'rgba(255,255,255,0.7)':data.textColor};opacity:0.6;">${p.period}</span>
          </div>
          <p style="font-size:14px;color:${p.featured?'rgba(255,255,255,0.7)':data.textColor};opacity:0.6;margin-top:8px;">${p.description}</p>
        </div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:10px;flex:1;">
          ${(p.features||[]).map(f => `<li style="display:flex;align-items:center;gap:10px;font-size:14px;color:${p.featured?'rgba(255,255,255,0.9)':data.textColor};">
            <span style="color:${p.featured?'white':data.accentColor};font-size:16px;flex-shrink:0;">✓</span>${f}
          </li>`).join('')}
        </ul>
        <a href="${p.ctaLink}" style="background:${p.featured?'white':data.accentColor};color:${p.featured?data.accentColor:'white'};padding:14px 24px;border-radius:var(--btn-radius);text-align:center;font-size:15px;font-weight:700;text-decoration:none;transition:all 0.3s;display:block;" onmouseover="this.style.transform='translateY(-2px)';this.style.opacity='0.9'" onmouseout="this.style.transform='translateY(0)';this.style.opacity='1'">${p.ctaText}</a>
      </div>
    `).join('');
    return `
<section class="ss-block ss-pricing" style="background:${data.bgColor};padding:var(--section-pad) var(--section-pad);">
  <div style="max-width:var(--container);margin:0 auto;">
    <div style="text-align:center;margin-bottom:56px;">
      <h2 class="ss-section-title" style="font-family:var(--font-heading);font-size:clamp(28px,4vw,48px);font-weight:800;margin-bottom:12px;letter-spacing:-1px;color:${data.textColor};">${data.heading}</h2>
      <p style="font-size:17px;color:${data.textColor};opacity:0.6;">${data.subheading}</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;align-items:start;">${plans}</div>
  </div>
</section>`;
  },

  cta(data) {
    const bg = data.bgType === 'image' && data.bgImage
      ? `url('${data.bgImage}') center/cover no-repeat`
      : `linear-gradient(135deg, ${data.bgColor} 0%, ${data.bgColor2} 100%)`;
    return `
<section class="ss-block ss-cta" style="background:${bg};color:${data.textColor};padding:100px var(--section-pad);text-align:center;position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(255,255,255,0.04) 0%,transparent 60%);pointer-events:none;border-radius:inherit;"></div>
  <div style="position:relative;z-index:1;max-width:700px;margin:0 auto;">
    ${data.showBadge ? `<div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:50px;padding:6px 18px;font-size:13px;margin-bottom:24px;backdrop-filter:blur(8px);">${data.badgeText}</div>` : ''}
    <h2 style="font-family:var(--font-heading);font-size:clamp(32px,5vw,60px);font-weight:800;margin-bottom:16px;letter-spacing:-1.5px;line-height:1.1;">${data.heading}</h2>
    <p style="font-size:18px;opacity:0.85;margin-bottom:40px;line-height:1.6;">${data.subheading}</p>
    <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center;">
      <a href="${data.btnLink}" style="background:${data.btnColor};color:${data.btnTextColor};padding:18px 40px;border-radius:var(--btn-radius);font-size:17px;font-weight:700;text-decoration:none;transition:all 0.3s;display:inline-flex;align-items:center;gap:8px;" onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 16px 48px rgba(0,0,0,0.2)'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='none'">${data.btnText}</a>
      <a href="${data.btn2Link}" style="background:rgba(255,255,255,0.15);color:${data.textColor};padding:18px 40px;border-radius:var(--btn-radius);font-size:17px;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,0.3);backdrop-filter:blur(8px);transition:all 0.3s;" onmouseover="this.style.background='rgba(255,255,255,0.22)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">${data.btn2Text}</a>
    </div>
  </div>
</section>`;
  },

  features(data) {
    const items = data.items.map(item => `
      <div class="ss-card ss-feature-card" style="background:white;border:1px solid rgba(0,0,0,0.06);border-radius:var(--radius);padding:28px;box-shadow:var(--shadow);transition:all 0.3s;" onmouseover="this.style.transform='translateY(-4px)';this.style.borderColor='${data.accentColor}'" onmouseout="this.style.transform='translateY(0)';this.style.borderColor='rgba(0,0,0,0.06)'">
        <div style="width:52px;height:52px;background:linear-gradient(135deg,${data.accentColor}20,${data.accentColor}08);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:16px;border:1px solid ${data.accentColor}20;">${item.icon}</div>
        <h3 style="font-family:var(--font-heading);font-size:18px;font-weight:700;color:${data.textColor};margin-bottom:8px;">${item.title}</h3>
        <p style="font-size:14px;color:${data.textColor};opacity:0.6;line-height:1.7;">${item.description}</p>
      </div>
    `).join('');
    return `
<section class="ss-block ss-features" style="background:${data.bgColor};padding:var(--section-pad) var(--section-pad);">
  <div style="max-width:var(--container);margin:0 auto;">
    <div style="text-align:center;margin-bottom:56px;">
      <h2 class="ss-section-title" style="font-family:var(--font-heading);font-size:clamp(28px,4vw,48px);font-weight:800;margin-bottom:12px;letter-spacing:-1px;color:${data.textColor};">${data.heading}</h2>
      <p style="font-size:17px;color:${data.textColor};opacity:0.6;">${data.subheading}</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(${data.columns},1fr);gap:24px;">${items}</div>
  </div>
</section>`;
  },

  gallery(data) {
    const imgs = data.images.map((img, i) => {
      const colors = ['#ff6b35','#8b5cf6','#3b82f6','#22c55e','#f59e0b','#ef4444'];
      const bg = img.src ? `url('${img.src}') center/cover no-repeat` : `linear-gradient(135deg, ${colors[i%colors.length]}33, ${colors[(i+1)%colors.length]}33)`;
      // FIX12: Use actual img tag for load/error detection, hidden behind bg
      return `
        <div style="position:relative;overflow:hidden;border-radius:var(--radius);aspect-ratio:4/3;background:${bg};cursor:pointer;" onmouseover="this.querySelector('.gal-overlay').style.opacity='1'" onmouseout="this.querySelector('.gal-overlay').style.opacity='0'">
          ${img.src ? `<img src="${img.src}" alt="${img.alt||''}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none;" onerror="var p=this.parentElement;p.style.background='linear-gradient(135deg,rgba(239,68,68,0.15),rgba(239,68,68,0.05))';p.innerHTML='<div style=\'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:rgba(255,255,255,0.4);\'><span style=\'font-size:28px;\'>⚠️</span><span style=\'font-size:12px;\'>Image failed to load</span></div>';"/>` : ''}
          ${!img.src ? `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;"><span style="font-size:32px;">${['🖼️','💻','✨','🚀','📱','🎨'][i%6]}</span><span style="font-size:12px;color:rgba(255,255,255,0.6);font-weight:500;">Add Image</span></div>` : ''}
          <div class="gal-overlay" style="position:absolute;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;padding:16px;opacity:0;transition:opacity 0.3s;">
            <span style="color:white;font-size:14px;font-weight:600;">${img.caption}</span>
          </div>
        </div>
      `;
    }).join('');
    return `
<section class="ss-block ss-gallery" style="background:${data.bgColor};padding:var(--section-pad) var(--section-pad);">
  <div style="max-width:var(--container);margin:0 auto;">
    <div style="text-align:center;margin-bottom:48px;">
      <h2 class="ss-section-title" style="font-family:var(--font-heading);font-size:clamp(28px,4vw,48px);font-weight:800;margin-bottom:12px;letter-spacing:-1px;color:${data.textColor};">${data.heading}</h2>
      <p style="font-size:17px;color:${data.textColor};opacity:0.6;">${data.subheading}</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(${data.columns},1fr);gap:16px;">${imgs}</div>
  </div>
</section>`;
  },

  footer(data) {
    const cols = data.columns.map(col => `
      <div>
        <h4 style="font-family:var(--font-heading);font-size:14px;font-weight:700;color:${data.accentColor};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:16px;">${col.title}</h4>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:10px;">
          ${col.links.map(l => `<li><a href="${l.url}" style="color:${data.textColor};opacity:0.6;font-size:14px;text-decoration:none;transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">${l.label}</a></li>`).join('')}
        </ul>
      </div>
    `).join('');
    const socials = data.socialLinks.map(s => `
      <a href="${s.url}" style="width:36px;height:36px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;display:flex;align-items:center;justify-content:center;color:${data.textColor};opacity:0.7;text-decoration:none;font-size:14px;font-weight:700;transition:all 0.2s;" onmouseover="this.style.opacity='1';this.style.background='${data.accentColor}';this.style.borderColor='${data.accentColor}'" onmouseout="this.style.opacity='0.7';this.style.background='rgba(255,255,255,0.06)';this.style.borderColor='rgba(255,255,255,0.1)'">${s.icon}</a>
    `).join('');
    return `
<footer class="ss-block ss-footer" style="background:${data.bgColor};color:${data.textColor};padding:64px var(--section-pad) 32px;">
  <div style="max-width:var(--container);margin:0 auto;">
    <div style="display:grid;grid-template-columns:1.5fr repeat(${data.columns.length},1fr);gap:48px;margin-bottom:48px;padding-bottom:48px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div>
        <div style="font-family:var(--font-heading);font-weight:800;font-size:22px;color:white;margin-bottom:10px;letter-spacing:-0.5px;">${data.logo}</div>
        <p style="font-size:14px;opacity:0.5;margin-bottom:24px;line-height:1.6;">${data.tagline}</p>
        <div style="display:flex;gap:8px;">${socials}</div>
      </div>
      ${cols}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
      <p style="font-size:13px;opacity:0.4;">${data.copyright}</p>
      <div style="display:flex;gap:24px;">
        <a href="#" style="font-size:13px;color:${data.textColor};opacity:0.4;text-decoration:none;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='0.4'">Privacy</a>
        <a href="#" style="font-size:13px;color:${data.textColor};opacity:0.4;text-decoration:none;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='0.4'">Terms</a>
        <a href="#" style="font-size:13px;color:${data.textColor};opacity:0.4;text-decoration:none;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='0.4'">Cookies</a>
      </div>
    </div>
  </div>
</footer>`;
  },

};

/* ──────────────────────────────────────────────────────────────────
   PREVIEW ENGINE — generates the full page HTML for the iframe
────────────────────────────────────────────────────────────────── */
function buildPreviewHTML(forExport = false) {
  const template = Templates[State.currentTemplate];

  // Merge global styles with template overrides
  const styles = { ...State.globalStyles, ...template.overrides };
  const cssVars = Object.entries(styles).map(([k, v]) => `${k}: ${v};`).join('\n    ');

  // Build block HTML
  const blocksHTML = State.blocks.map(block => {
    const renderer = BlockRenderers[block.type];
    if (!renderer) return '';
    let html = renderer(block.data);
    // FIX2/FIX3: Apply glass tint/blur/opacity per block if configured
    // Apply in BOTH preview and export (glass is a real visual effect, not just builder UI)
    if (block.data.glassTint && block.data.glassTint !== 'none') {
      const blur = block.data.glassBlur || 0;
      const opac = block.data.glassOpacity !== undefined ? block.data.glassOpacity : 1;
      const glassCSS = 'box-shadow:inset 0 0 0 2000px ' + block.data.glassTint + ';'
        + (blur > 0 ? 'backdrop-filter:blur(' + blur + 'px);-webkit-backdrop-filter:blur(' + blur + 'px);' : '')
        + (opac < 1 ? 'opacity:' + opac + ';' : '');
      // FIX3: Instead of injecting style onto the block element (which overrides background),
      // inject a glass overlay div as the first child of the block's inner wrapper.
      // This preserves the block's own background while adding the glass tint on top.
      html = html.replace(
        /(<(?:section|nav|header|footer)[^>]*class="ss-block[^"]*"[^>]*>)/,
        '$1<div class="ss-glass-overlay" style="position:absolute;inset:0;pointer-events:none;z-index:0;' + glassCSS + ';border-radius:inherit;"></div>'
      );
      // Ensure the block has position:relative for the overlay to work
      html = html.replace(
        /(<(?:section|nav|header|footer)[^>]*class="ss-block[^"]*")/,
        '$1 data-glass="1"'
      );
    }
    // Wrap with an ID for selection
    return `<div class="ss-block-wrapper" data-block-id="${block.id}" style="position:relative;">
      ${html}
      ${!forExport ? `
      <div class="ss-block-controls" style="position:absolute;top:8px;right:8px;display:none;z-index:200;gap:4px;flex-wrap:nowrap;">
        <button onclick="window.parent.postMessage({type:'openBlockSettings',id:'${block.id}'},'*')" style="background:#1a1a2e;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;font-family:DM Sans,sans-serif;">✏️ Edit</button>
        <button onclick="window.parent.postMessage({type:'moveBlock',id:'${block.id}',dir:'up'},'*')" style="background:#1a1a2e;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;">↑</button>
        <button onclick="window.parent.postMessage({type:'moveBlock',id:'${block.id}',dir:'down'},'*')" style="background:#1a1a2e;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;">↓</button>
        <button onclick="window.parent.postMessage({type:'duplicateBlock',id:'${block.id}'},'*')" style="background:#1a1a2e;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;">⧉</button>
        <button onclick="window.parent.postMessage({type:'deleteBlock',id:'${block.id}'},'*')" style="background:#ef4444;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;">🗑</button>
      </div>` : ''}
    </div>`;
  }).join('\n');

  const emptyState = State.blocks.length === 0 && !forExport ? `
    <div style="min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#f8f8ff;font-family:DM Sans,sans-serif;">
      <div style="font-size:64px;">🏗️</div>
      <h2 style="font-size:24px;font-weight:700;color:#1a1a2e;font-family:Syne,sans-serif;">Your canvas is empty</h2>
      <p style="color:#666;font-size:16px;">Add blocks from the left panel to start building</p>
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
        <button onclick="window.parent.postMessage({type:'addBlock',blockType:'hero'},'*')" style="background:#ff6b35;color:white;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">+ Add Hero</button>
        <button onclick="window.parent.postMessage({type:'addBlock',blockType:'nav'},'*')" style="background:#1a1a2e;color:white;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">+ Add Nav</button>
        <button onclick="window.parent.postMessage({type:'addBlock',blockType:'features'},'*')" style="background:#1a1a2e;color:white;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">+ Add Features</button>
      </div>
    </div>
  ` : '';

  const previewInteractScript = !forExport ? `
    <script>
      // Block hover controls
      document.querySelectorAll('.ss-block-wrapper').forEach(wrap => {
        wrap.addEventListener('mouseenter', () => {
          const ctrl = wrap.querySelector('.ss-block-controls');
          if (ctrl) ctrl.style.display = 'flex';
        });
        wrap.addEventListener('mouseleave', () => {
          const ctrl = wrap.querySelector('.ss-block-controls');
          if (ctrl) ctrl.style.display = 'none';
        });

      // FIX4: Block external navigation in builder preview sandbox
      (function() {
        document.addEventListener('click', function(e) {
          var el = e.target;
          while (el && el.tagName !== 'A') el = el.parentElement;
          if (el && el.tagName === 'A') {
            var href = el.getAttribute('href') || '';
            if (href.charAt(0) === '#' || href === '' || href.indexOf('javascript') === 0) return;
            e.preventDefault(); e.stopPropagation();
            el.style.outline = '2px solid rgba(255,107,53,0.6)';
            setTimeout(function(){ if(el) el.style.outline = ''; }, 500);
          }
        }, true);
      })();
    </\script>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${document.getElementById('site-name-input')?.value || 'My Site'}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      ${cssVars}
    }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--font-body);
      color: var(--text);
      background: var(--bg);
      font-size: var(--font-base);
      line-height: var(--line-height);
      -webkit-font-smoothing: antialiased;
    }
    .ss-block-wrapper { position: relative; }
    .ss-block-controls { display: none; }
    ${template.extraCSS || ''}
    ${State.customCSS}
    @media (max-width: 768px) {
      [style*="grid-template-columns: repeat(3"] { grid-template-columns: repeat(2, 1fr) !important; }
      [style*="grid-template-columns: repeat(2"] { grid-template-columns: 1fr !important; }
      [style*="grid-template-columns: 1.5fr"] { grid-template-columns: 1fr !important; }
      [style*="min-height: 85vh"] { min-height: 60vh !important; }
      .ss-nav-links { display: none !important; }
    }

    /* FIX2: Preview-mode sizing normalization.
       In builder preview the iframe viewport is different from a real browser window.
       We normalize hero sizing so it fits the visible preview area correctly. */
    body.ss-preview-mode .ss-hero {
      /* Override the 120px fixed padding with a responsive value */
      padding-top: clamp(40px, 8vh, 80px) !important;
      padding-bottom: clamp(40px, 8vh, 80px) !important;
    }
    body.ss-preview-mode .ss-hero[style*="min-height:100vh"],
    body.ss-preview-mode .ss-hero[style*="min-height: 100vh"] {
      /* 100vh in preview iframe = iframe height, not window height.
         Cap to avoid massive scroll in builder. */
      min-height: min(100vh, 600px) !important;
    }
    body.ss-preview-mode .ss-hero[style*="min-height:85vh"],
    body.ss-preview-mode .ss-hero[style*="min-height: 85vh"] {
      min-height: min(85vh, 520px) !important;
    }
    body.ss-preview-mode .ss-hero[style*="min-height:60vh"],
    body.ss-preview-mode .ss-hero[style*="min-height: 60vh"] {
      min-height: min(60vh, 420px) !important;
    }
    /* Prevent orb decorations from expanding layout in preview */
    body.ss-preview-mode .ss-hero-orb {
      display: none !important;
    }
  </style>
</head>
<body${!forExport ? ' class="ss-preview-mode"' : ''}>
  ${blocksHTML || emptyState}
  ${previewInteractScript}
</body>
</html>`;
}

/* ──────────────────────────────────────────────────────────────────
   CORE FUNCTIONS
────────────────────────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════════
   SSV26.1 — AUTH SYSTEM & PASSWORD DATABASE
   ─────────────────────────────────────────────────────────────────
   HOW TO ADD A NEW USER:
     Find the SS_PASSWORD_DB section for their tier and add one line:
       'YOURCODE': { note: 'Who this is for' },

   HOW TO MOVE A USER TO A DIFFERENT TIER:
     Cut their entry from one tier block and paste it into another.

   CODES ARE CASE-INSENSITIVE — 'mypro' and 'MYPRO' both work.

   TO ADD A WHOLE NEW TIER in SSV26.2+:
     1. Add a new block to SS_PASSWORD_DB
     2. Add its limits to Auth.tiers
     3. Add its CSS class to style.css (.nav-tier-badge.newtier)

   SSV26.2+ UPGRADE PATH:
     Replace Auth.verify() body with a fetch() to your backend.
     SS_PASSWORD_DB can then move server-side. No other code changes.
══════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────────
   ★ PASSWORD DATABASE — EDIT THIS SECTION TO MANAGE USERS ★
   Each entry: 'CODE': { note: 'description (for your reference)' }
   Codes are matched case-insensitively.
───────────────────────────────────────────────────────────────── */
const SS_PASSWORD_DB = {

  // ── FREE / TRIAL ───────────────────────────────────────────────
  // Limits: 1 site per week · 30 min session per day
  free: {
    'SS26':      { note: 'Default public demo code' },
    'TRYME':     { note: 'General trial invite' },
    'FREETRIAL': { note: 'Marketing campaign — batch A' },
    // ↓ Add free codes below this line
  },

  // ── BASIC ──────────────────────────────────────────────────────
  // Limits: 1 site per day · 60 min session per day
  basic: {
    'SSBASIC':   { note: 'Default basic test code' },
    'BASIC2026': { note: 'Basic launch cohort' },
    // ↓ Add basic codes below this line
  },

  // ── PRO ────────────────────────────────────────────────────────
  // Limits: 3 sites per day · 180 min session per day
  pro: {
    'SSPRO':       { note: 'Default pro test code' },
    'PROLAUNCH':   { note: 'Pro early adopter — batch A' },
    'BUILDFAST':   { note: 'Pro early adopter — batch B' },
    // ↓ Add pro codes below this line
  },

  // ── AGENCY ─────────────────────────────────────────────────────
  // Limits: Unlimited sites · Unlimited session time
  agency: {
    'SSAGENCY':    { note: 'Default agency test code' },
    'AGENCYLAUNCH':{ note: 'Agency founding client — batch A' },
    'ROASRYE':     { note: 'My Personal Code' }
    // ↓ Add agency codes below this line
  },

};
/* ─────────────────────────────────────────────────────────────────
   END OF PASSWORD DATABASE — do not edit below this line
───────────────────────────────────────────────────────────────── */

const Auth = {
  version: 'SSV26.1',

  // ── Tier limits — update here for SSV26.2+ pricing changes ─────
  tiers: {
    free:   { label: 'Free Trial', sitesPerWeek: 1,   sitesPerDay: 0,   sessionMinutes: 30,   weekly: true  },
    basic:  { label: 'Basic',      sitesPerWeek: 0,   sitesPerDay: 1,   sessionMinutes: 60,   weekly: false },
    pro:    { label: 'Pro',        sitesPerWeek: 0,   sitesPerDay: 3,   sessionMinutes: 180,  weekly: false },
    agency: { label: 'Agency',     sitesPerWeek: 0,   sitesPerDay: 999, sessionMinutes: 9999, weekly: false },
  },

  /**
   * verify(code) → { ok: bool, tier, label, note, error }
   *
   * Looks up the code across all tiers in SS_PASSWORD_DB.
   * Case-insensitive. Returns the matched tier and its config.
   *
   * SSV26.2+ upgrade: replace this body with a fetch() call to your
   * auth endpoint. The rest of the app reads only ok/tier/label.
   */
  verify(code) {
    const normalised = code.trim().toUpperCase();
    if (!normalised) return { ok: false, error: 'Please enter an access code.' };

    // Walk every tier block in the database
    for (const [tierKey, entries] of Object.entries(SS_PASSWORD_DB)) {
      // Check every code in this tier (also case-insensitive keys)
      for (const [dbCode, meta] of Object.entries(entries)) {
        if (dbCode.toUpperCase() === normalised) {
          const tierCfg = this.tiers[tierKey] || this.tiers.free;
          return {
            ok:    true,
            tier:  tierKey,
            label: tierCfg.label,
            note:  meta.note || '',
          };
        }
      }
    }

    return { ok: false, error: 'Invalid access code. Check your invite email or see plans below.' };
  },

  /** Returns the tier limits config object for a given tier key */
  getTierConfig(tier) {
    return this.tiers[tier] || this.tiers.free;
  },

  /**
   * listCodes() — developer utility
   * Call Auth.listCodes() in the browser console to audit all codes.
   * Returns an array of { code, tier, note } for review.
   */
  listCodes() {
    const out = [];
    for (const [tier, entries] of Object.entries(SS_PASSWORD_DB)) {
      for (const [code, meta] of Object.entries(entries)) {
        out.push({ code, tier, label: this.tiers[tier]?.label || tier, note: meta.note });
      }
    }
    console.table(out);
    return out;
  },
};

/* ══════════════════════════════════════════════════════════════════
   SSV26.1 — USAGE TRACKER
   Tracks session time + site exports per day / per week.
   Resets daily (midnight local). Weekly resets for Free tier.
══════════════════════════════════════════════════════════════════ */
const UsageTracker = {
  _storageKey: 'ss_usage_v261',
  _timerInterval: null,
  _sessionStartMs: null,

  /** Load or initialise usage record from localStorage */
  _load() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return this._fresh();
  },

  _fresh() {
    const now = new Date();
    return {
      date: now.toDateString(),          // daily reset key
      week: this._weekKey(now),          // weekly reset key (Free tier)
      sessionSeconds: 0,                 // cumulative seconds this day
      exportsToday: 0,
      exportsThisWeek: 0,
      tier: 'free',
    };
  },

  _weekKey(d) {
    // ISO week number string for weekly reset
    const date = new Date(+d);
    date.setHours(0,0,0,0);
    date.setDate(date.getDate() + 4 - (date.getDay() || 7));
    const yearStart = new Date(date.getFullYear(),0,1);
    return date.getFullYear() + '-W' + Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  },

  _save(record) {
    try { localStorage.setItem(this._storageKey, JSON.stringify(record)); } catch(e) {}
  },

  /** Call after successful login to bind tier and reset if day changed */
  init(tier) {
    const now = new Date();
    let record = this._load();

    // Daily reset
    if (record.date !== now.toDateString()) {
      record.date = now.toDateString();
      record.sessionSeconds = 0;
      record.exportsToday = 0;
    }

    // Weekly reset (Free tier)
    const wk = this._weekKey(now);
    if (record.week !== wk) {
      record.week = wk;
      record.exportsThisWeek = 0;
    }

    record.tier = tier;
    this._save(record);
    this._sessionStartMs = Date.now();
    this._startTimer(record);
  },

  /** Start the 1-second UI timer */
  _startTimer(record) {
    if (this._timerInterval) clearInterval(this._timerInterval);
    let seconds = record.sessionSeconds;
    const cfg = Auth.getTierConfig(record.tier);
    const limitSec = cfg.sessionMinutes * 60;

    this._timerInterval = setInterval(() => {
      seconds++;
      // Persist every 10s to avoid hammering storage
      if (seconds % 10 === 0) {
        const r = this._load();
        r.sessionSeconds = seconds;
        this._save(r);
      }
      this._updateTimerUI(seconds, limitSec);

      // Enforce session time limit (non-agency)
      if (record.tier !== 'agency' && seconds >= limitSec) {
        clearInterval(this._timerInterval);
        this._showLimitModal('session');
      }
    }, 1000);
  },

  _updateTimerUI(seconds, limitSec) {
    const el = document.getElementById('nav-timer');
    if (!el) return;
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    el.textContent = mm + ':' + ss;
    const remaining = limitSec - seconds;
    el.classList.toggle('warning', remaining < 300 && remaining > 0);
    el.classList.toggle('danger',  remaining < 60  && remaining > 0);
  },

  /**
   * canExport() → bool
   * Call before allowing "It's Go Time" download.
   */
  canExport() {
    const r = this._load();
    const cfg = Auth.getTierConfig(r.tier);
    if (r.tier === 'agency') return true;
    if (cfg.weekly) return r.exportsThisWeek < cfg.sitesPerWeek;
    return r.exportsToday < cfg.sitesPerDay;
  },

  /** Call after a successful export */
  recordExport() {
    const r = this._load();
    r.exportsToday++;
    r.exportsThisWeek++;
    this._save(r);
  },

  /** Show the usage limit modal with contextual copy */
  _showLimitModal(type) {
    const r = this._load();
    const cfg = Auth.getTierConfig(r.tier);
    const titleEl = document.getElementById('ulm-title');
    const bodyEl  = document.getElementById('ulm-body');
    const badgeEl = document.getElementById('ulm-tier-badge');

    if (titleEl) titleEl.textContent = type === 'session'
      ? `Session limit reached (${cfg.sessionMinutes} min)`
      : `Export limit reached`;

    if (bodyEl) bodyEl.textContent = type === 'session'
      ? `Your ${cfg.label} plan allows ${cfg.sessionMinutes} minutes of builder time per day. Your session has ended. Come back tomorrow or upgrade your plan.`
      : `Your ${cfg.label} plan allows ${cfg.weekly ? cfg.sitesPerWeek + ' site/week' : cfg.sitesPerDay + ' site(s)/day'}. Upgrade to continue exporting.`;

    if (badgeEl) {
      badgeEl.textContent = cfg.label;
      badgeEl.className = 'lmt-tier lmt-' + r.tier;
    }

    const modal = document.getElementById('usage-limit-modal');
    if (modal) modal.style.display = 'flex';
  },

  showExportLimitModal() { this._showLimitModal('export'); },
};

/* ══════════════════════════════════════════════════════════════════
   SSV26.1 — LANDING PAGE FUNCTIONS
══════════════════════════════════════════════════════════════════ */

/** Open the login modal, optionally pre-scroll to pricing anchor */
function openLoginModal(planHint) {
  document.getElementById('login-modal').style.display = 'flex';
  const input = document.getElementById('gate-input');
  if (input) { input.value = ''; input.focus(); }
  document.getElementById('gate-error').textContent = '';
  document.getElementById('login-tier-hint').style.display = 'none';
}

function closeLoginModal() {
  document.getElementById('login-modal').style.display = 'none';
}

/** Live-preview tier name as user types code */
function previewTierFromCode(val) {
  const result = Auth.verify(val);
  const hint = document.getElementById('login-tier-hint');
  if (!hint) return;
  if (val.length >= 4 && result.ok) {
    hint.style.display = 'flex';
    hint.textContent = '✓ ' + result.label + ' plan detected';
  } else {
    hint.style.display = 'none';
  }
}

/** FAQ accordion toggle */
function toggleFaq(btn) {
  const answer = btn.nextElementSibling;
  const isOpen = answer.classList.contains('open');
  // Close all
  document.querySelectorAll('.lp-faq-a').forEach(a => a.classList.remove('open'));
  document.querySelectorAll('.lp-faq-q').forEach(b => b.classList.remove('open'));
  if (!isOpen) {
    answer.classList.add('open');
    btn.classList.add('open');
  }
}

/** Mobile nav toggle */
function toggleLpNav() {
  const menu = document.getElementById('lp-nav-mobile');
  if (menu) menu.classList.toggle('open');
}

/* ══════════════════════════════════════════════════════════════════
   SSV26.1 — BLOCK SELECTOR (Feature 6)
   Tracks which block types the user wants visible in the library
══════════════════════════════════════════════════════════════════ */
const BlockSelector = {
  _storageKey: 'ss_blockselector_v261',
  // All known block types
  _allTypes: ['nav','hero','leadform','testimonials','pricing','cta','features','gallery','footer'],

  /** Returns array of currently enabled block types */
  getEnabled() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return [...this._allTypes]; // default: all enabled
  },

  save(enabledTypes) {
    try { localStorage.setItem(this._storageKey, JSON.stringify(enabledTypes)); } catch(e) {}
  },

  /** Filter the sidebar block library to only show enabled blocks */
  applyToSidebar() {
    const enabled = this.getEnabled();
    document.querySelectorAll('.block-card').forEach(card => {
      // Derive type from onclick attribute
      const match = card.getAttribute('onclick')?.match(/addBlock\('(\w+)'\)/);
      if (!match) return;
      const type = match[1];
      card.style.display = enabled.includes(type) ? '' : 'none';
    });
  },
};

function openBlockSelectorModal() {
  const enabled = BlockSelector.getEnabled();
  const list = document.getElementById('block-selector-list');
  if (!list) return;

  const meta = {
    nav:          { icon: '🧭', label: 'Navigation',       desc: 'Site header & menu' },
    hero:         { icon: '⚡', label: 'Hero Section',     desc: 'Headline + CTA' },
    leadform:     { icon: '📋', label: 'Lead Form',        desc: 'Capture leads' },
    testimonials: { icon: '💬', label: 'Testimonials',     desc: 'Social proof cards' },
    pricing:      { icon: '💎', label: 'Pricing / Services',desc: 'Plans & tiers' },
    cta:          { icon: '🎯', label: 'CTA Section',      desc: 'Drive conversions' },
    features:     { icon: '✨', label: 'Features',         desc: 'Icon + text grid' },
    gallery:      { icon: '🖼️', label: 'Gallery',         desc: 'Image showcase' },
    footer:       { icon: '📌', label: 'Footer',           desc: 'Links & copyright' },
  };

  list.innerHTML = BlockSelector._allTypes.map(type => {
    const m = meta[type] || { icon: '◻', label: type, desc: '' };
    const on = enabled.includes(type);
    return `
      <div class="bsl-item ${on?'enabled':''}" data-type="${type}" onclick="toggleBslItem(this)">
        <div class="bsl-check">${on?'✓':''}</div>
        <span class="bsl-icon">${m.icon}</span>
        <div style="flex:1;">
          <div class="bsl-label">${m.label}</div>
          <div class="bsl-desc">${m.desc}</div>
        </div>
      </div>`;
  }).join('');

  document.getElementById('block-selector-modal').style.display = 'flex';
}

function toggleBslItem(el) {
  el.classList.toggle('enabled');
  const check = el.querySelector('.bsl-check');
  if (check) check.textContent = el.classList.contains('enabled') ? '✓' : '';
}

function closeBlockSelectorModal() {
  document.getElementById('block-selector-modal').style.display = 'none';
}

function saveBlockSelector() {
  const enabled = [];
  document.querySelectorAll('.bsl-item.enabled').forEach(el => {
    enabled.push(el.dataset.type);
  });
  BlockSelector.save(enabled);
  BlockSelector.applyToSidebar();
  closeBlockSelectorModal();
  showToast('✅ Block library updated', enabled.length + ' block types visible', 'success');
}

// ── Existing password gate function — now routes through Auth ──
function checkPassword() {
  const input = document.getElementById('gate-input');
  const error = document.getElementById('gate-error');
  const val = input.value.trim();
  const result = Auth.verify(val);

  if (result.ok) {
    State.authenticated = true;
    State.userTier = result.tier;

    // Close login modal
    closeLoginModal();

    // Hide landing page, show builder app
    const landing = document.getElementById('landing-page');
    if (landing) {
      landing.style.opacity = '0';
      landing.style.transition = 'opacity 0.4s ease';
      setTimeout(() => { landing.style.display = 'none'; }, 400);
    }

    const app = document.getElementById('app');
    if (app) {
      setTimeout(() => {
        app.style.display = 'flex';
        initApp();
      }, 420);
    }
  } else {
    error.textContent = '❌ ' + result.error;
    error.style.animation = 'none';
    requestAnimationFrame(() => { error.style.animation = 'shake 0.4s ease both'; });
    input.value = '';
    input.focus();
  }
}

// Allow Enter key on login modal input
document.addEventListener('keydown', function(e) {
  const loginModal = document.getElementById('login-modal');
  if (loginModal && loginModal.style.display !== 'none' && e.key === 'Enter') {
    checkPassword();
  }
});

// Initialize the app after successful login
function initApp() {
  // ── SSV26.1: Wire tier badge in nav ──────────────────────
  const tier = State.userTier || 'free';
  const tierBadge = document.getElementById('nav-tier-badge');
  if (tierBadge) {
    const cfg = Auth.getTierConfig(tier);
    tierBadge.textContent = cfg.label;
    tierBadge.className = 'nav-tier-badge ' + tier;
  }

  // ── SSV26.1: Start usage tracker ─────────────────────────
  UsageTracker.init(tier);

  // ── SSV26.1: Apply block selector preferences ─────────────
  BlockSelector.applyToSidebar();

  // ── Existing startup sequence (unchanged) ─────────────────
  applyTemplate('glass');
  loadStarterDemo();

// Auto-restore live collab session if one was active before page reload
(function() {
  const savedCode = localStorage.getItem('ss_collab_code');
  if (savedCode) {
    // Small delay so the DOM and State are fully initialized
    setTimeout(() => {
      // Re-init as owner by default (they can re-join as guest from the modal if needed)
      LiveSync.init(savedCode, true);
      console.log('[LiveSync] Auto-restored session:', savedCode);
      // Request fresh state from any other open tabs
      setTimeout(() => LiveSync._pollNow(), 400);
    }, 500);
  }
})();   // loads session or default demo blocks
  showToast('🎉 Welcome to Supersuite!', Auth.getTierConfig(tier).label + ' plan · ' + Auth.version, 'success');
}

// Refresh the live preview iframe
function refreshPreview() {
  const frame = document.getElementById('preview-frame');
  if (!frame) return;

  // FIX2: Set a stable minimum height BEFORE loading new content.
  // This prevents the viewport collapsing to 0 between srcdoc assignments,
  // which causes vh-based hero blocks to render at incorrect sizes.
  const currentH = parseInt(frame.style.height) || 0;
  if (currentH < 600) frame.style.height = '600px';

  const html = buildPreviewHTML(false);
  frame.srcdoc = html;

  // FIX1: Notify collab peers of state change (debounced inside notifyChange)
  LiveSync.notifyChange();

  // FIX2 C: After load, resize frame to fit content — but cap at a sensible max
  // to prevent hero vh expansion from making the builder canvas unusable.
  frame.onload = () => {
    try {
      const doc = frame.contentDocument || frame.contentWindow.document;
      if (!doc || !doc.body) return;

      // scrollHeight reflects actual rendered content height with ss-preview-mode CSS applied
      const contentH = doc.body.scrollHeight;

      // Enforce a minimum (empty canvas) and a reasonable maximum.
      // 8000px catches even long multi-block pages without runaway expansion.
      const clampedH = Math.max(Math.min(contentH, 8000), 400);
      frame.style.height = clampedH + 'px';
    } catch(e) {
      // Cross-origin or other error — keep existing height
    }
  };
}

/* ──────────────────────────────────────────────────────────────────
   BLOCK MANAGEMENT
────────────────────────────────────────────────────────────────── */
function addBlock(type) {
  const def = BlockDefs[type];
  if (!def) return;

  const id = 'block_' + (State.blockIdCounter++);
  const block = {
    id,
    type,
    label: def.label,
    icon: def.icon,
    data: JSON.parse(JSON.stringify(def.defaultData)), // deep clone
    visible: true,
  };

  State.blocks.push(block);
  History.push();
  refreshPreview();
  updateLayers();
  switchTab('layers');
  showToast('✅ Block added', def.label + ' block added to your page', 'success');
  return id;
}

function deleteBlock(id) {
  const idx = State.blocks.findIndex(b => b.id === id);
  if (idx === -1) return;
  const label = State.blocks[idx].label;
  State.blocks.splice(idx, 1);
  History.push();
  refreshPreview();
  updateLayers();
  showToast('🗑️ Block removed', label + ' was deleted', 'info');
}

function moveBlock(id, direction) {
  const idx = State.blocks.findIndex(b => b.id === id);
  if (idx === -1) return;
  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= State.blocks.length) return;
  const temp = State.blocks[idx];
  State.blocks[idx] = State.blocks[newIdx];
  State.blocks[newIdx] = temp;
  refreshPreview();
  updateLayers();
}

function duplicateBlock(id) {
  const orig = State.blocks.find(b => b.id === id);
  if (!orig) return;
  const newId = 'block_' + (State.blockIdCounter++);
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = newId;
  const origIdx = State.blocks.indexOf(orig);
  State.blocks.splice(origIdx + 1, 0, copy);
  refreshPreview();
  updateLayers();
  showToast('⧉ Duplicated', orig.label + ' block duplicated', 'info');
}

// Expose to iframe
window.addBlock = addBlock;
window.deleteBlock = deleteBlock;
window.moveBlock = moveBlock;
window.duplicateBlock = duplicateBlock;

/* ──────────────────────────────────────────────────────────────────
   LAYERS PANEL
────────────────────────────────────────────────────────────────── */
function updateLayers() {
  const list = document.getElementById('layers-list');
  if (State.blocks.length === 0) {
    list.innerHTML = '<p class="empty-layers">No blocks yet. Add blocks from the Blocks tab!</p>';
    return;
  }

  list.innerHTML = State.blocks.map((block, i) => `
    <div class="layer-item ${State.selectedBlockId === block.id ? 'active' : ''}"
         data-id="${block.id}"
         onclick="selectBlock('${block.id}')"
         draggable="true"
         ondragstart="layerDragStart(event,'${block.id}')"
         ondragover="layerDragOver(event,'${block.id}')"
         ondrop="layerDrop(event,'${block.id}')">
      <span class="layer-drag-handle">⠿</span>
      <span class="layer-icon">${block.icon}</span>
      <span class="layer-label">${block.label}</span>
      <div class="layer-actions">
        <button class="layer-btn" onclick="event.stopPropagation();openBlockSettings('${block.id}')" title="Edit">✏️</button>
        <button class="layer-btn" onclick="event.stopPropagation();moveBlock('${block.id}','up')" title="Move up">↑</button>
        <button class="layer-btn" onclick="event.stopPropagation();moveBlock('${block.id}','down')" title="Move down">↓</button>
        <button class="layer-btn danger" onclick="event.stopPropagation();deleteBlock('${block.id}')" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');
}

function selectBlock(id) {
  State.selectedBlockId = id;
  updateLayers();
  openBlockSettings(id);
}

// Layer drag & drop
let _dragSrcId = null;

function layerDragStart(e, id) {
  _dragSrcId = id;
  e.dataTransfer.effectAllowed = 'move';
}

function layerDragOver(e, id) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function layerDrop(e, targetId) {
  e.preventDefault();
  if (_dragSrcId === targetId) return;
  const srcIdx = State.blocks.findIndex(b => b.id === _dragSrcId);
  const tgtIdx = State.blocks.findIndex(b => b.id === targetId);
  const [moved] = State.blocks.splice(srcIdx, 1);
  State.blocks.splice(tgtIdx, 0, moved);
  _dragSrcId = null;
  refreshPreview();
  updateLayers();
}

/* ──────────────────────────────────────────────────────────────────
   BLOCK SETTINGS MODAL — dynamic forms per block type
────────────────────────────────────────────────────────────────── */
let _editingBlockId = null;
let _editingData = null;

window.openBlockSettings = function(id) {
  const block = State.blocks.find(b => b.id === id);
  if (!block) return;

  _editingBlockId = id;
  _editingData = JSON.parse(JSON.stringify(block.data));

  document.getElementById('bsm-title').textContent = block.icon + ' ' + block.label + ' Settings';
  // FIX2: Wrap block form + inject Glass tab at top level
  const blockForm = renderBlockSettingsForm(block.type, _editingData);
  const glassTab = renderGlassTab(_editingData);
  // Inject glass panel as top-level outer wrapper with its own tab
  document.getElementById('bsm-content').innerHTML = renderBlockModalWithGlass(blockForm, glassTab);
  document.getElementById('block-settings-modal').style.display = 'flex';
};

// FIX2: Glass Square Color System per block
function renderGlassTab(data) {
  const presets = [
    { label:'Frost', color:'rgba(255,255,255,0.12)', blur:16, opacity:0.9 },
    { label:'Midnight', color:'rgba(10,10,30,0.6)', blur:24, opacity:0.85 },
    { label:'Ember', color:'rgba(255,107,53,0.15)', blur:20, opacity:0.88 },
    { label:'Violet', color:'rgba(139,92,246,0.15)', blur:18, opacity:0.9 },
    { label:'Arctic', color:'rgba(59,130,246,0.12)', blur:22, opacity:0.92 },
    { label:'Obsidian', color:'rgba(0,0,0,0.75)', blur:32, opacity:0.95 },
  ];
  const tint = data.glassTint || 'none';
  const blur = data.glassBlur !== undefined ? data.glassBlur : 0;
  const opacity = data.glassOpacity !== undefined ? data.glassOpacity : 1;

  return `
    <p style="font-size:12px;color:var(--ui-text2);margin-bottom:12px;">Apply a glass panel tint that affects <strong>only this block</strong>.</p>

    <p style="font-size:11px;font-weight:700;color:var(--ui-accent);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Presets</p>
    <div class="bsm-glass-swatch">
      ${presets.map((p,i) => `
        <div class="glass-swatch-item ${tint===p.color?'active':''}"
          style="background:${p.color};backdrop-filter:blur(${p.blur}px);border:1px solid rgba(255,255,255,0.15);"
          title="${p.label}"
          onclick="applyGlassPreset('${p.color}',${p.blur},${p.opacity})">
        </div>
      `).join('')}
    </div>
    <div class="glass-swatch-item" style="background:none;border:1px dashed var(--ui-border2);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--ui-text2);width:auto;aspect-ratio:unset;padding:6px 10px;margin-bottom:12px;cursor:pointer;border-radius:6px;" onclick="applyGlassPreset('none',0,1)">✕ No Glass</div>

    <p style="font-size:11px;font-weight:700;color:var(--ui-accent);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Custom</p>
    <div class="glass-range-group">
      <label>Panel Tint Color <span id="glass-tint-preview" style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${tint==='none'?'transparent':tint};border:1px solid var(--ui-border);vertical-align:middle;"></span></label>
      <input type="color" value="#ffffff" style="width:100%;margin-top:4px;" oninput="updateGlassTint(this.value)"/>
    </div>
    <div class="glass-range-group">
      <label>Blur Intensity <span id="glass-blur-val">${blur}px</span></label>
      <input type="range" min="0" max="48" value="${blur}" oninput="_editingData.glassBlur=parseInt(this.value);document.getElementById('glass-blur-val').textContent=this.value+'px';applyGlassLive();livePreview()"/>
    </div>
    <div class="glass-range-group">
      <label>Block Opacity <span id="glass-opacity-val">${Math.round(opacity*100)}%</span></label>
      <input type="range" min="20" max="100" value="${Math.round(opacity*100)}" oninput="_editingData.glassOpacity=this.value/100;document.getElementById('glass-opacity-val').textContent=this.value+'%';applyGlassLive();livePreview()"/>
    </div>
  `;
}

function renderBlockModalWithGlass(blockForm, glassTab) {
  return `
    <div style="border-bottom:1px solid var(--ui-border);margin-bottom:0;display:flex;gap:0;">
      <button class="bsm-tab active" style="padding:10px 16px;font-size:12px;" onclick="switchOuterBSMTab(event,'outer-block-form')">⚙ Settings</button>
      <button class="bsm-tab" style="padding:10px 16px;font-size:12px;" onclick="switchOuterBSMTab(event,'outer-glass-form')">🪟 Glass Panel</button>
    </div>
    <div id="outer-block-form" style="display:block;">${blockForm}</div>
    <div id="outer-glass-form" style="display:none;padding:4px 0;">${glassTab}</div>
  `;
}

function switchOuterBSMTab(event, panelId) {
  const modal = document.getElementById('bsm-content');
  modal.querySelectorAll('.bsm-tab').forEach(t => t.classList.remove('active'));
  modal.querySelectorAll('#outer-block-form, #outer-glass-form').forEach(p => p.style.display = 'none');
  event.target.classList.add('active');
  const panel = document.getElementById(panelId);
  if (panel) panel.style.display = 'block';
}

function applyGlassPreset(color, blur, opacity) {
  if (!_editingData) return;
  _editingData.glassTint = color;
  _editingData.glassBlur = blur;
  _editingData.glassOpacity = opacity;
  // Re-render glass tab
  const glassPanel = document.getElementById('outer-glass-form');
  if (glassPanel) glassPanel.innerHTML = renderGlassTab(_editingData);
  applyGlassLive();
}

function updateGlassTint(hexColor) {
  if (!_editingData) return;
  // Convert hex to rgba with 0.3 alpha
  const r = parseInt(hexColor.slice(1,3),16);
  const g = parseInt(hexColor.slice(3,5),16);
  const b = parseInt(hexColor.slice(5,7),16);
  _editingData.glassTint = 'rgba('+r+','+g+','+b+',0.3)';
  const prev = document.getElementById('glass-tint-preview');
  if (prev) prev.style.background = _editingData.glassTint;
  applyGlassLive();
}

function applyGlassLive() {
  // Immediately apply glass to the block in the iframe for live feedback
  if (!_editingBlockId) return;
  const frame = document.getElementById('preview-frame');
  if (!frame || !frame.contentDocument) return;
  try {
    const blockEl = frame.contentDocument.querySelector('[data-block-id="'+_editingBlockId+'"]');
    if (blockEl) {
      const tint = _editingData.glassTint || 'none';
      const blur = _editingData.glassBlur || 0;
      const opacity = _editingData.glassOpacity !== undefined ? _editingData.glassOpacity : 1;
      blockEl.style.backdropFilter = blur > 0 ? 'blur('+blur+'px)' : '';
      blockEl.style.opacity = opacity;
      if (tint !== 'none') {
        blockEl.style.boxShadow = 'inset 0 0 0 2000px ' + tint;
      } else {
        blockEl.style.boxShadow = '';
      }
    }
  } catch(e) {}
}

function renderBlockSettingsForm(type, data) {
  const forms = {
    hero: renderHeroForm,
    nav: renderNavForm,
    leadform: renderLeadFormForm,
    testimonials: renderTestimonialsForm,
    pricing: renderPricingForm,
    cta: renderCTAForm,
    features: renderFeaturesForm,
    gallery: renderGalleryForm,
    footer: renderFooterForm,
  };
  return forms[type] ? forms[type](data) : '<p style="color:#666;padding:16px;">No settings available for this block.</p>';
}

function renderHeroForm(data) {
  // FIX13: Compact tabbed editor with live preview dot + immediate state binding
  return `
    <div class="hero-live-preview-strip">
      <div class="hero-live-dot"></div>
      <span>Live — changes reflect instantly in preview</span>
    </div>
    <div class="bsm-tabs hero-compact-editor">
      <button class="bsm-tab active" onclick="switchBSMTab(event,'hero-content-panel')">✍ Content</button>
      <button class="bsm-tab" onclick="switchBSMTab(event,'hero-design-panel')">🎨 Design</button>
      <button class="bsm-tab" onclick="switchBSMTab(event,'hero-btns-panel')">🔘 Buttons</button>
      <button class="bsm-tab" onclick="switchBSMTab(event,'hero-elements-panel')">🎭 Elements</button>
    </div>

    <div id="hero-content-panel" class="bsm-panel active">
      <div class="bsm-field"><label>Headline</label>
        <textarea rows="2" oninput="_editingData.heading=this.value;heroLiveUpdate();livePreview()">${data.heading}</textarea>
      </div>
      <div class="bsm-field"><label>Subheading</label>
        <textarea rows="2" oninput="_editingData.subheading=this.value;heroLiveUpdate();livePreview()">${data.subheading}</textarea>
      </div>
      <div class="bsm-field"><label>Badge Text</label>
        <input type="text" value="${data.badgeText}" oninput="_editingData.badgeText=this.value;heroLiveUpdate();livePreview()"/>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="bsm-field"><label>Show Badge</label>
          <select onchange="_editingData.showBadge=this.value==='true';heroLiveUpdate();livePreview()">
            <option value="true" ${data.showBadge?'selected':''}>Yes</option>
            <option value="false" ${!data.showBadge?'selected':''}>No</option>
          </select>
        </div>
        <div class="bsm-field"><label>Alignment</label>
          <select onchange="_editingData.alignment=this.value;heroLiveUpdate();livePreview()">
            <option value="center" ${data.alignment==='center'?'selected':''}>Center</option>
            <option value="left" ${data.alignment==='left'?'selected':''}>Left</option>
          </select>
        </div>
      </div>
      <div class="bsm-field"><label>Min Height</label>
        <select onchange="_editingData.minHeight=this.value;heroLiveUpdate();livePreview()">
          <option value="50vh" ${data.minHeight==='50vh'?'selected':''}>50vh — Compact</option>
          <option value="60vh" ${data.minHeight==='60vh'?'selected':''}>60vh — Medium</option>
          <option value="85vh" ${data.minHeight==='85vh'?'selected':''}>85vh — Tall</option>
          <option value="100vh" ${data.minHeight==='100vh'?'selected':''}>100vh — Full screen</option>
        </select>
      </div>
    </div>

    <div id="hero-design-panel" class="bsm-panel">
      <div class="bsm-field"><label>Background Type</label>
        <select onchange="_editingData.bgType=this.value;heroLiveUpdate();livePreview()">
          <option value="gradient" ${data.bgType==='gradient'?'selected':''}>Gradient</option>
          <option value="solid" ${data.bgType==='solid'?'selected':''}>Solid Color</option>
          <option value="image" ${data.bgType==='image'?'selected':''}>Image URL</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="bsm-color-row"><label>BG Color 1</label>
          <input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value;heroLiveUpdate();livePreview()"/>
        </div>
        <div class="bsm-color-row"><label>BG Color 2</label>
          <input type="color" value="${data.bgColor2}" oninput="_editingData.bgColor2=this.value;heroLiveUpdate();livePreview()"/>
        </div>
      </div>
      <div class="bsm-field"><label>Background Image URL</label>
        <input type="url" value="${data.bgImage||''}" placeholder="https://…"
          oninput="_editingData.bgImage=this.value;heroLiveUpdate();livePreview()"/>
      </div>
      <div class="bsm-color-row"><label>Text Color</label>
        <input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value;heroLiveUpdate();livePreview()"/>
      </div>
    </div>

    <div id="hero-btns-panel" class="bsm-panel">
      <p style="font-size:11px;font-weight:700;color:var(--ui-accent);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Primary Button</p>
      <div class="bsm-field"><label>Text</label><input type="text" value="${data.btnText}" oninput="_editingData.btnText=this.value;heroLiveUpdate();livePreview()"/></div>
      <div class="bsm-field"><label>Link</label><input type="url" value="${data.btnLink}" oninput="_editingData.btnLink=this.value;livePreview()"/></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="bsm-color-row"><label>Btn Color</label><input type="color" value="${data.btnColor}" oninput="_editingData.btnColor=this.value;heroLiveUpdate();livePreview()"/></div>
        <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.btnTextColor}" oninput="_editingData.btnTextColor=this.value;heroLiveUpdate();livePreview()"/></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--ui-border);margin:14px 0;"/>
      <p style="font-size:11px;font-weight:700;color:var(--ui-text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Secondary Button</p>
      <div class="bsm-field"><label>Text</label><input type="text" value="${data.btn2Text}" oninput="_editingData.btn2Text=this.value;heroLiveUpdate();livePreview()"/></div>
      <div class="bsm-field"><label>Link</label><input type="url" value="${data.btn2Link}" oninput="_editingData.btn2Link=this.value;livePreview()"/></div>
    </div>

    <div id="hero-elements-panel" class="bsm-panel">
      <p style="font-size:11px;color:var(--ui-text2);margin-bottom:14px;">FIX7/10: Per-element color control for this hero block.</p>
      <div class="element-color-grid">
        <div class="ecg-item">
          <span class="ecg-label">🔤 Heading</span>
          <div class="ecg-colors">
            <input type="color" title="Color" value="${data.elemHeadingColor||data.textColor}" oninput="_editingData.elemHeadingColor=this.value;heroLiveUpdate();livePreview()"/>
          </div>
        </div>
        <div class="ecg-item">
          <span class="ecg-label">📝 Subtext</span>
          <div class="ecg-colors">
            <input type="color" title="Color" value="${data.elemSubColor||data.textColor}" oninput="_editingData.elemSubColor=this.value;heroLiveUpdate();livePreview()"/>
          </div>
        </div>
        <div class="ecg-item">
          <span class="ecg-label">🏷 Badge</span>
          <div class="ecg-colors">
            <input type="color" title="BG" value="${data.elemBadgeBg||'rgba(255,255,255,0.1)'}" oninput="_editingData.elemBadgeBg=this.value;heroLiveUpdate();livePreview()"/>
            <input type="color" title="Text" value="${data.elemBadgeColor||data.textColor}" oninput="_editingData.elemBadgeColor=this.value;heroLiveUpdate();livePreview()"/>
          </div>
        </div>
      </div>
    </div>
  `;
}

// FIX13: Live update without closing modal
function heroLiveUpdate() {
  if (!_editingBlockId || !_editingData) return;
  const block = State.blocks.find(b => b.id === _editingBlockId);
  if (!block || block.type !== 'hero') return;
  block.data = JSON.parse(JSON.stringify(_editingData));
  // Update iframe without full reload for responsiveness
  const frame = document.getElementById('preview-frame');
  if (frame && frame.contentDocument) {
    try {
      const heroEl = frame.contentDocument.querySelector('.ss-hero');
      if (heroEl) {
        const d = _editingData;
        const bg = d.bgType === 'image' && d.bgImage
          ? "url('" + d.bgImage + "') center/cover no-repeat"
          : "linear-gradient(135deg, " + d.bgColor + " 0%, " + d.bgColor2 + " 100%)";
        heroEl.style.background = bg;
        heroEl.style.color = d.textColor;
        heroEl.style.minHeight = d.minHeight;
        const h1 = heroEl.querySelector('h1');
        if (h1) { h1.textContent = d.heading; if (d.elemHeadingColor) h1.style.color = d.elemHeadingColor; }
        const sub = heroEl.querySelector('p');
        if (sub) { sub.textContent = d.subheading; if (d.elemSubColor) sub.style.opacity = '1', sub.style.color = d.elemSubColor; }
        const btn = heroEl.querySelector('.ss-btn-primary');
        if (btn) { btn.textContent = d.btnText + ' →'; btn.style.background = d.btnColor; btn.style.color = d.btnTextColor; }
        // If DOM patch fails cleanly, fall through — refreshPreview handles it
        return;
      }
    } catch(e) {}
  }
  refreshPreview();
}

function renderNavForm(data) {
  // FIX3: Expanded nav form with full background type support
  const bgType = data.bgType || 'solid';
  return `
    <div class="bsm-tabs">
      <button class="bsm-tab active" onclick="switchBSMTab(event,'nav-content-panel')">Content</button>
      <button class="bsm-tab" onclick="switchBSMTab(event,'nav-style-panel')">🎨 Style</button>
    </div>

    <div id="nav-content-panel" class="bsm-panel active">
      <div class="bsm-field"><label>Logo Text</label><input type="text" value="${data.logo}" oninput="_editingData.logo=this.value;livePreview()"/></div>
      <div class="bsm-field"><label>Nav Links (comma-separated)</label><input type="text" value="${data.links.join(',')}" oninput="_editingData.links=this.value.split(',').map(l=>l.trim()).filter(l=>l);livePreview()"/></div>
      <div class="bsm-field"><label>CTA Button Text</label><input type="text" value="${data.ctaText}" oninput="_editingData.ctaText=this.value;livePreview()"/></div>
      <div class="bsm-field"><label>CTA Button Link</label><input type="url" value="${data.ctaLink}" oninput="_editingData.ctaLink=this.value;livePreview()"/></div>
      <div class="bsm-field"><label>Sticky Navigation</label><select onchange="_editingData.sticky=this.value==='true';livePreview()"><option value="true" ${data.sticky?'selected':''}>Yes</option><option value="false" ${!data.sticky?'selected':''}>No</option></select></div>
    </div>

    <div id="nav-style-panel" class="bsm-panel">
      <div class="bsm-field"><label>Background Type</label>
        <select onchange="_editingData.bgType=this.value;livePreview()">
          <option value="solid" ${bgType==='solid'?'selected':''}>Solid Color</option>
          <option value="gradient" ${bgType==='gradient'?'selected':''}>Gradient</option>
          <option value="image" ${bgType==='image'?'selected':''}>Image URL</option>
          <option value="transparent" ${bgType==='transparent'?'selected':''}>Transparent</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="bsm-color-row" style="margin:0;"><label>${bgType==='gradient'?'Gradient Start':'Background'}</label><input type="color" value="${data.bgColor||'#ffffff'}" oninput="_editingData.bgColor=this.value;livePreview()"/></div>
        ${bgType==='gradient' ? `<div class="bsm-color-row" style="margin:0;"><label>Gradient End</label><input type="color" value="${data.bgColor2||data.bgColor||'#f0f0f0'}" oninput="_editingData.bgColor2=this.value;livePreview()"/></div>` : ''}
        <div class="bsm-color-row" style="margin:0;"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value;livePreview()"/></div>
        <div class="bsm-color-row" style="margin:0;"><label>CTA Button Color</label><input type="color" value="${data.ctaBgColor}" oninput="_editingData.ctaBgColor=this.value;livePreview()"/></div>
      </div>
      ${bgType==='image' ? `<div class="bsm-field"><label>Background Image URL</label><input type="url" value="${data.bgImage||''}" placeholder="https://example.com/image.jpg" oninput="_editingData.bgImage=this.value;livePreview()"/></div>` : ''}
      ${bgType==='gradient' ? `<div class="bsm-field"><label>Gradient Angle</label><input type="range" min="0" max="360" value="${data.bgGradientAngle||135}" oninput="_editingData.bgGradientAngle=parseInt(this.value);livePreview()"/></div>` : ''}
    </div>
  `;
}

function renderLeadFormForm(data) {
  return `
    <div class="bsm-tabs">
      <button class="bsm-tab active" onclick="switchBSMTab(event,'lf-content-panel')">Content</button>
      <button class="bsm-tab" onclick="switchBSMTab(event,'lf-fields-panel')">Fields</button>
      <button class="bsm-tab" onclick="switchBSMTab(event,'lf-webhook-panel')">🔗 Backend</button>
    </div>

    <div id="lf-content-panel" class="bsm-panel active">
      <div class="bsm-field"><label>Section Heading</label><input type="text" value="${data.heading}" oninput="_editingData.heading=this.value;livePreview()"/></div>
      <div class="bsm-field"><label>Subheading</label><textarea oninput="_editingData.subheading=this.value;livePreview()">${data.subheading}</textarea></div>
      <div class="bsm-field"><label>Button Text</label><input type="text" value="${data.btnText}" oninput="_editingData.btnText=this.value;livePreview()"/></div>
      <div class="bsm-field"><label>Privacy Note</label><input type="text" value="${data.privacyText}" oninput="_editingData.privacyText=this.value;livePreview()"/></div>
      <div class="bsm-field"><label>Success Message</label><input type="text" value="${data.successMsg||"You're on the list!"}" oninput="_editingData.successMsg=this.value;livePreview()"/></div>
      <div class="bsm-field"><label>Error Message</label><input type="text" value="${data.errorMsg||'Something went wrong. Please try again.'}" oninput="_editingData.errorMsg=this.value;livePreview()"/></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="bsm-color-row" style="margin:0;"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value;livePreview()"/></div>
        <div class="bsm-color-row" style="margin:0;"><label>Text</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value;livePreview()"/></div>
        <div class="bsm-color-row" style="margin:0;"><label>Button</label><input type="color" value="${data.btnColor}" oninput="_editingData.btnColor=this.value;livePreview()"/></div>
        <div class="bsm-color-row" style="margin:0;"><label>Accent</label><input type="color" value="${data.accentColor}" oninput="_editingData.accentColor=this.value;livePreview()"/></div>
      </div>
    </div>

    <div id="lf-fields-panel" class="bsm-panel">
      <p style="font-size:12px;color:var(--ui-text2);margin-bottom:12px;">Configure which fields appear in the form.</p>
      ${data.fields.map((f, i) => `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:8px;">
          <p style="font-size:11px;font-weight:700;color:var(--ui-accent);margin-bottom:8px;">Field ${i+1}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div class="bsm-field"><label>Type</label>
              <select onchange="_editingData.fields[${i}].type=this.value;livePreview()">
                <option value="text" ${f.type==='text'?'selected':''}>Text</option>
                <option value="email" ${f.type==='email'?'selected':''}>Email</option>
                <option value="tel" ${f.type==='tel'?'selected':''}>Phone</option>
                <option value="number" ${f.type==='number'?'selected':''}>Number</option>
                <option value="textarea" ${f.type==='textarea'?'selected':''}>Textarea</option>
              </select>
            </div>
            <div class="bsm-field"><label>Field Name</label>
              <input type="text" value="${f.name||''}" placeholder="email" oninput="_editingData.fields[${i}].name=this.value;livePreview()"/>
            </div>
          </div>
          <div class="bsm-field"><label>Placeholder</label>
            <input type="text" value="${f.placeholder}" oninput="_editingData.fields[${i}].placeholder=this.value;livePreview()"/>
          </div>
        </div>
      `).join('')}
      <button class="add-tier-btn" onclick="leadformAddField()">＋ Add Field</button>
    </div>

    <div id="lf-webhook-panel" class="bsm-panel">
      <div class="webhook-section">
        <h5>🔗 Webhook Endpoint</h5>
        <p style="font-size:12px;color:var(--ui-text2);margin-bottom:10px;">POST JSON to your endpoint on every submission. Works with Zapier, Make, n8n, and any webhook receiver.</p>
        <div class="bsm-field"><label>Webhook URL</label>
          <input type="url" value="${data.webhookUrl||''}" placeholder="https://hooks.zapier.com/hooks/catch/…"
            oninput="_editingData.webhookUrl=this.value;livePreview()"/>
        </div>
        <button class="webhook-test-btn" onclick="testWebhook()">▶ Send Test Payload</button>
        <div id="webhook-test-status" class="webhook-status"></div>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--ui-border);">
        <p style="font-size:12px;font-weight:600;color:var(--ui-text2);margin-bottom:8px;">FIELD MAPPING</p>
        <p style="font-size:11px;color:var(--ui-text2);margin-bottom:10px;">Fields are sent as JSON keys using each field's name. Make sure field names are unique.</p>
        ${data.fields.map((f,i) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;">
            <span style="background:var(--ui-surface2);border:1px solid var(--ui-border);padding:3px 8px;border-radius:4px;font-family:monospace;color:var(--ui-accent);">${f.name||'field'+i}</span>
            <span style="color:var(--ui-text2);">→</span>
            <span style="color:var(--ui-text);">${f.placeholder}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function leadformAddField() {
  if (!_editingData) return;
  _editingData.fields.push({ type: 'text', placeholder: 'New field', name: 'field' + _editingData.fields.length });
  const content = document.getElementById('bsm-content');
  if (content) {
    content.innerHTML = renderLeadFormForm(_editingData);
    const fieldsTab = content.querySelector('.bsm-tab:nth-child(2)');
    if (fieldsTab) fieldsTab.click();
  }
}

async function testWebhook() {
  const url = _editingData?.webhookUrl;
  const statusEl = document.getElementById('webhook-test-status');
  if (!url) { if (statusEl) { statusEl.textContent = '⚠️ Enter a webhook URL first'; statusEl.className = 'webhook-status fail'; } return; }
  if (statusEl) { statusEl.textContent = '⏳ Sending test payload…'; statusEl.className = 'webhook-status'; }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _test: true, source: 'supersuite_builder', name: 'Test User', email: 'test@example.com', ts: new Date().toISOString() }),
      mode: 'no-cors',
    });
    if (statusEl) { statusEl.textContent = '✅ Payload sent (check your endpoint)'; statusEl.className = 'webhook-status ok'; }
  } catch(e) {
    if (statusEl) { statusEl.textContent = '❌ Request failed: ' + e.message; statusEl.className = 'webhook-status fail'; }
  }
}

function renderTestimonialsForm(data) {
  return `
    <div class="bsm-field"><label>Section Heading</label><input type="text" value="${data.heading}" oninput="_editingData.heading=this.value;livePreview()"/></div>
    <div class="bsm-field"><label>Subheading</label><input type="text" value="${data.subheading}" oninput="_editingData.subheading=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Accent Color</label><input type="color" value="${data.accentColor}" oninput="_editingData.accentColor=this.value;livePreview()"/></div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:16px 0;"/>
    <p style="font-size:12px;color:#666;margin-bottom:12px;font-weight:600;">TESTIMONIAL CARDS</p>
    ${data.cards.map((c, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:12px;">
        <p style="font-size:11px;font-weight:700;color:#ff6b35;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Card ${i+1}</p>
        <div class="bsm-field"><label>Name</label><input type="text" value="${c.name}" oninput="_editingData.cards[${i}].name=this.value;livePreview()"/></div>
        <div class="bsm-field"><label>Role</label><input type="text" value="${c.role}" oninput="_editingData.cards[${i}].role=this.value;livePreview()"/></div>
        <div class="bsm-field"><label>Quote</label><textarea oninput="_editingData.cards[${i}].quote=this.value;livePreview()">${c.quote}</textarea></div>
        <div class="bsm-field"><label>Rating (1-5)</label><select onchange="_editingData.cards[${i}].rating=parseInt(this.value);livePreview()">${[1,2,3,4,5].map(n=>`<option value="${n}" ${c.rating===n?'selected':''}>${n} stars</option>`).join('')}</select></div>
      </div>
    `).join('')}
  `;
}

function renderPricingForm(data) {
  // FIX3: Dynamic unlimited tiers with per-tier styling
  const tiersHTML = data.plans.map((p, i) => `
    <div class="pricing-tier-card" id="ptier-${i}">
      <div class="pricing-tier-header">
        <span class="pricing-tier-label">Tier ${i+1}: ${p.name}</span>
        <div class="pricing-tier-actions">
          <button class="tier-action-btn" onclick="pricingMoveTier(${i},'up')" title="Move up">↑</button>
          <button class="tier-action-btn" onclick="pricingMoveTier(${i},'down')" title="Move down">↓</button>
          <button class="tier-action-btn danger" onclick="pricingDeleteTier(${i})" title="Remove tier">✕</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <div class="bsm-field"><label>Tier Name</label><input type="text" value="${p.name}" oninput="_editingData.plans[${i}].name=this.value;document.querySelector('#ptier-${i} .pricing-tier-label').textContent='Tier ${i+1}: '+this.value;livePreview()"/></div>
        <div class="bsm-field"><label>Price</label><input type="text" value="${p.price}" oninput="_editingData.plans[${i}].price=this.value;livePreview()"/></div>
        <div class="bsm-field"><label>Billing Cycle</label><input type="text" value="${p.period}" placeholder="/month" oninput="_editingData.plans[${i}].period=this.value;livePreview()"/></div>
        <div class="bsm-field"><label>Highlight?</label><select onchange="_editingData.plans[${i}].featured=this.value==='true';livePreview()"><option value="false" ${!p.featured?'selected':''}>No</option><option value="true" ${p.featured?'selected':''}>⭐ Yes</option></select></div>
      </div>
      <div class="bsm-field"><label>Description</label><input type="text" value="${p.description}" oninput="_editingData.plans[${i}].description=this.value;livePreview()"/></div>
      <div class="bsm-field"><label>CTA Button Text</label><input type="text" value="${p.ctaText}" oninput="_editingData.plans[${i}].ctaText=this.value;livePreview()"/></div>
      <div class="bsm-field"><label>Features (one per line)</label>
        <textarea rows="4" oninput="(function(el,idx){var lines=el.value.split('\n').map(function(f){return f.trim();}).filter(function(f){return f.length>0;});_editingData.plans[idx].features=lines;livePreview();})(this,${i})">${p.features.map(function(f){return f;}).join('\n')}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.07);">
        <div class="bsm-color-row" style="margin:0;"><label>Card Color</label><input type="color" value="${p.bgColor||'#1a1a2e'}" oninput="_editingData.plans[${i}].bgColor=this.value;livePreview()"/></div>
        <div class="bsm-color-row" style="margin:0;"><label>Border</label><input type="color" value="${(p.borderColor||'#2a2a4e').replace(/rgba?\([^)]+\)/,'#2a2a4e')}" oninput="_editingData.plans[${i}].borderColor=this.value;livePreview()"/></div>
      </div>
    </div>
  `).join('');

  return `
    <div class="bsm-tabs">
      <button class="bsm-tab active" onclick="switchBSMTab(event,'pricing-section-panel')">Section</button>
      <button class="bsm-tab" onclick="switchBSMTab(event,'pricing-tiers-panel')">💎 Tiers (${data.plans.length})</button>
    </div>

    <div id="pricing-section-panel" class="bsm-panel active">
      <div class="bsm-field"><label>Section Heading</label><input type="text" value="${data.heading}" oninput="_editingData.heading=this.value;livePreview()"/></div>
      <div class="bsm-field"><label>Subheading</label><input type="text" value="${data.subheading}" oninput="_editingData.subheading=this.value;livePreview()"/></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="bsm-color-row" style="margin:0;"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value;livePreview()"/></div>
        <div class="bsm-color-row" style="margin:0;"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value;livePreview()"/></div>
        <div class="bsm-color-row" style="margin:0;"><label>Accent</label><input type="color" value="${data.accentColor}" oninput="_editingData.accentColor=this.value;livePreview()"/></div>
      </div>
    </div>

    <div id="pricing-tiers-panel" class="bsm-panel">
      <p style="font-size:12px;color:var(--ui-text2);margin-bottom:12px;">Add unlimited tiers. Each is independently styled.</p>
      <div id="pricing-tiers-list">${tiersHTML}</div>
      <button class="add-tier-btn" onclick="pricingAddTier()">＋ Add New Tier</button>
    </div>
  `;
}

// FIX3: Pricing tier helpers
function pricingAddTier() {
  if (!_editingData) return;
  _editingData.plans.push({
    name: 'New Tier',
    price: '$0',
    period: '/month',
    description: 'Describe this plan.',
    features: ['Feature one', 'Feature two', 'Feature three'],
    ctaText: 'Get Started',
    ctaLink: '#',
    featured: false,
    bgColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.1)',
  });
  // Re-render the modal content
  const content = document.getElementById('bsm-content');
  if (content) {
    content.innerHTML = renderPricingForm(_editingData);
    // Switch to tiers panel
    const tiersTab = content.querySelector('.bsm-tab:nth-child(2)');
    if (tiersTab) tiersTab.click();
  }
}

function pricingDeleteTier(idx) {
  if (!_editingData || _editingData.plans.length <= 1) {
    showToast('⚠️ Cannot remove', 'Must have at least one tier', 'warning');
    return;
  }
  _editingData.plans.splice(idx, 1);
  const content = document.getElementById('bsm-content');
  if (content) {
    content.innerHTML = renderPricingForm(_editingData);
    const tiersTab = content.querySelector('.bsm-tab:nth-child(2)');
    if (tiersTab) tiersTab.click();
  }
}

function pricingMoveTier(idx, dir) {
  if (!_editingData) return;
  const plans = _editingData.plans;
  const newIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= plans.length) return;
  [plans[idx], plans[newIdx]] = [plans[newIdx], plans[idx]];
  const content = document.getElementById('bsm-content');
  if (content) {
    content.innerHTML = renderPricingForm(_editingData);
    const tiersTab = content.querySelector('.bsm-tab:nth-child(2)');
    if (tiersTab) tiersTab.click();
  }
}

function renderCTAForm(data) {
  return `
    <div class="bsm-field"><label>Heading</label><textarea oninput="_editingData.heading=this.value;livePreview()">${data.heading}</textarea></div>
    <div class="bsm-field"><label>Subheading</label><textarea oninput="_editingData.subheading=this.value;livePreview()">${data.subheading}</textarea></div>
    <div class="bsm-field"><label>Background Type</label><select onchange="_editingData.bgType=this.value;livePreview()"><option value="gradient" ${data.bgType==='gradient'?'selected':''}>Gradient</option><option value="solid">Solid</option><option value="image">Image URL</option></select></div>
    <div class="bsm-color-row"><label>BG Color 1</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>BG Color 2</label><input type="color" value="${data.bgColor2}" oninput="_editingData.bgColor2=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value;livePreview()"/></div>
    <div class="bsm-field"><label>Primary Button</label><input type="text" value="${data.btnText}" oninput="_editingData.btnText=this.value;livePreview()"/></div>
    <div class="bsm-field"><label>Primary Link</label><input type="url" value="${data.btnLink}" oninput="_editingData.btnLink=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Button Color</label><input type="color" value="${data.btnColor}" oninput="_editingData.btnColor=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Button Text Color</label><input type="color" value="${data.btnTextColor}" oninput="_editingData.btnTextColor=this.value;livePreview()"/></div>
    <div class="bsm-field"><label>Secondary Button</label><input type="text" value="${data.btn2Text}" oninput="_editingData.btn2Text=this.value;livePreview()"/></div>
  `;
}

function renderFeaturesForm(data) {
  return `
    <div class="bsm-field"><label>Section Heading</label><input type="text" value="${data.heading}" oninput="_editingData.heading=this.value;livePreview()"/></div>
    <div class="bsm-field"><label>Subheading</label><input type="text" value="${data.subheading}" oninput="_editingData.subheading=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Accent Color</label><input type="color" value="${data.accentColor}" oninput="_editingData.accentColor=this.value;livePreview()"/></div>
    <div class="bsm-field"><label>Columns</label><select onchange="_editingData.columns=parseInt(this.value);livePreview()"><option value="2" ${data.columns===2?'selected':''}>2 columns</option><option value="3" ${data.columns===3?'selected':''}>3 columns</option><option value="4" ${data.columns===4?'selected':''}>4 columns</option></select></div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:16px 0;"/>
    ${data.items.map((item, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:8px;">
        <p style="font-size:11px;font-weight:700;color:#ff6b35;margin-bottom:8px;">Feature ${i+1}</p>
        <div class="bsm-field"><label>Icon (emoji)</label><input type="text" value="${item.icon}" oninput="_editingData.items[${i}].icon=this.value;livePreview()" style="font-size:18px;"/></div>
        <div class="bsm-field"><label>Title</label><input type="text" value="${item.title}" oninput="_editingData.items[${i}].title=this.value;livePreview()"/></div>
        <div class="bsm-field"><label>Description</label><textarea oninput="_editingData.items[${i}].description=this.value;livePreview()">${item.description}</textarea></div>
      </div>
    `).join('')}
  `;
}

function renderGalleryForm(data) {
  return `
    <div class="bsm-field"><label>Section Heading</label><input type="text" value="${data.heading}" oninput="_editingData.heading=this.value;livePreview()"/></div>
    <div class="bsm-field"><label>Subheading</label><input type="text" value="${data.subheading}" oninput="_editingData.subheading=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value;livePreview()"/></div>
    <div class="bsm-field"><label>Columns</label><select onchange="_editingData.columns=parseInt(this.value);livePreview()"><option value="2" ${data.columns===2?'selected':''}>2</option><option value="3" ${data.columns===3?'selected':''}>3</option><option value="4" ${data.columns===4?'selected':''}>4</option></select></div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:16px 0;"/>
    ${data.images.map((img, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:8px;">
        <p style="font-size:11px;font-weight:700;color:#ff6b35;margin-bottom:8px;">Image ${i+1}</p>
        <div class="bsm-field"><label>Image URL</label>
          <input type="url" value="${img.src}" placeholder="https://example.com/image.jpg"
            oninput="_editingData.images[${i}].src=this.value; validateGalleryImg(this, ${i});livePreview()"/>
          <img id="gal-preview-${i}" src="${img.src}" alt=""
            style="${img.src ? 'display:block' : 'display:none'};width:100%;height:56px;object-fit:cover;border-radius:var(--r-sm);margin-top:6px;border:1px solid var(--ui-border);"
            onerror="this.style.display='none';document.getElementById('gal-err-${i}').style.display='block';"
            onload="this.style.display='block';document.getElementById('gal-err-${i}').style.display='none';"/>
          <div id="gal-err-${i}" style="display:none;font-size:11px;color:var(--ui-danger);margin-top:4px;">⚠️ Image URL failed to load</div>
        </div>
        <div class="bsm-field"><label>Caption</label><input type="text" value="${img.caption}" oninput="_editingData.images[${i}].caption=this.value;livePreview()"/></div>
      </div>
    `).join('')}
  `;
}

function renderFooterForm(data) {
  return `
    <div class="bsm-field"><label>Logo Text</label><input type="text" value="${data.logo}" oninput="_editingData.logo=this.value;livePreview()"/></div>
    <div class="bsm-field"><label>Tagline</label><input type="text" value="${data.tagline}" oninput="_editingData.tagline=this.value;livePreview()"/></div>
    <div class="bsm-field"><label>Copyright Text</label><input type="text" value="${data.copyright}" oninput="_editingData.copyright=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value;livePreview()"/></div>
    <div class="bsm-color-row"><label>Accent Color</label><input type="color" value="${data.accentColor}" oninput="_editingData.accentColor=this.value;livePreview()"/></div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:16px 0;"/>
    ${data.columns.map((col, ci) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:8px;">
        <p style="font-size:11px;font-weight:700;color:#ff6b35;margin-bottom:8px;">Column ${ci+1}</p>
        <div class="bsm-field"><label>Title</label><input type="text" value="${col.title}" oninput="_editingData.columns[${ci}].title=this.value;livePreview()"/></div>
        <div class="bsm-field"><label>Links (label|url, one per line)</label><textarea oninput="_editingData.columns[${ci}].links=this.value.split('\\n').filter(l=>l.trim()).map(l=>{const[label,url]=(l+'|#').split('|');return{label:label.trim(),url:(url||'#').trim()}});livePreview()">${col.links.map(l=>l.label+'|'+l.url).join('\n')}</textarea></div>
      </div>
    `).join('')}
  `;
}


function validateGalleryImg(input, idx) {
  const preview = document.getElementById('gal-preview-' + idx);
  const errEl = document.getElementById('gal-err-' + idx);
  if (!input.value) {
    if (preview) preview.style.display = 'none';
    if (errEl) errEl.style.display = 'none';
    return;
  }
  if (preview) {
    preview.src = input.value;
    preview.style.display = 'block';
  }
}

function switchBSMTab(event, panelId) {
  // Deactivate all tabs and panels within the modal
  const container = event.target.closest('.bsm-tabs').parentElement;
  container.querySelectorAll('.bsm-tab').forEach(t => t.classList.remove('active'));
  container.querySelectorAll('.bsm-panel').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
  const panel = container.querySelector('#' + panelId);
  if (panel) panel.classList.add('active');
}

function closeBlockModal() {
  document.getElementById('block-settings-modal').style.display = 'none';
  _editingBlockId = null;
  _editingData = null;
}

function saveBlockSettings() {
  if (!_editingBlockId || !_editingData) return;
  const block = State.blocks.find(b => b.id === _editingBlockId);
  if (!block) return;
  block.data = JSON.parse(JSON.stringify(_editingData));
  History.push();
  closeBlockModal();
  refreshPreview();
  updateLayers();
  showToast('✅ Saved!', 'Block settings updated', 'success');
}

/* Live preview — called by every oninput/onchange in block settings forms.
   Writes _editingData into the block and debounces a preview refresh. */
let _livePreviewTimer = null;
function livePreview() {
  if (!_editingBlockId || !_editingData) return;
  const block = State.blocks.find(b => b.id === _editingBlockId);
  if (!block) return;
  block.data = JSON.parse(JSON.stringify(_editingData));
  clearTimeout(_livePreviewTimer);
  _livePreviewTimer = setTimeout(() => {
    refreshPreview(); // refreshPreview already calls LiveSync.notifyChange()
  }, 60);
}

/* ──────────────────────────────────────────────────────────────────
   TEMPLATE MANAGEMENT
────────────────────────────────────────────────────────────────── */
function applyTemplate(tplKey) {
  if (!Templates[tplKey]) { console.warn('Unknown template:', tplKey); return; }

  State.currentTemplate = tplKey;

  // Update sidebar selection UI
  document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
  const card = document.getElementById('tpl-' + tplKey);
  if (card) card.classList.add('active');

  // Show custom CSS panel if needed
  const customPanel = document.getElementById('custom-css-panel');
  if (customPanel) customPanel.style.display = tplKey === 'custom' ? 'block' : 'none';

  // Apply template color overrides to the sidebar style controls
  const overrides = Templates[tplKey].overrides;
  Object.entries(overrides).forEach(([key, value]) => {
    State.globalStyles[key] = value;
    // Sync UI controls
    const colorKeys = { '--primary': 'color-primary', '--secondary': 'color-secondary', '--accent': 'color-accent', '--bg': 'color-bg', '--text': 'color-text' };
    if (colorKeys[key]) {
      const colorEl = document.getElementById(colorKeys[key]);
      if (colorEl) { colorEl.value = value; }
      const hexEl = colorEl?.nextElementSibling;
      if (hexEl) hexEl.value = value;
    }
  });

  refreshPreview();
  showToast('🎨 Template Applied', Templates[tplKey].name, 'success');
}

function applyCustomCSS() {
  State.customCSS = document.getElementById('custom-css-input').value;
  refreshPreview();
  showToast('✅ CSS Applied', 'Custom styles applied to preview', 'success');
}

/* ──────────────────────────────────────────────────────────────────
   GLOBAL STYLE CONTROLS
────────────────────────────────────────────────────────────────── */
function updateGlobalStyle(varName, value) {
  State.globalStyles[varName] = value;
  refreshPreview();
}

function syncColorHex(colorInputId, hexValue) {
  if (/^#[0-9A-Fa-f]{6}$/.test(hexValue)) {
    const el = document.getElementById(colorInputId);
    if (el) el.value = hexValue;
    // Find the CSS variable it maps to
    const map = {
      'color-primary': '--primary',
      'color-secondary': '--secondary',
      'color-accent': '--accent',
      'color-bg': '--bg',
      'color-text': '--text',
    };
    if (map[colorInputId]) updateGlobalStyle(map[colorInputId], hexValue);
  }
}

function updateButtonStyle(style) {
  const radii = { rounded: '8px', pill: '50px', square: '0px', outline: '8px' };
  State.globalStyles['--btn-radius'] = radii[style] || '8px';
  refreshPreview();
}

function updateAnimations(val) {
  // Store preference — applied via extra CSS
  State.globalStyles['--anim'] = val;
  refreshPreview();
}

/* ──────────────────────────────────────────────────────────────────
   DEVICE SWITCHING
────────────────────────────────────────────────────────────────── */
const DeviceWidths = {
  desktop: '100%',
  tablet: '768px',
  mobile: '390px',
};

const DeviceLabels = {
  desktop: 'Desktop · 1440px wide',
  tablet: 'Tablet · 768px wide',
  mobile: 'Mobile · 390px wide',
};

function switchDevice(device) {
  State.currentDevice = device;

  // Update buttons
  document.querySelectorAll('.device-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.device === device);
  });

  // Update canvas
  const wrapper = document.getElementById('canvas-wrapper');
  wrapper.style.width = DeviceWidths[device];

  document.getElementById('canvas-info').textContent = DeviceLabels[device];
}

/* ──────────────────────────────────────────────────────────────────
   ZOOM CONTROLS
────────────────────────────────────────────────────────────────── */
function adjustZoom(delta) {
  State.zoomLevel = Math.max(30, Math.min(150, State.zoomLevel + delta));
  applyZoom();
}

function resetZoom() {
  State.zoomLevel = 100;
  applyZoom();
}

function applyZoom() {
  const wrapper = document.getElementById('canvas-wrapper');
  wrapper.style.transform = `scale(${State.zoomLevel / 100})`;
  wrapper.style.transformOrigin = 'top center';
  document.getElementById('zoom-label').textContent = State.zoomLevel + '%';
}

/* ──────────────────────────────────────────────────────────────────
   TAB SWITCHING
────────────────────────────────────────────────────────────────── */
function switchTab(tab) {
  document.querySelectorAll('.stab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tab));
  if (tab === 'projects') renderProjectsList();
}

/* ──────────────────────────────────────────────────────────────────
   RIGHT PANEL — ELEMENT EDITOR
────────────────────────────────────────────────────────────────── */
function openRightPanel(title, content) {
  document.getElementById('rp-title').textContent = title;
  document.getElementById('right-panel-content').innerHTML = content;
  document.getElementById('right-panel').classList.remove('closed');
}

function closeRightPanel() {
  document.getElementById('right-panel').classList.add('closed');
}

/* ──────────────────────────────────────────────────────────────────
   FULL PREVIEW
────────────────────────────────────────────────────────────────── */
function openFullPreview() {
  const modal = document.getElementById('full-preview-modal');
  const frame = document.getElementById('full-preview-frame');
  frame.srcdoc = buildPreviewHTML(true);
  modal.style.display = 'flex';
}

function closeFullPreview() {
  document.getElementById('full-preview-modal').style.display = 'none';
}

/* ──────────────────────────────────────────────────────────────────
   EXPORT ENGINE
────────────────────────────────────────────────────────────────── */
function exportSite() {
  // SSV26.1: Enforce tier export limit before proceeding
  if (!UsageTracker.canExport()) {
    UsageTracker.showExportLimitModal();
    return;
  }

  const siteName = document.getElementById('site-name-input')?.value || 'my-site';

  // FIX3: buildExportHTML() now uses the same renderer as preview (buildPreviewHTML(true)).
  // The HTML file is fully self-contained — all CSS is inlined, no external dependencies.
  const exportHTML = buildExportHTML();

  // The CSS and JS files are optional companion files (utilities/animations).
  // The HTML is fully functional without them.
  const exportCSS = buildExportCSS();
  const exportJS = buildExportJS();

  // Download HTML immediately; CSS and JS with slight delay to avoid browser blocking
  downloadFile(siteName + '.html', exportHTML, 'text/html');
  setTimeout(() => downloadFile(siteName + '-style.css', exportCSS, 'text/css'), 250);
  setTimeout(() => downloadFile(siteName + '-script.js', exportJS, 'text/javascript'), 500);

  // SSV26.1: Record this export against the usage counter
  UsageTracker.recordExport();

  // Show success modal
  setTimeout(() => {
    document.getElementById('export-modal').style.display = 'flex';
  }, 600);
}

function buildExportHTML() {
  // FIX3: Use the same rendering pipeline as preview (buildPreviewHTML with forExport=true).
  // This guarantees pixel-identical output — same CSS vars, same block renderers,
  // same glass effects, same responsive overrides. No divergence possible.
  const siteName = document.getElementById('site-name-input')?.value || 'My Site';

  // Get the fully-rendered preview HTML (forExport=true strips builder controls)
  const previewBase = buildPreviewHTML(true);

  // Inject production-quality <head> metadata into the already-correct preview output.
  // The preview HTML already has: charset, viewport, fonts, inline CSS, all blocks.
  // We add: title (with site name), meta description, favicon, Open Graph basics.
  const productionHead = `  <title>${siteName}</title>
  <meta name="description" content="Built with Supersuite — the fastest website builder"/>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23ff6b35'/%3E%3Ctext x='16' y='23' font-family='Arial Black,sans-serif' font-size='16' font-weight='900' text-anchor='middle' fill='white'%3ESS%3C/text%3E%3C/svg%3E"/>
  <meta property="og:title" content="${siteName}"/>
  <meta property="og:type" content="website"/>
  <!-- Generated by Supersuite SSV26.1 -->`;

  // Splice the production head tags in right after <head>
  // The preview HTML has: <head>\n  <meta charset...
  const exportHTML = previewBase.replace('<head>', '<head>\n' + productionHead);

  return exportHTML;
}

function buildExportCSS() {
  const template = Templates[State.currentTemplate];
  const styles = { ...State.globalStyles, ...template.overrides };
  const cssVars = Object.entries(styles).map(([k, v]) => `  ${k}: ${v};`).join('\n');

  return `/* ═══════════════════════════════════════════════════
   Generated by Supersuite — https://supersuite.com
   Template: ${template.name}
═══════════════════════════════════════════════════ */

/* CSS Variables */
:root {
${cssVars}
}

/* Base Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html {
  scroll-behavior: smooth;
}

body {
  font-family: var(--font-body);
  color: var(--text);
  background: var(--bg);
  font-size: var(--font-base);
  line-height: var(--line-height);
  -webkit-font-smoothing: antialiased;
}

/* Template: ${template.name} */
${template.extraCSS || ''}

/* Custom CSS */
${State.customCSS}

/* Responsive */
@media (max-width: 768px) {
  [style*="grid-template-columns: repeat(3"] { grid-template-columns: repeat(2, 1fr) !important; }
  [style*="grid-template-columns: repeat(2"] { grid-template-columns: 1fr !important; }
  [style*="grid-template-columns: 1.5fr"] { grid-template-columns: 1fr !important; }
  .ss-nav-links { display: none !important; }
}

@media (max-width: 480px) {
  [style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
  [style*="padding: 120px"] { padding: 60px 24px !important; }
}
`;
}

function buildExportJS() {
  return `/* ═══════════════════════════════════════════════════
   Generated by Supersuite — https://supersuite.com
   Site script — interactivity & animations
═══════════════════════════════════════════════════ */

'use strict';

/* ── SCROLL ANIMATIONS ─────────────────────────── */
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });

  document.querySelectorAll('.ss-block').forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = \`opacity 0.6s ease \${i * 0.1}s, transform 0.6s ease \${i * 0.1}s\`;
    observer.observe(el);
  });
}

/* ── SMOOTH ANCHOR SCROLL ──────────────────────── */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

/* ── FORM HANDLING ─────────────────────────────── */
function initForms() {
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✓ Submitted!';
        btn.style.background = '#22c55e';
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.background = '';
        }, 3000);
      }
    });
  });
}

/* ── STICKY NAV ────────────────────────────────── */
function initStickyNav() {
  const nav = document.querySelector('.ss-nav');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    if (window.scrollY > 60) {
      nav.style.boxShadow = '0 4px 24px rgba(0,0,0,0.15)';
      nav.style.backdropFilter = 'blur(12px)';
    } else {
      nav.style.boxShadow = '';
      nav.style.backdropFilter = '';
    }
  });
}

/* ── MOBILE NAV TOGGLE ─────────────────────────── */
function initMobileNav() {
  const nav = document.querySelector('.ss-nav');
  if (!nav) return;
  const links = nav.querySelector('.ss-nav-links');
  if (!links) return;

  const toggle = document.createElement('button');
  toggle.innerHTML = '☰';
  toggle.style.cssText = 'display:none;background:none;border:none;font-size:24px;cursor:pointer;color:inherit;padding:4px 8px;';
  nav.querySelector('.ss-nav-inner')?.appendChild(toggle);

  window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
      toggle.style.display = 'block';
      links.style.display = 'none';
    } else {
      toggle.style.display = 'none';
      links.style.display = 'flex';
    }
  });

  toggle.addEventListener('click', () => {
    const shown = links.style.display !== 'none';
    links.style.display = shown ? 'none' : 'flex';
    links.style.flexDirection = 'column';
    links.style.position = 'absolute';
    links.style.top = '72px';
    links.style.left = '0';
    links.style.right = '0';
    links.style.background = 'inherit';
    links.style.padding = '16px 24px';
    links.style.borderTop = '1px solid rgba(0,0,0,0.1)';
    links.style.zIndex = '99';
  });

  // Trigger resize check
  window.dispatchEvent(new Event('resize'));
}

/* ── COUNTER ANIMATION ─────────────────────────── */
function animateCounters() {
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count);
    let current = 0;
    const step = target / 60;
    const timer = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = Math.round(current).toLocaleString();
      if (current >= target) clearInterval(timer);
    }, 16);
  });
}

/* ── INIT ──────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initScrollAnimations();
  initSmoothScroll();
  initForms();
  initStickyNav();
  initMobileNav();
});
`;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function closeExportModal() {
  document.getElementById('export-modal').style.display = 'none';
}

/* ──────────────────────────────────────────────────────────────────
   TOAST NOTIFICATIONS
────────────────────────────────────────────────────────────────── */
function showToast(title, message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <div class="toast-text">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-msg">${message}</div>` : ''}
    </div>
  `;

  container.appendChild(toast);

  // Auto dismiss
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);

  // Click to dismiss
  toast.addEventListener('click', () => toast.remove());
}

/* ──────────────────────────────────────────────────────────────────
   IMAGE UPLOAD
────────────────────────────────────────────────────────────────── */
let _imageUploadCallback = null;

function triggerImageUpload(callback) {
  _imageUploadCallback = callback;
  document.getElementById('image-upload-input').click();
}

document.getElementById('image-upload-input').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result;
    const key = 'img_' + Date.now();
    State.uploadedImages[key] = base64;
    if (_imageUploadCallback) {
      _imageUploadCallback(base64, key);
      _imageUploadCallback = null;
    }
  };
  reader.readAsDataURL(file);
  this.value = '';
});

/* ──────────────────────────────────────────────────────────────────
   KEYBOARD SHORTCUTS
────────────────────────────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  // SSV26.1: Escape closes login modal too
  if (e.key === 'Escape') {
    closeLoginModal();
    if (State.authenticated) {
      closeBlockModal();
      closeFullPreview();
      closeExportModal();
      closeBlockSelectorModal();
    }
    return;
  }

  if (!State.authenticated) return;

  // Ctrl+Z — undo (simple: just refresh)
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    History.back();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    History.forward();
  }

  // Ctrl+S — save session
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveToSession();
    showToast('💾 Auto-saved', 'Changes saved to session', 'success');
  }

  // Ctrl+P — preview
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    openFullPreview();
  }
});

/* ──────────────────────────────────────────────────────────────────
   AUTO-SAVE TO SESSIONSSTORAGE
────────────────────────────────────────────────────────────────── */
function saveToSession() {
  try {
    const data = {
      blocks: State.blocks,
      globalStyles: State.globalStyles,
      currentTemplate: State.currentTemplate,
      customCSS: State.customCSS,
      blockIdCounter: State.blockIdCounter,
      siteName: document.getElementById('site-name-input')?.value,
    };
    sessionStorage.setItem('supersuite_session', JSON.stringify(data));
  } catch(e) {}
}

function loadFromSession() {
  try {
    const raw = sessionStorage.getItem('supersuite_session');
    if (!raw) return false;
    const data = JSON.parse(raw);
    State.blocks = data.blocks || [];
    State.globalStyles = { ...State.globalStyles, ...data.globalStyles };
    State.currentTemplate = data.currentTemplate || 'glass';
    State.customCSS = data.customCSS || '';
    State.blockIdCounter = data.blockIdCounter || 1;
    if (data.siteName) {
      const siteInput = document.getElementById('site-name-input');
      if (siteInput) siteInput.value = data.siteName;
    }
    return true;
  } catch(e) { return false; }
}

// Auto-save every 30 seconds
setInterval(() => {
  if (State.authenticated) saveToSession();
}, 30000);

/* ──────────────────────────────────────────────────────────────────
   DRAG & DROP FROM SIDEBAR INTO CANVAS (Phase 2)
────────────────────────────────────────────────────────────────── */
document.querySelectorAll('.block-card[draggable]').forEach(card => {
  card.addEventListener('dragstart', (e) => {
    const type = card.getAttribute('onclick').match(/addBlock\('(\w+)'\)/)?.[1];
    if (type) e.dataTransfer.setData('blockType', type);
  });
});

const canvasScrollArea = document.querySelector('.canvas-scroll-area');
if (canvasScrollArea) {
  canvasScrollArea.addEventListener('dragover', e => e.preventDefault());
  canvasScrollArea.addEventListener('drop', e => {
    e.preventDefault();
    const type = e.dataTransfer.getData('blockType');
    if (type) addBlock(type);
  });
}

/* postMessage bridge — routes messages from the sandboxed srcdoc preview iframe.
   srcdoc iframes have a null origin so window.parent.fn() silently fails;
   postMessage('*') + this listener is the correct cross-origin approach. */
window.addEventListener('message', function(e) {
  const msg = e.data;
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'openBlockSettings': openBlockSettings(msg.id); break;
    case 'moveBlock':         moveBlock(msg.id, msg.dir); break;
    case 'duplicateBlock':    duplicateBlock(msg.id); break;
    case 'deleteBlock':       deleteBlock(msg.id); break;
    case 'addBlock':          addBlock(msg.blockType); break;
  }
});

/* ──────────────────────────────────────────────────────────────────
   STARTER DEMO — auto-populate with a sample page
────────────────────────────────────────────────────────────────── */
function loadStarterDemo() {
  // Restore previous session first (preserves all user edits)
  if (loadFromSession() && State.blocks.length > 0) {
    refreshPreview();
    updateLayers();
    showToast('📂 Session Restored', 'Your previous work was loaded', 'info');
    return;
  }

  // SSV26.1: Only add demo blocks that are enabled in BlockSelector
  const enabled = BlockSelector.getEnabled();
  const demoBlocks = ['nav', 'hero', 'features', 'testimonials', 'pricing', 'cta', 'footer'];
  demoBlocks.filter(t => enabled.includes(t)).forEach(t => addBlock(t));
  showToast('🎉 Demo Loaded', 'Start editing — all your blocks are ready!', 'success');
  // Push initial state to history so undo works from the start
  setTimeout(() => History.push(), 100);
}


/* ──────────────────────────────────────────────────────────────────
   PROJECT LIBRARY — Save / load named projects
────────────────────────────────────────────────────────────────── */
const Projects = {
  _key: 'ss_projects_v261',

  getAll() {
    try { return JSON.parse(localStorage.getItem(this._key)) || []; } catch(e) { return []; }
  },

  save(projects) {
    try { localStorage.setItem(this._key, JSON.stringify(projects)); } catch(e) {}
  },
};

function createNewProject() {
  const name = prompt('New project name:', 'Untitled Project ' + (Projects.getAll().length + 1));
  if (!name) return;
  // Save current state first if we have blocks
  if (State.blocks.length) saveCurrentProject();
  // Reset state
  State.blocks = [];
  State.blockIdCounter = 1;
  State.customCSS = '';
  State.globalStyles = {
    '--primary': '#ff6b35','--secondary': '#1a1a2e','--accent': '#ffd700',
    '--bg': '#ffffff','--text': '#1a1a2e',
    '--font-heading': "'Syne', sans-serif",'--font-body': "'DM Sans', sans-serif",
    '--font-base': '16px','--line-height': '1.6','--btn-radius': '8px',
    '--section-pad': '60px','--container': '1200px','--radius': '12px',
    '--shadow': '0 8px 24px rgba(0,0,0,0.15)',
  };
  const siteNameEl = document.getElementById('site-name-input');
  if (siteNameEl) siteNameEl.value = name;
  refreshPreview();
  updateLayers();
  renderProjectsList();
  showToast('📁 New Project', name + ' created', 'success');
}

function saveCurrentProject() {
  const name = document.getElementById('site-name-input')?.value || 'Untitled';
  const projects = Projects.getAll();
  const existing = projects.findIndex(p => p.name === name);
  const data = {
    name,
    ts: Date.now(),
    blocks: State.blocks,
    globalStyles: State.globalStyles,
    currentTemplate: State.currentTemplate,
    customCSS: State.customCSS,
    blockIdCounter: State.blockIdCounter,
  };
  if (existing >= 0) { projects[existing] = data; }
  else { projects.unshift(data); }
  Projects.save(projects);
  renderProjectsList();
  showToast('💾 Saved', '"' + name + '" saved to library', 'success');
}

function loadProject(name) {
  const projects = Projects.getAll();
  const proj = projects.find(p => p.name === name);
  if (!proj) return;
  State.blocks = proj.blocks || [];
  State.globalStyles = { ...State.globalStyles, ...proj.globalStyles };
  State.currentTemplate = proj.currentTemplate || 'glass';
  State.customCSS = proj.customCSS || '';
  State.blockIdCounter = proj.blockIdCounter || 1;
  const siteNameEl = document.getElementById('site-name-input');
  if (siteNameEl) siteNameEl.value = name;
  refreshPreview();
  updateLayers();
  History.push();
  showToast('📂 Loaded', '"' + name + '" loaded', 'success');
}

function deleteProject(name) {
  if (!confirm('Delete "' + name + '"?')) return;
  const projects = Projects.getAll().filter(p => p.name !== name);
  Projects.save(projects);
  renderProjectsList();
  showToast('🗑 Deleted', '"' + name + '" removed', 'info');
}

function renderProjectsList() {
  const list = document.getElementById('projects-list');
  if (!list) return;
  const projects = Projects.getAll();
  if (!projects.length) {
    list.innerHTML = '<p style="color:var(--ui-text2);font-size:13px;text-align:center;padding:20px;">No saved projects yet. Click 💾 Save to create one.</p>';
    return;
  }
  list.innerHTML = projects.map(p => `
    <div style="background:var(--ui-surface2);border:1px solid var(--ui-border);border-radius:var(--r-sm);padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="loadProject('${p.name.replace(/'/g, "\\'")}')">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;color:var(--ui-text);">${p.name}</div>
        <div style="font-size:11px;color:var(--ui-text2);">${p.blocks?.length||0} blocks · ${new Date(p.ts).toLocaleDateString()}</div>
      </div>
      <button onclick="event.stopPropagation();deleteProject('${p.name.replace(/'/g, "\\'")}')" style="min-width:28px;min-height:28px;background:none;border:1px solid var(--ui-border);border-radius:var(--r-sm);color:var(--ui-text2);cursor:pointer;font-size:12px;" title="Delete">🗑</button>
    </div>
  `).join('');
}

/* ──────────────────────────────────────────────────────────────────
   BOOT
   initApp() is called by checkPassword() after successful login.
   The duplicate stub below has been removed in SSV26.1.
────────────────────────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════════
   SSV26.2 — FEATURES 4-9 EXTENSION
   Liquid Glass UI · Scroll Anims · Global Template System
   Industry Templates · Unsplash · AI Onboarding
   All builder-only — exports remain unchanged.
══════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ── F8: Unsplash API ─────────────────────────────────────── */
const UnsplashAPI = {
  key: 'wGxylPhHJHdYms06p3mV9xfogc1Z57nimNNL_RPrxes',
  cache: {},
  async search(query, count){
    count = count || 3;
    const ck = query + '|' + count;
    if (this.cache[ck]) return this.cache[ck];
    try {
      const url = 'https://api.unsplash.com/search/photos?per_page=' + count +
                  '&orientation=landscape&query=' + encodeURIComponent(query) +
                  '&client_id=' + this.key;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Unsplash ' + res.status);
      const data = await res.json();
      const imgs = (data.results || []).map(p => ({
        url: p.urls.regular,
        thumb: p.urls.small,
        alt: p.alt_description || query,
        author: p.user && p.user.name || 'Unsplash',
        link: p.links && p.links.html || ''
      }));
      this.cache[ck] = imgs;
      return imgs;
    } catch(e){
      console.warn('[Unsplash] fallback', e);
      return [];
    }
  },
  fallbackGradient(seed){
    const grads = [
      'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
      'linear-gradient(135deg,#f093fb 0%,#f5576c 100%)',
      'linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)',
      'linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)',
      'linear-gradient(135deg,#fa709a 0%,#fee140 100%)',
    ];
    return grads[(seed||0) % grads.length];
  }
};
window.UnsplashAPI = UnsplashAPI;

/* ── F5: Global Scroll Animation System ───────────────────── */
const ScrollAnim = {
  storageKey: 'ss_scroll_anim_v262',
  get level(){
    try { return localStorage.getItem(this.storageKey) || 'subtle'; } catch(e){ return 'subtle'; }
  },
  set(level){
    try { localStorage.setItem(this.storageKey, level); } catch(e){}
    refreshPreview();
    showToast('🎬 Scroll Animation', 'Set to ' + level, 'info');
  },
  /** Inject scroll-anim observer into iframe (builder preview only) */
  injectInto(doc){
    const level = this.level;
    if (level === 'off') return;
    const presets = {
      subtle:   { y: 12, dur: 500, op: 0.6 },
      soft:     { y: 24, dur: 700, op: 0.0 },
      dramatic: { y: 60, dur: 950, op: 0.0 },
    };
    const p = presets[level] || presets.subtle;
    const css = doc.createElement('style');
    css.textContent =
      'section,header,footer,.feature-card,.testimonial-card,.pricing-card,.gallery-item{' +
        'opacity:' + p.op + ';transform:translateY(' + p.y + 'px);' +
        'transition:opacity ' + p.dur + 'ms cubic-bezier(.22,1,.36,1),' +
                  'transform ' + p.dur + 'ms cubic-bezier(.22,1,.36,1);' +
      '}' +
      '.ss-anim-in{opacity:1!important;transform:translateY(0)!important;}';
    doc.head.appendChild(css);
    const script = doc.createElement('script');
    script.textContent =
      '(function(){var io=new IntersectionObserver(function(es){' +
      'es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("ss-anim-in");io.unobserve(e.target);}});' +
      '},{threshold:0.12,rootMargin:"0px 0px -40px 0px"});' +
      'document.querySelectorAll("section,header,footer,.feature-card,.testimonial-card,.pricing-card,.gallery-item")' +
      '.forEach(function(el){io.observe(el);});})();';
    doc.body.appendChild(script);
  }
};
window.ScrollAnim = ScrollAnim;
window.setScrollAnim = function(lvl){ ScrollAnim.set(lvl); };

// Hook into refreshPreview's iframe onload (additive, preserves existing onload)
(function patchPreview(){
  const orig = window.refreshPreview;
  if (typeof orig !== 'function') return;
  window.refreshPreview = function(){
    orig.apply(this, arguments);
    const frame = document.getElementById('preview-frame');
    if (!frame) return;
    const prevOnload = frame.onload;
    frame.onload = function(){
      if (prevOnload) try { prevOnload.apply(this, arguments); } catch(e){}
      try {
        const doc = frame.contentDocument || frame.contentWindow.document;
        if (doc && doc.body) ScrollAnim.injectInto(doc);
      } catch(e){}
    };
  };
})();

/* ── F6: Global Template System (typography, spacing, palette, glass) ── */
const GlobalTheme = {
  storageKey: 'ss_global_theme_v262',
  defaults: {
    fontHeading: 'Syne',
    fontBody: 'DM Sans',
    spacing: 'comfy',     // tight | comfy | airy
    palette: 'sunset',    // sunset | ocean | forest | mono | grape
    glass: 'medium',      // off | subtle | medium | intense
  },
  palettes: {
    sunset:  { primary:'#ff6b35', secondary:'#f7931e', accent:'#ffb347', bg:'#0a0a0f', text:'#ffffff' },
    ocean:   { primary:'#0ea5e9', secondary:'#06b6d4', accent:'#22d3ee', bg:'#020617', text:'#f1f5f9' },
    forest:  { primary:'#10b981', secondary:'#059669', accent:'#34d399', bg:'#0a1410', text:'#ecfdf5' },
    mono:    { primary:'#ffffff', secondary:'#a3a3a3', accent:'#737373', bg:'#0a0a0a', text:'#fafafa' },
    grape:   { primary:'#a855f7', secondary:'#7c3aed', accent:'#c084fc', bg:'#0f0a1a', text:'#faf5ff' },
  },
  spacingScales: {
    tight: { sec:'40px', gap:'12px' },
    comfy: { sec:'80px', gap:'20px' },
    airy:  { sec:'120px', gap:'32px' },
  },
  load(){
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) return Object.assign({}, this.defaults, JSON.parse(raw));
    } catch(e){}
    return Object.assign({}, this.defaults);
  },
  save(theme){
    try { localStorage.setItem(this.storageKey, JSON.stringify(theme)); } catch(e){}
  },
  apply(theme){
    if (!theme) theme = this.load();
    this.save(theme);
    const pal = this.palettes[theme.palette] || this.palettes.sunset;
    const sp = this.spacingScales[theme.spacing] || this.spacingScales.comfy;
    if (window.State && State.globalStyles) {
      State.globalStyles['--primary'] = pal.primary;
      State.globalStyles['--secondary'] = pal.secondary;
      State.globalStyles['--accent'] = pal.accent;
      State.globalStyles['--bg'] = pal.bg;
      State.globalStyles['--text'] = pal.text;
      State.globalStyles['--font-heading'] = "'" + theme.fontHeading + "', sans-serif";
      State.globalStyles['--font-body'] = "'" + theme.fontBody + "', sans-serif";
      State.globalStyles['--section-pad'] = sp.sec;
      State.globalStyles['--block-gap'] = sp.gap;
      State.globalStyles['--glass-level'] = theme.glass;
    }
    refreshPreview();
  },
  update(key, value){
    const t = this.load();
    t[key] = value;
    this.apply(t);
    showToast('🎨 Theme', key + ' → ' + value, 'success');
  }
};
window.GlobalTheme = GlobalTheme;
window.updateGlobalTheme = function(k,v){ GlobalTheme.update(k,v); };

/* ── F7: Industry Templates (added to Templates registry) ── */
function addIndustryTemplates(){
  if (typeof Templates === 'undefined') return;

  Templates['pressure-washing'] = {
    name: 'Pressure Washing Pro',
    overrides: { '--primary':'#0284c7', '--secondary':'#0369a1', '--accent':'#38bdf8', '--bg':'#0c1f2e', '--text':'#f0f9ff' },
    industry: 'pressure-washing',
    keywords: ['pressure washing', 'house cleaning exterior', 'driveway cleaning'],
  };
  Templates['lawn-care'] = {
    name: 'Lawn Care Co.',
    overrides: { '--primary':'#16a34a', '--secondary':'#15803d', '--accent':'#86efac', '--bg':'#0a1f0d', '--text':'#f0fdf4' },
    industry: 'lawn-care',
    keywords: ['lawn care', 'landscaping green', 'mowing yard'],
  };
  Templates['lifestyle'] = {
    name: 'Barber / Fitness / Tattoo',
    overrides: { '--primary':'#dc2626', '--secondary':'#991b1b', '--accent':'#fca5a5', '--bg':'#0f0a0a', '--text':'#fef2f2' },
    industry: 'lifestyle',
    keywords: ['barber shop', 'tattoo studio', 'gym fitness'],
  };
}
addIndustryTemplates();

/* ── F9: AI Onboarding Flow ───────────────────────────────── */
const Onboarding = {
  flagKey: 'ss_onboarding_done_v262',
  step: 0,
  data: {},
  isDone(){ try { return localStorage.getItem(this.flagKey) === '1'; } catch(e){ return true; } },
  markDone(){ try { localStorage.setItem(this.flagKey, '1'); } catch(e){} },
  reset(){ try { localStorage.removeItem(this.flagKey); } catch(e){} this.start(); },
  start(){
    this.step = 0;
    this.data = {};
    this.render();
    document.getElementById('onboarding-modal').style.display = 'flex';
  },
  close(){
    document.getElementById('onboarding-modal').style.display = 'none';
    this.markDone();
  },
  next(){
    if (!this._collectStep()) return;
    this.step++;
    if (this.step >= this.steps.length) {
      this.finish();
    } else {
      this.render();
    }
  },
  back(){ if (this.step > 0){ this.step--; this.render(); } },
  steps: [
    { key:'industry', label:'What kind of business is this?', type:'choice',
      options:[
        { v:'pressure-washing', label:'🚿 Pressure Washing' },
        { v:'lawn-care',        label:'🌱 Lawn Care' },
        { v:'lifestyle',        label:'💪 Barber / Fitness / Tattoo' },
        { v:'glass',            label:'✨ Something else' },
      ]},
    { key:'name',     label:'Business name',     type:'text', placeholder:'e.g. Crystal Clear Pressure Washing' },
    { key:'phone',    label:'Phone number',      type:'text', placeholder:'(555) 123-4567' },
    { key:'services', label:'Top services (comma separated)', type:'text', placeholder:'House Wash, Driveway, Roof Cleaning' },
    { key:'pricing',  label:'Starting price',    type:'text', placeholder:'$199' },
  ],
  _collectStep(){
    const s = this.steps[this.step];
    const wrap = document.getElementById('onb-step-input');
    if (!wrap) return false;
    if (s.type === 'choice') {
      const sel = wrap.querySelector('.onb-choice.selected');
      if (!sel) { showToast('⚠️ Pick one', 'Choose an option to continue', 'info'); return false; }
      this.data[s.key] = sel.dataset.value;
    } else {
      const inp = wrap.querySelector('input');
      const v = (inp && inp.value || '').trim();
      if (!v && this.step > 0) { showToast('⚠️ Required', 'Please fill this in', 'info'); return false; }
      this.data[s.key] = v;
    }
    return true;
  },
  render(){
    const s = this.steps[this.step];
    const total = this.steps.length;
    const pct = Math.round(((this.step) / total) * 100);
    const titleEl = document.getElementById('onb-title');
    const progEl = document.getElementById('onb-progress-bar');
    const labelEl = document.getElementById('onb-step-label');
    const inputEl = document.getElementById('onb-step-input');
    const backBtn = document.getElementById('onb-back-btn');
    const nextBtn = document.getElementById('onb-next-btn');
    if (titleEl) titleEl.textContent = '✨ Quick Setup · Step ' + (this.step+1) + ' of ' + total;
    if (progEl) progEl.style.width = pct + '%';
    if (labelEl) labelEl.textContent = s.label;
    if (backBtn) backBtn.style.display = this.step === 0 ? 'none' : 'inline-block';
    if (nextBtn) nextBtn.textContent = this.step === total - 1 ? '✨ Build my site' : 'Next →';

    if (!inputEl) return;
    if (s.type === 'choice') {
      inputEl.innerHTML = s.options.map(o =>
        '<div class="onb-choice" data-value="' + o.v + '" onclick="Onboarding._pickChoice(this)">' + o.label + '</div>'
      ).join('');
    } else {
      const cur = this.data[s.key] || '';
      inputEl.innerHTML = '<input type="text" class="onb-text-input" placeholder="' + s.placeholder + '" value="' + cur + '" autofocus />';
      const inp = inputEl.querySelector('input');
      if (inp) {
        setTimeout(()=>inp.focus(), 50);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') Onboarding.next(); });
      }
    }
  },
  _pickChoice(el){
    el.parentNode.querySelectorAll('.onb-choice').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
  },
  async finish(){
    const inputEl = document.getElementById('onb-step-input');
    if (inputEl) inputEl.innerHTML = '<div class="onb-loading"><div class="onb-spinner"></div><p>Building your site with AI… fetching photos…</p></div>';
    const labelEl = document.getElementById('onb-step-label');
    if (labelEl) labelEl.textContent = '✨ Generating';
    const nextBtn = document.getElementById('onb-next-btn');
    const backBtn = document.getElementById('onb-back-btn');
    if (nextBtn) nextBtn.disabled = true;
    if (backBtn) backBtn.disabled = true;

    const industry = this.data.industry || 'glass';
    try { applyTemplate(industry); } catch(e){}

    let photos = [];
    try {
      const tpl = Templates[industry];
      const kw = (tpl && tpl.keywords && tpl.keywords[0]) || (this.data.services || 'business');
      photos = await UnsplashAPI.search(kw, 4);
    } catch(e){}

    try {
      State.blocks.forEach(b => {
        if (b.type === 'nav' && b.data) b.data.logo = this.data.name || b.data.logo;
        if (b.type === 'hero' && b.data) {
          b.data.headline = this.data.name || b.data.headline;
          b.data.subheading = (this.data.services || '') + (this.data.pricing ? ' · Starting at ' + this.data.pricing : '') || b.data.subheading;
          if (photos[0]) b.data.bgImage = photos[0].url;
        }
        if (b.type === 'cta' && b.data && this.data.phone) {
          b.data.btnText = '📞 Call ' + this.data.phone;
          b.data.btnLink = 'tel:' + this.data.phone.replace(/[^0-9+]/g,'');
        }
        if (b.type === 'gallery' && b.data && b.data.images && photos.length){
          photos.forEach((p, i) => { if (b.data.images[i]) b.data.images[i].src = p.url; });
        }
        if (b.type === 'pricing' && b.data && b.data.plans && b.data.plans[0] && this.data.pricing) {
          b.data.plans[0].price = this.data.pricing;
        }
      });
      History.push();
      refreshPreview();
      updateLayers();
    } catch(e){ console.warn('[Onboarding] fill failed', e); }

    setTimeout(() => {
      if (nextBtn) nextBtn.disabled = false;
      if (backBtn) backBtn.disabled = false;
      this.close();
      showToast('🎉 Site ready!', 'Your starter site is set up. Customize away!', 'success');
    }, 800);
  }
};
window.Onboarding = Onboarding;
window.startOnboarding = function(){ Onboarding.start(); };
window.closeOnboarding  = function(){ Onboarding.close(); };

// Hook initApp to trigger onboarding for first-time users
(function patchInit(){
  const orig = window.initApp;
  if (typeof orig !== 'function') return;
  window.initApp = function(){
    orig.apply(this, arguments);
    GlobalTheme.apply();
    setTimeout(() => {
      if (!Onboarding.isDone()) Onboarding.start();
    }, 1200);
  };
})();

/* ── F6 UI: Global Theme Panel renderer ───────────────────── */
window.openGlobalThemePanel = function(){
  const t = GlobalTheme.load();
  const fonts = ['Syne','DM Sans','Inter','Playfair Display','Space Grotesk','Bebas Neue','Montserrat'];
  const palettes = Object.keys(GlobalTheme.palettes);
  const html =
    '<div class="gt-section"><h4>Typography</h4>' +
      '<label>Heading Font</label>' +
      '<select onchange="updateGlobalTheme(\'fontHeading\',this.value)">' +
        fonts.map(f => '<option value="'+f+'"'+(t.fontHeading===f?' selected':'')+'>'+f+'</option>').join('') +
      '</select>' +
      '<label>Body Font</label>' +
      '<select onchange="updateGlobalTheme(\'fontBody\',this.value)">' +
        fonts.map(f => '<option value="'+f+'"'+(t.fontBody===f?' selected':'')+'>'+f+'</option>').join('') +
      '</select>' +
    '</div>' +
    '<div class="gt-section"><h4>Spacing</h4>' +
      '<div class="gt-pills">' +
        ['tight','comfy','airy'].map(s =>
          '<button class="gt-pill'+(t.spacing===s?' active':'')+'" onclick="updateGlobalTheme(\'spacing\',\''+s+'\')">'+s+'</button>'
        ).join('') +
      '</div>' +
    '</div>' +
    '<div class="gt-section"><h4>Palette</h4>' +
      '<div class="gt-palettes">' +
        palettes.map(p => {
          const pal = GlobalTheme.palettes[p];
          return '<div class="gt-palette'+(t.palette===p?' active':'')+'" onclick="updateGlobalTheme(\'palette\',\''+p+'\')" title="'+p+'">' +
                   '<span style="background:'+pal.primary+'"></span>' +
                   '<span style="background:'+pal.secondary+'"></span>' +
                   '<span style="background:'+pal.accent+'"></span>' +
                   '<small>'+p+'</small>' +
                 '</div>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="gt-section"><h4>Glass Intensity</h4>' +
      '<div class="gt-pills">' +
        ['off','subtle','medium','intense'].map(g =>
          '<button class="gt-pill'+(t.glass===g?' active':'')+'" onclick="updateGlobalTheme(\'glass\',\''+g+'\')">'+g+'</button>'
        ).join('') +
      '</div>' +
    '</div>' +
    '<div class="gt-section"><h4>Scroll Animations</h4>' +
      '<div class="gt-pills">' +
        ['off','subtle','soft','dramatic'].map(s =>
          '<button class="gt-pill'+(ScrollAnim.level===s?' active':'')+'" onclick="setScrollAnim(\''+s+'\');openGlobalThemePanel();">'+s+'</button>'
        ).join('') +
      '</div>' +
    '</div>' +
    '<div class="gt-section"><h4>AI Quick Setup</h4>' +
      '<button class="btn-primary full-width" onclick="Onboarding.reset()">🪄 Re-run AI Onboarding</button>' +
    '</div>';
  document.getElementById('gt-modal-content').innerHTML = html;
  document.getElementById('global-theme-modal').style.display = 'flex';
};
window.closeGlobalThemePanel = function(){
  document.getElementById('global-theme-modal').style.display = 'none';
};

console.log('[SSV26.2] Features 4-9 loaded.');
})();
