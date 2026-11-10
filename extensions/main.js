/**
 * Appearance settings for the Linux build.
 *
 * Adds one entry to the account menu that opens a small dialog with three
 * settings: palette, text size and the language of this dialog. Everything is
 * applied through CSS custom properties that the renderer already uses, so no
 * vendor code is touched.
 *
 * Stored in localStorage under `scnet.ext.*`. Nothing leaves the machine.
 */
(function () {
  'use strict';

  var host = window.host;
  if (!host || !host.context) return;
  if (window.__scnetExtLoaded) return;
  // The compat renderer hosts the sign-in shell; no settings there.
  if (/\/compat\//.test(location.pathname)) return;
  window.__scnetExtLoaded = true;

  var KEYS = { palette: 'scnet.ext.palette', size: 'scnet.ext.size', lang: 'scnet.ext.lang' };
  var PALETTES = ['system', 'paper', 'sand', 'forest', 'indigo', 'ink'];
  var SIZES = ['sm', 'md', 'lg'];

  var TEXT = {
    zh: {
      menu: '外观',
      title: '外观',
      palette: '配色',
      size: '字号',
      language: '语言',
      close: '关闭',
      palettes: { system: '跟随应用', paper: '纸白', sand: '暖砂', forest: '森绿', indigo: '靛蓝', ink: '墨黑' },
      sizes: { sm: '小', md: '标准', lg: '大' },
      note: '仅本面板与色彩、字号生效；客户端正文由厂商提供，暂只有中文。',
    },
    en: {
      menu: 'Appearance',
      title: 'Appearance',
      palette: 'Palette',
      size: 'Text size',
      language: 'Language',
      close: 'Close',
      palettes: { system: 'Follow app', paper: 'Paper', sand: 'Sand', forest: 'Forest', indigo: 'Indigo', ink: 'Ink' },
      sizes: { sm: 'Small', md: 'Default', lg: 'Large' },
      note: 'Applies to the palette, text size and this dialog. Vendor UI text stays Chinese.',
    },
  };

  var settings = {
    palette: read(KEYS.palette, PALETTES, 'system'),
    size: read(KEYS.size, SIZES, 'md'),
    lang: read(KEYS.lang, ['zh', 'en'], 'zh'),
  };

  function read(key, allowed, fallback) {
    try {
      var value = localStorage.getItem(key);
      if (allowed.indexOf(value) >= 0) return value;
    } catch (error) {
      /* storage unavailable: use the default */
    }
    return fallback;
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { /* window-only */ }
  }

  function t() { return TEXT[settings.lang] || TEXT.zh; }

  // ------------------------------------------------------------------ applying

  function apply() {
    var root = document.documentElement;
    if (settings.palette === 'system') delete root.dataset.scnetTheme;
    else root.dataset.scnetTheme = settings.palette;
    root.dataset.scnetSize = settings.size;
  }

  function setPalette(name) { settings.palette = name; store(KEYS.palette, name); apply(); refresh(); }
  function setSize(name) { settings.size = name; store(KEYS.size, name); apply(); refresh(); }
  function setLang(name) { settings.lang = name; store(KEYS.lang, name); refresh(); translateDom(); }

  // -------------------------------------------------------------------- dialog

  var dialog = {
    root: null,
    body: null,

    open: function () {
      if (!this.root) this.build();
      this.render();
      this.root.removeAttribute('hidden');
      var first = this.root.querySelector('button');
      if (first) first.focus();
    },

    close: function () {
      if (this.root) this.root.setAttribute('hidden', 'hidden');
    },

    build: function () {
      var self = this;
      var root = document.createElement('div');
      root.id = 'scnet-ext';
      root.className = 'sx-overlay';
      root.setAttribute('hidden', 'hidden');

      var card = document.createElement('div');
      card.className = 'sx-dialog';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');

      var head = document.createElement('div');
      head.className = 'sx-dialog-head';
      var title = document.createElement('strong');
      head.appendChild(title);
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'sx-icon-button';
      close.textContent = '×';
      close.addEventListener('click', function () { self.close(); });
      head.appendChild(close);
      card.appendChild(head);

      var body = document.createElement('div');
      body.className = 'sx-dialog-body';
      card.appendChild(body);

      root.appendChild(card);
      document.body.appendChild(root);

      root.addEventListener('click', function (event) {
        if (event.target === root) self.close();
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') self.close();
      });

      this.root = root;
      this.title = title;
      this.body = body;
    },

    render: function () {
      var self = this;
      var text = t();
      this.title.textContent = text.title;
      this.body.textContent = '';

      this.body.appendChild(group(text.palette, PALETTES.map(function (name) {
        return chip(text.palettes[name], 'palette-' + name, settings.palette === name, function () {
          setPalette(name);
        });
      })));

      this.body.appendChild(group(text.size, SIZES.map(function (name) {
        return chip(text.sizes[name], null, settings.size === name, function () { setSize(name); }, 'is-size');
      })));

      this.body.appendChild(group(text.language, [['zh', '中文'], ['en', 'English']].map(function (pair) {
        return chip(pair[1], null, settings.lang === pair[0], function () { setLang(pair[0]); });
      })));

      var note = document.createElement('p');
      note.className = 'sx-note';
      note.textContent = text.note;
      this.body.appendChild(note);

      void self;
    },
  };

  function group(label, chips) {
    var row = document.createElement('div');
    row.className = 'sx-group';
    var name = document.createElement('span');
    name.className = 'sx-group-label';
    name.textContent = label;
    row.appendChild(name);
    var list = document.createElement('div');
    list.className = 'sx-chips';
    chips.forEach(function (chipNode) { list.appendChild(chipNode); });
    row.appendChild(list);
    return row;
  }

  function chip(label, swatch, active, onClick, extra) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sx-chip' + (active ? ' is-active' : '') + (extra ? ' ' + extra : '');
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (swatch) {
      var dot = document.createElement('span');
      dot.className = 'sx-swatch';
      dot.dataset.palette = swatch.replace('palette-', '');
      button.appendChild(dot);
    }
    var text = document.createElement('span');
    text.textContent = label;
    button.appendChild(text);
    button.addEventListener('click', onClick);
    return button;
  }

  function refresh() {
    if (dialog.root && !dialog.root.hasAttribute('hidden')) dialog.render();
    syncMenuLabel();
    translateDom();
  }

  // ------------------------------------------------------------ dom translation

  /*
   * The vendor renderer has no language switch, so English is applied to a
   * curated set of labels in the two places it is most visible: the sidebar and
   * the account menu. Only exact text matches are replaced, only inside those
   * two containers, and the original text is remembered per text node so that
   * switching back restores it. Anything upstream changes or adds stays as
   * shipped.
   */
  var LABELS = {
    '新建任务': 'New task',
    '消息频道': 'Channels',
    '插件': 'Plugins',
    '自动化': 'Automations',
    '高性能计算': 'HPC',
    '项目': 'Projects',
    '最近': 'Recent',
    '实名认证': 'Verified',
    '我的资源': 'My resources',
    '费用中心': 'Billing',
    '设置': 'Settings',
    '帮助': 'Help',
    '退出登录': 'Sign out',
  };

  var originals = new WeakMap();

  function containers() {
    var list = [];
    var sidebar = document.querySelector('aside.sidebar-shell');
    if (sidebar) list.push(sidebar);
    var menu = document.querySelector('.account-menu');
    if (menu) list.push(menu);
    return list;
  }

  /**
   * The vendor renderer localises itself from the account language and rewrites
   * its own setting at startup, so translating its labels would fight it when it
   * already renders English. The table therefore applies only while the vendor
   * interface is Chinese.
   */
  function vendorSpeaksChinese() {
    var lang = (document.documentElement.lang || '').toLowerCase();
    if (!lang) return true;
    return lang.indexOf('zh') === 0;
  }

  function translateDom() {
    var english = settings.lang === 'en' && vendorSpeaksChinese();
    containers().forEach(function (root) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        var text = node.nodeValue;
        var key = text.trim();
        if (!key) continue;
        if (english) {
          var translation = LABELS[key];
          if (!translation) continue;
          if (!originals.has(node)) originals.set(node, text);
          if (text !== translation) node.nodeValue = translation;
        } else if (originals.has(node)) {
          var original = originals.get(node);
          if (text !== original) node.nodeValue = original;
          originals.delete(node);
        }
      }
    });
  }

  // ---------------------------------------------------------------- menu entry

  /*
   * The item lives in the account menu under the avatar. That menu is rendered
   * by the vendor on every open and its styles are scoped with a data-v
   * attribute, which the injected item copies at runtime.
   */
  function svgIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'account-menu__item-icon shrink-0 block');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h4a5 5 0 0 0 0-10z');
    svg.appendChild(path);
    return svg;
  }

  function injectMenu() {
    var menu = document.querySelector('.account-menu');
    if (!menu) return;
    var existing = menu.querySelector('[data-scnet-ext="appearance"]');
    if (existing) {
      // Only touch the DOM when the label really differs: writing textContent
      // replaces the child node, which would retrigger the observer.
      var existingLabel = existing.querySelector('span.grow');
      if (existingLabel && existingLabel.textContent !== t().menu) existingLabel.textContent = t().menu;
      return;
    }
    var items = menu.querySelectorAll(':scope > button.account-menu__item');
    if (!items.length) return;

    var template = items[0];
    var scope = null;
    for (var i = 0; i < template.attributes.length; i += 1) {
      var attr = template.attributes[i];
      if (attr.name.indexOf('data-v-') === 0) { scope = { name: attr.name, value: attr.value }; break; }
    }
    var danger = null;
    for (var k = 0; k < items.length; k += 1) {
      if (items[k].className.indexOf('--danger') >= 0) danger = items[k];
    }

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'account-menu__item';
    button.setAttribute('data-scnet-ext', 'appearance');
    button.setAttribute('data-testid', 'scnet-ext-appearance');
    if (scope) button.setAttribute(scope.name, scope.value);
    button.appendChild(svgIcon());
    var label = document.createElement('span');
    label.className = 'grow basis-0 min-w-0';
    if (scope) label.setAttribute(scope.name, scope.value);
    label.textContent = t().menu;
    button.appendChild(label);
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      dialog.open();
      closeMenu();
    });

    if (danger && danger.parentElement === menu) menu.insertBefore(button, danger);
    else menu.appendChild(button);
  }

  function syncMenuLabel() { injectMenu(); }

  function closeMenu() {
    var trigger = document.querySelector('.account-trigger');
    if (trigger) trigger.click();
  }

  // ------------------------------------------------------------------- startup

  function start() {
    apply();
    injectMenu();
    translateDom();
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; injectMenu(); translateDom(); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  window.__scnetExt = {
    settings: settings,
    dialog: dialog,
    apply: apply,
    setPalette: setPalette,
    setSize: setSize,
    setLang: setLang,
    translateDom: translateDom,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
