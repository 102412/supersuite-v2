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
      .ss-hero { background: #1a1a2e !important; }
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
  }
};

/* ──────────────────────────────────────────────────────────────────
   HTML GENERATORS — render each block to HTML string
────────────────────────────────────────────────────────────────── */
const BlockRenderers = {

  nav(data) {
    return `
<nav class="ss-block ss-nav" style="background:${data.bgColor};color:${data.textColor};position:${data.sticky?'sticky':'relative'};top:0;z-index:100;border-bottom:1px solid rgba(0,0,0,0.06);padding:0 var(--section-pad);">
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
<section class="ss-block ss-hero" style="background:${bg};color:${data.textColor};padding:120px var(--section-pad);min-height:${data.minHeight};display:flex;align-items:center;position:relative;overflow:hidden;">
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
    return `
<section class="ss-block ss-leadform" style="background:${data.bgColor};color:${data.textColor};padding:var(--section-pad) var(--section-pad);">
  <div style="max-width:560px;margin:0 auto;text-align:center;">
    <h2 class="ss-section-title" style="font-family:var(--font-heading);font-size:clamp(28px,4vw,44px);font-weight:800;margin-bottom:12px;letter-spacing:-1px;color:${data.textColor};">${data.heading}</h2>
    <p style="font-size:17px;opacity:0.7;margin-bottom:36px;">${data.subheading}</p>
    <form onsubmit="event.preventDefault();this.innerHTML='<div style=\'text-align:center;padding:20px;\'><span style=\'font-size:40px;\'>🎉</span><h3 style=\'margin-top:12px;font-family:var(--font-heading);\'>You\'re on the list!</h3><p style=\'opacity:0.7;margin-top:8px;\'>We\'ll be in touch soon.</p></div>';" style="display:flex;flex-direction:column;gap:12px;text-align:left;">
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
          ${p.features.map(f => `<li style="display:flex;align-items:center;gap:10px;font-size:14px;color:${p.featured?'rgba(255,255,255,0.9)':data.textColor};">
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
  <div style="position:absolute;inset:0;background:url('data:image/svg+xml,<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 100 100\\"><circle cx=\\"50\\" cy=\\"50\\" r=\\"40\\" fill=\\"none\\" stroke=\\"rgba(255,255,255,0.05)\\" stroke-width=\\"1\\"/></svg>') 50% 50% / 400px 400px;pointer-events:none;"></div>
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
      const bg = img.src ? `url('${img.src}') center/cover` : `linear-gradient(135deg, ${colors[i%colors.length]}33, ${colors[(i+1)%colors.length]}33)`;
      return `
        <div style="position:relative;overflow:hidden;border-radius:var(--radius);aspect-ratio:4/3;background:${bg};cursor:pointer;group;" onmouseover="this.querySelector('.gal-overlay').style.opacity='1'" onmouseout="this.querySelector('.gal-overlay').style.opacity='0'">
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
    const html = renderer(block.data);
    // Wrap with an ID for selection
    return `<div class="ss-block-wrapper" data-block-id="${block.id}" style="position:relative;">
      ${html}
      ${!forExport ? `
      <div class="ss-block-controls" style="position:absolute;top:8px;right:8px;display:none;z-index:200;gap:4px;flex-wrap:nowrap;">
        <button onclick="window.parent.openBlockSettings('${block.id}')" style="background:#1a1a2e;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;font-family:DM Sans,sans-serif;">✏️ Edit</button>
        <button onclick="window.parent.moveBlock('${block.id}','up')" style="background:#1a1a2e;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;">↑</button>
        <button onclick="window.parent.moveBlock('${block.id}','down')" style="background:#1a1a2e;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;">↓</button>
        <button onclick="window.parent.duplicateBlock('${block.id}')" style="background:#1a1a2e;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;">⧉</button>
        <button onclick="window.parent.deleteBlock('${block.id}')" style="background:#ef4444;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;">🗑</button>
      </div>` : ''}
    </div>`;
  }).join('\n');

  const emptyState = State.blocks.length === 0 && !forExport ? `
    <div style="min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#f8f8ff;font-family:DM Sans,sans-serif;">
      <div style="font-size:64px;">🏗️</div>
      <h2 style="font-size:24px;font-weight:700;color:#1a1a2e;font-family:Syne,sans-serif;">Your canvas is empty</h2>
      <p style="color:#666;font-size:16px;">Add blocks from the left panel to start building</p>
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
        <button onclick="window.parent.addBlock('hero')" style="background:#ff6b35;color:white;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">+ Add Hero</button>
        <button onclick="window.parent.addBlock('nav')" style="background:#1a1a2e;color:white;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">+ Add Nav</button>
        <button onclick="window.parent.addBlock('features')" style="background:#1a1a2e;color:white;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">+ Add Features</button>
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
      });
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
  </style>
</head>
<body>
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
  loadStarterDemo();   // loads session or default demo blocks
  showToast('🎉 Welcome to Supersuite!', Auth.getTierConfig(tier).label + ' plan · ' + Auth.version, 'success');
}

// Refresh the live preview iframe
function refreshPreview() {
  const frame = document.getElementById('preview-frame');
  const html = buildPreviewHTML(false);
  frame.srcdoc = html;

  // Also update height after load
  frame.onload = () => {
    try {
      const doc = frame.contentDocument || frame.contentWindow.document;
      const h = Math.max(doc.body.scrollHeight, 600);
      frame.style.height = h + 'px';
    } catch(e) {}
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
  document.getElementById('bsm-content').innerHTML = renderBlockSettingsForm(block.type, _editingData);
  document.getElementById('block-settings-modal').style.display = 'flex';
};

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
  return `
    <div class="bsm-tabs">
      <button class="bsm-tab active" onclick="switchBSMTab(event,'bsm-content')">Content</button>
      <button class="bsm-tab" onclick="switchBSMTab(event,'bsm-design')">Design</button>
      <button class="bsm-tab" onclick="switchBSMTab(event,'bsm-buttons')">Buttons</button>
    </div>
    <div id="bsm-content" class="bsm-panel active">
      <div class="bsm-field"><label>Heading</label><textarea oninput="_editingData.heading=this.value">${data.heading}</textarea></div>
      <div class="bsm-field"><label>Subheading</label><textarea oninput="_editingData.subheading=this.value">${data.subheading}</textarea></div>
      <div class="bsm-field"><label>Badge Text</label><input type="text" value="${data.badgeText}" oninput="_editingData.badgeText=this.value"/></div>
      <div class="bsm-field"><label>Show Badge</label><select onchange="_editingData.showBadge=this.value==='true'"><option value="true" ${data.showBadge?'selected':''}>Yes</option><option value="false" ${!data.showBadge?'selected':''}>No</option></select></div>
      <div class="bsm-field"><label>Alignment</label><select onchange="_editingData.alignment=this.value"><option value="center" ${data.alignment==='center'?'selected':''}>Center</option><option value="left" ${data.alignment==='left'?'selected':''}>Left</option></select></div>
      <div class="bsm-field"><label>Min Height</label><select onchange="_editingData.minHeight=this.value"><option value="60vh">60vh</option><option value="85vh" ${data.minHeight==='85vh'?'selected':''}>85vh</option><option value="100vh">100vh</option></select></div>
    </div>
    <div id="bsm-design" class="bsm-panel">
      <div class="bsm-field"><label>Background Type</label><select onchange="_editingData.bgType=this.value"><option value="gradient" ${data.bgType==='gradient'?'selected':''}>Gradient</option><option value="solid">Solid Color</option><option value="image">Image URL</option></select></div>
      <div class="bsm-color-row"><label>BG Color 1</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value"/></div>
      <div class="bsm-color-row"><label>BG Color 2</label><input type="color" value="${data.bgColor2}" oninput="_editingData.bgColor2=this.value"/></div>
      <div class="bsm-field"><label>Image URL</label><input type="url" value="${data.bgImage||''}" placeholder="https://..." oninput="_editingData.bgImage=this.value"/></div>
      <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value"/></div>
    </div>
    <div id="bsm-buttons" class="bsm-panel">
      <div class="bsm-field"><label>Primary Button Text</label><input type="text" value="${data.btnText}" oninput="_editingData.btnText=this.value"/></div>
      <div class="bsm-field"><label>Primary Button Link</label><input type="url" value="${data.btnLink}" oninput="_editingData.btnLink=this.value"/></div>
      <div class="bsm-color-row"><label>Button Color</label><input type="color" value="${data.btnColor}" oninput="_editingData.btnColor=this.value"/></div>
      <div class="bsm-field"><label>Secondary Button Text</label><input type="text" value="${data.btn2Text}" oninput="_editingData.btn2Text=this.value"/></div>
      <div class="bsm-field"><label>Secondary Button Link</label><input type="url" value="${data.btn2Link}" oninput="_editingData.btn2Link=this.value"/></div>
    </div>
  `;
}

function renderNavForm(data) {
  return `
    <div class="bsm-field"><label>Logo Text</label><input type="text" value="${data.logo}" oninput="_editingData.logo=this.value"/></div>
    <div class="bsm-field"><label>Nav Links (comma-separated)</label><input type="text" value="${data.links.join(',')}" oninput="_editingData.links=this.value.split(',').map(l=>l.trim())"/></div>
    <div class="bsm-field"><label>CTA Button Text</label><input type="text" value="${data.ctaText}" oninput="_editingData.ctaText=this.value"/></div>
    <div class="bsm-field"><label>CTA Button Link</label><input type="url" value="${data.ctaLink}" oninput="_editingData.ctaLink=this.value"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value"/></div>
    <div class="bsm-color-row"><label>CTA Color</label><input type="color" value="${data.ctaBgColor}" oninput="_editingData.ctaBgColor=this.value"/></div>
    <div class="bsm-field"><label>Sticky Navigation</label><select onchange="_editingData.sticky=this.value==='true'"><option value="true" ${data.sticky?'selected':''}>Yes</option><option value="false" ${!data.sticky?'selected':''}>No</option></select></div>
  `;
}

function renderLeadFormForm(data) {
  return `
    <div class="bsm-field"><label>Section Heading</label><input type="text" value="${data.heading}" oninput="_editingData.heading=this.value"/></div>
    <div class="bsm-field"><label>Subheading</label><textarea oninput="_editingData.subheading=this.value">${data.subheading}</textarea></div>
    <div class="bsm-field"><label>Button Text</label><input type="text" value="${data.btnText}" oninput="_editingData.btnText=this.value"/></div>
    <div class="bsm-field"><label>Privacy Text</label><input type="text" value="${data.privacyText}" oninput="_editingData.privacyText=this.value"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value"/></div>
    <div class="bsm-color-row"><label>Button Color</label><input type="color" value="${data.btnColor}" oninput="_editingData.btnColor=this.value"/></div>
    <div class="bsm-color-row"><label>Accent Color</label><input type="color" value="${data.accentColor}" oninput="_editingData.accentColor=this.value"/></div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:16px 0;"/>
    <p style="font-size:12px;color:#666;margin-bottom:12px;font-weight:600;">FORM FIELDS</p>
    ${data.fields.map((f, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:8px;">
        <div class="bsm-field"><label>Field ${i+1} Type</label><select onchange="_editingData.fields[${i}].type=this.value"><option value="text" ${f.type==='text'?'selected':''}>Text</option><option value="email" ${f.type==='email'?'selected':''}>Email</option><option value="tel" ${f.type==='tel'?'selected':''}>Phone</option><option value="number">Number</option></select></div>
        <div class="bsm-field"><label>Placeholder</label><input type="text" value="${f.placeholder}" oninput="_editingData.fields[${i}].placeholder=this.value"/></div>
      </div>
    `).join('')}
  `;
}

function renderTestimonialsForm(data) {
  return `
    <div class="bsm-field"><label>Section Heading</label><input type="text" value="${data.heading}" oninput="_editingData.heading=this.value"/></div>
    <div class="bsm-field"><label>Subheading</label><input type="text" value="${data.subheading}" oninput="_editingData.subheading=this.value"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value"/></div>
    <div class="bsm-color-row"><label>Accent Color</label><input type="color" value="${data.accentColor}" oninput="_editingData.accentColor=this.value"/></div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:16px 0;"/>
    <p style="font-size:12px;color:#666;margin-bottom:12px;font-weight:600;">TESTIMONIAL CARDS</p>
    ${data.cards.map((c, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:12px;">
        <p style="font-size:11px;font-weight:700;color:#ff6b35;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Card ${i+1}</p>
        <div class="bsm-field"><label>Name</label><input type="text" value="${c.name}" oninput="_editingData.cards[${i}].name=this.value"/></div>
        <div class="bsm-field"><label>Role</label><input type="text" value="${c.role}" oninput="_editingData.cards[${i}].role=this.value"/></div>
        <div class="bsm-field"><label>Quote</label><textarea oninput="_editingData.cards[${i}].quote=this.value">${c.quote}</textarea></div>
        <div class="bsm-field"><label>Rating (1-5)</label><select onchange="_editingData.cards[${i}].rating=parseInt(this.value)">${[1,2,3,4,5].map(n=>`<option value="${n}" ${c.rating===n?'selected':''}>${n} stars</option>`).join('')}</select></div>
      </div>
    `).join('')}
  `;
}

function renderPricingForm(data) {
  return `
    <div class="bsm-field"><label>Section Heading</label><input type="text" value="${data.heading}" oninput="_editingData.heading=this.value"/></div>
    <div class="bsm-field"><label>Subheading</label><input type="text" value="${data.subheading}" oninput="_editingData.subheading=this.value"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value"/></div>
    <div class="bsm-color-row"><label>Accent Color</label><input type="color" value="${data.accentColor}" oninput="_editingData.accentColor=this.value"/></div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:16px 0;"/>
    <p style="font-size:12px;color:#666;margin-bottom:12px;font-weight:600;">PRICING PLANS</p>
    ${data.plans.map((p, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:12px;">
        <p style="font-size:11px;font-weight:700;color:#ff6b35;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Plan ${i+1}: ${p.name}</p>
        <div class="bsm-field"><label>Plan Name</label><input type="text" value="${p.name}" oninput="_editingData.plans[${i}].name=this.value"/></div>
        <div class="bsm-field"><label>Price</label><input type="text" value="${p.price}" oninput="_editingData.plans[${i}].price=this.value"/></div>
        <div class="bsm-field"><label>Period</label><input type="text" value="${p.period}" oninput="_editingData.plans[${i}].period=this.value"/></div>
        <div class="bsm-field"><label>Description</label><input type="text" value="${p.description}" oninput="_editingData.plans[${i}].description=this.value"/></div>
        <div class="bsm-field"><label>CTA Text</label><input type="text" value="${p.ctaText}" oninput="_editingData.plans[${i}].ctaText=this.value"/></div>
        <div class="bsm-field"><label>Features (one per line)</label><textarea oninput="_editingData.plans[${i}].features=this.value.split('\\n').filter(f=>f.trim())">${p.features.join('\n')}</textarea></div>
        <div class="bsm-field"><label>Featured Plan?</label><select onchange="_editingData.plans[${i}].featured=this.value==='true'"><option value="false" ${!p.featured?'selected':''}>No</option><option value="true" ${p.featured?'selected':''}>Yes</option></select></div>
      </div>
    `).join('')}
  `;
}

function renderCTAForm(data) {
  return `
    <div class="bsm-field"><label>Heading</label><textarea oninput="_editingData.heading=this.value">${data.heading}</textarea></div>
    <div class="bsm-field"><label>Subheading</label><textarea oninput="_editingData.subheading=this.value">${data.subheading}</textarea></div>
    <div class="bsm-field"><label>Background Type</label><select onchange="_editingData.bgType=this.value"><option value="gradient" ${data.bgType==='gradient'?'selected':''}>Gradient</option><option value="solid">Solid</option><option value="image">Image URL</option></select></div>
    <div class="bsm-color-row"><label>BG Color 1</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value"/></div>
    <div class="bsm-color-row"><label>BG Color 2</label><input type="color" value="${data.bgColor2}" oninput="_editingData.bgColor2=this.value"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value"/></div>
    <div class="bsm-field"><label>Primary Button</label><input type="text" value="${data.btnText}" oninput="_editingData.btnText=this.value"/></div>
    <div class="bsm-field"><label>Primary Link</label><input type="url" value="${data.btnLink}" oninput="_editingData.btnLink=this.value"/></div>
    <div class="bsm-color-row"><label>Button Color</label><input type="color" value="${data.btnColor}" oninput="_editingData.btnColor=this.value"/></div>
    <div class="bsm-color-row"><label>Button Text Color</label><input type="color" value="${data.btnTextColor}" oninput="_editingData.btnTextColor=this.value"/></div>
    <div class="bsm-field"><label>Secondary Button</label><input type="text" value="${data.btn2Text}" oninput="_editingData.btn2Text=this.value"/></div>
  `;
}

function renderFeaturesForm(data) {
  return `
    <div class="bsm-field"><label>Section Heading</label><input type="text" value="${data.heading}" oninput="_editingData.heading=this.value"/></div>
    <div class="bsm-field"><label>Subheading</label><input type="text" value="${data.subheading}" oninput="_editingData.subheading=this.value"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value"/></div>
    <div class="bsm-color-row"><label>Accent Color</label><input type="color" value="${data.accentColor}" oninput="_editingData.accentColor=this.value"/></div>
    <div class="bsm-field"><label>Columns</label><select onchange="_editingData.columns=parseInt(this.value)"><option value="2" ${data.columns===2?'selected':''}>2 columns</option><option value="3" ${data.columns===3?'selected':''}>3 columns</option><option value="4" ${data.columns===4?'selected':''}>4 columns</option></select></div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:16px 0;"/>
    ${data.items.map((item, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:8px;">
        <p style="font-size:11px;font-weight:700;color:#ff6b35;margin-bottom:8px;">Feature ${i+1}</p>
        <div class="bsm-field"><label>Icon (emoji)</label><input type="text" value="${item.icon}" oninput="_editingData.items[${i}].icon=this.value" style="font-size:18px;"/></div>
        <div class="bsm-field"><label>Title</label><input type="text" value="${item.title}" oninput="_editingData.items[${i}].title=this.value"/></div>
        <div class="bsm-field"><label>Description</label><textarea oninput="_editingData.items[${i}].description=this.value">${item.description}</textarea></div>
      </div>
    `).join('')}
  `;
}

function renderGalleryForm(data) {
  return `
    <div class="bsm-field"><label>Section Heading</label><input type="text" value="${data.heading}" oninput="_editingData.heading=this.value"/></div>
    <div class="bsm-field"><label>Subheading</label><input type="text" value="${data.subheading}" oninput="_editingData.subheading=this.value"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value"/></div>
    <div class="bsm-field"><label>Columns</label><select onchange="_editingData.columns=parseInt(this.value)"><option value="2" ${data.columns===2?'selected':''}>2</option><option value="3" ${data.columns===3?'selected':''}>3</option><option value="4" ${data.columns===4?'selected':''}>4</option></select></div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:16px 0;"/>
    ${data.images.map((img, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:8px;">
        <p style="font-size:11px;font-weight:700;color:#ff6b35;margin-bottom:8px;">Image ${i+1}</p>
        <div class="bsm-field"><label>Image URL</label><input type="url" value="${img.src}" placeholder="https://..." oninput="_editingData.images[${i}].src=this.value"/></div>
        <div class="bsm-field"><label>Caption</label><input type="text" value="${img.caption}" oninput="_editingData.images[${i}].caption=this.value"/></div>
      </div>
    `).join('')}
  `;
}

function renderFooterForm(data) {
  return `
    <div class="bsm-field"><label>Logo Text</label><input type="text" value="${data.logo}" oninput="_editingData.logo=this.value"/></div>
    <div class="bsm-field"><label>Tagline</label><input type="text" value="${data.tagline}" oninput="_editingData.tagline=this.value"/></div>
    <div class="bsm-field"><label>Copyright Text</label><input type="text" value="${data.copyright}" oninput="_editingData.copyright=this.value"/></div>
    <div class="bsm-color-row"><label>Background</label><input type="color" value="${data.bgColor}" oninput="_editingData.bgColor=this.value"/></div>
    <div class="bsm-color-row"><label>Text Color</label><input type="color" value="${data.textColor}" oninput="_editingData.textColor=this.value"/></div>
    <div class="bsm-color-row"><label>Accent Color</label><input type="color" value="${data.accentColor}" oninput="_editingData.accentColor=this.value"/></div>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:16px 0;"/>
    ${data.columns.map((col, ci) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:8px;">
        <p style="font-size:11px;font-weight:700;color:#ff6b35;margin-bottom:8px;">Column ${ci+1}</p>
        <div class="bsm-field"><label>Title</label><input type="text" value="${col.title}" oninput="_editingData.columns[${ci}].title=this.value"/></div>
        <div class="bsm-field"><label>Links (label|url, one per line)</label><textarea oninput="_editingData.columns[${ci}].links=this.value.split('\\n').filter(l=>l.trim()).map(l=>{const[label,url]=(l+'|#').split('|');return{label:label.trim(),url:(url||'#').trim()}})">${col.links.map(l=>l.label+'|'+l.url).join('\n')}</textarea></div>
      </div>
    `).join('')}
  `;
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
  closeBlockModal();
  refreshPreview();
  updateLayers();
  showToast('✅ Saved!', 'Block settings updated', 'success');
}

/* ──────────────────────────────────────────────────────────────────
   TEMPLATE MANAGEMENT
────────────────────────────────────────────────────────────────── */
function applyTemplate(tplKey) {
  if (!Templates[tplKey]) return;

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

  const siteName = document.getElementById('site-name-input').value || 'my-site';

  // Build the export HTML (self-contained)
  const exportHTML = buildExportHTML();
  const exportCSS = buildExportCSS();
  const exportJS = buildExportJS();

  // Download all three files
  downloadFile(siteName + '-index.html', exportHTML, 'text/html');
  setTimeout(() => downloadFile(siteName + '-style.css', exportCSS, 'text/css'), 200);
  setTimeout(() => downloadFile(siteName + '-script.js', exportJS, 'text/javascript'), 400);

  // SSV26.1: Record this export against the usage counter
  UsageTracker.recordExport();

  // Show success modal
  setTimeout(() => {
    document.getElementById('export-modal').style.display = 'flex';
  }, 600);
}

function buildExportHTML() {
  const siteName = document.getElementById('site-name-input').value || 'My Site';
  const template = Templates[State.currentTemplate];
  const styles = { ...State.globalStyles, ...template.overrides };
  const cssVars = Object.entries(styles).map(([k, v]) => `${k}: ${v};`).join('\n    ');

  const blocksHTML = State.blocks.map(block => {
    const renderer = BlockRenderers[block.type];
    if (!renderer) return '';
    return `<!-- Block: ${block.label} -->\n${renderer(block.data)}`;
  }).join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${siteName}</title>
  <meta name="description" content="Built with Supersuite — the fastest website builder"/>
  <!-- Favicon injected by Supersuite SSV26.1 -->
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23ff6b35'/%3E%3Ctext x='16' y='23' font-family='Arial Black,sans-serif' font-size='16' font-weight='900' text-anchor='middle' fill='white'%3ESS%3C/text%3E%3C/svg%3E"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="style.css"/>
</head>
<body>

${blocksHTML}

<script src="script.js"><\/script>
</body>
</html>`;
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    showToast('⌛ Undo', 'Undo coming soon!', 'info');
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
}

/* ──────────────────────────────────────────────────────────────────
   BOOT
   initApp() is called by checkPassword() after successful login.
   The duplicate stub below has been removed in SSV26.1.
────────────────────────────────────────────────────────────────── */
