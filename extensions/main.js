/**
 * SCNet client extensions for the Linux build.
 *
 * Loaded by the `extension` patch in scripts/patch-vendor.cjs, after the vendor
 * renderer has booted. Every module talks to the main process through the
 * bridge the vendor preload exposes (`window.host`), and each one disables
 * itself when the operation it needs is unavailable, so a vendor update can
 * remove a module without breaking the shell.
 *
 * Nothing here writes outside `localStorage`; no data leaves the machine.
 *
 * Modules
 *   theme       canvas, surface, text and accent tokens per theme
 *   usage       per-centre balances and consumption
 *   billing     paginated bills with CSV export
 *   jobs        state-transition notifications
 *   diagnostics version, platform, log tail and connectivity probe
 */
(function () {
  'use strict';

  var host = window.host;
  if (!host || !host.context || !host.invoke) return;
  if (window.__scnetExtLoaded) return;
  // The compat renderer hosts the sign-in shell: no panel there.
  if (/\/compat\//.test(location.pathname)) return;
  window.__scnetExtLoaded = true;

  try {
    if (localStorage.getItem('scnet.ext.disabled') === '1') return;
  } catch (error) {
    /* storage unavailable: continue without persisted preferences */
  }

  var THEMES = ['system', 'paper', 'claude'];
  var STORE = {
    theme: 'scnet.ext.theme',
    notifications: 'scnet.ext.notifications',
    panel: 'scnet.ext.panel',
  };

  var settings = readSettings();

  function readSettings() {
    var out = { theme: 'system', notifications: true, panel: null };
    try {
      var theme = localStorage.getItem(STORE.theme);
      if (THEMES.indexOf(theme) >= 0) out.theme = theme;
      out.notifications = localStorage.getItem(STORE.notifications) !== '0';
      out.panel = localStorage.getItem(STORE.panel);
    } catch (error) {
      /* defaults stand */
    }
    return out;
  }

  function writeSetting(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (error) {
      /* non-fatal: the choice lasts for this window only */
    }
  }

  // ------------------------------------------------------------------ helpers

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    for (var key in attrs || {}) {
      if (key === 'text') node.textContent = attrs[key];
      else if (key === 'class') node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    }
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function money(value, currency) {
    var number = Number(value);
    if (!isFinite(number)) return '—';
    var suffix = currency ? ' ' + currency : '';
    return number.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + suffix;
  }

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function timestamp(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  /** Call a host operation, returning {ok, value} rather than throwing. */
  function call(operation, payload) {
    return host.invoke(operation, payload).then(
      function (value) { return { ok: true, value: value }; },
      function (error) { return { ok: false, error: error }; }
    );
  }

  /**
   * Read-side platform call. `scnet.read` takes {method, payload}; an unknown
   * method is rejected by the main-process schema, which modules use to detect
   * an API that the platform has not exposed yet.
   */
  function scnet(method, payload) {
    return call('scnet.read', { method: method, payload: payload });
  }

  // -------------------------------------------------------------------- theme

  var themeModule = {
    id: 'theme',
    apply: function (name) {
      if (THEMES.indexOf(name) < 0) name = 'system';
      if (name === 'system') delete document.documentElement.dataset.scnetTheme;
      else document.documentElement.dataset.scnetTheme = name;
      settings.theme = name;
      writeSetting(STORE.theme, name);
      if (board.refreshSettings) board.refreshSettings();
    },
  };

  // -------------------------------------------------------------------- usage

  // The platform returns cluster accounts from `account.get`; per-centre
  // consumption is expected from `usage.centers`, which the platform team is
  // adding. Until it resolves, the module derives what it can from the account
  // payload and states the limitation in the panel.
  var usageModule = {
    id: 'usage',
    cache: null,
    loadedAt: 0,
    state: { loading: false, error: null, accounts: [], wallet: null, special: null, currency: '', derived: false, hasConsumption: false },

    refresh: function (force, attempt) {
      var now = Date.now();
      if (!force && this.cache && now - this.loadedAt < 60000) return Promise.resolve(this.cache);
      var self = this;
      var tries = attempt || 0;
      self.state.loading = true;
      if (board.renderUsage) board.renderUsage();

      return scnet('usage.centers').then(function (res) {
        if (res.ok && res.value) {
          self.state = normaliseUsage(res.value);
          self.state.derived = false;
          return self.finish();
        }
        return scnet('account.get').then(function (fallback) {
          if (!fallback.ok) {
            // The agent runtime is still booting for the first seconds after launch;
            // one retry avoids reporting a transient failure as a persistent one.
            if (tries < 1) {
              return new Promise(function (resolve) { setTimeout(resolve, 2500); })
                .then(function () { return self.refresh(true, tries + 1); });
            }
            self.state = { loading: false, error: describe(fallback.error), accounts: [], wallet: null, special: null, currency: '', derived: false, hasConsumption: false };
            self.cache = null;
            self.loadedAt = 0;
            if (board.renderUsage) board.renderUsage();
            return self.state;
          }
          self.state = normaliseUsage(fallback.value);
          self.state.derived = true;
          return self.finish();
        });
      });
    },

    finish: function () {
      this.state.loading = false;
      this.loadedAt = Date.now();
      this.cache = this.state;
      if (board.renderUsage) board.renderUsage();
      return this.state;
    },
  };

  function describe(error) {
    if (!error) return '请求失败';
    if (typeof error === 'string') return error;
    return error.message || error.code || '请求失败';
  }

  /**
   * Two payload shapes are accepted.
   *
   * `usage.centers` (to be provided by the platform) is expected to return one
   * entry per centre with consumption figures. Until it exists, `account.get`
   * returns a wallet plus one entry per cluster account, where `centerNames` and
   * `clusterIds` are parallel arrays: the module expands them into one row per
   * centre and leaves the consumption columns empty rather than repeating the
   * account balance twelve times.
   */
  function normaliseUsage(input) {
    var value = input || {};
    var wallet = value.wallet || {};
    var state = {
      loading: false,
      error: null,
      accounts: [],
      wallet: firstNumber(wallet.walletBalance, value.walletBalance, value.balance),
      special: firstNumber(wallet.specialBalance, value.specialBalance),
      currency: value.currency || value.currencyCode || '',
      derived: false,
      hasConsumption: false,
    };

    var perCentre = Array.isArray(value.centres) ? value.centres : Array.isArray(value.centers) ? value.centers : null;
    if (perCentre) {
      state.hasConsumption = true;
      state.accounts = [{
        account: value.accountName || '当前账户',
        status: '',
        balance: null,
        centres: perCentre.map(function (item) {
          return {
            name: item.centerName || item.centreName || item.name || '—',
            cluster: Array.isArray(item.clusterIds) ? item.clusterIds.join(', ') : (item.clusterId || ''),
            coreHours: firstNumber(item.cpuCoreHours, item.coreHours, item.cpuHours),
            gpuHours: firstNumber(item.gpuCardHours, item.cardHours, item.gpuHours),
            storage: firstNumber(item.storageUsage, item.storageGiB, item.storage),
          };
        }),
      }];
      return state;
    }

    var accounts = Array.isArray(value.accounts) ? value.accounts : [];
    state.accounts = accounts.map(function (account) {
      var names = Array.isArray(account.centerNames) ? account.centerNames
        : account.centerName ? [account.centerName] : [];
      var clusters = Array.isArray(account.clusterIds) ? account.clusterIds
        : account.clusterId ? [account.clusterId] : [];
      var count = Math.max(names.length, clusters.length, 1);
      var centres = [];
      for (var i = 0; i < count; i += 1) {
        centres.push({
          name: names[i] || names.join(' / ') || '—',
          cluster: clusters[i] || '',
          coreHours: null,
          gpuHours: null,
          storage: null,
        });
      }
      return {
        account: account.name || account.accountId || '—',
        status: account.status || (account.expired === true ? 'expired' : ''),
        balance: firstNumber(account.balance),
        centres: centres,
      };
    });
    return state;
  }

  function firstNumber() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (value === null || value === undefined || value === '') continue;
      var number = Number(value);
      if (isFinite(number)) return number;
    }
    return null;
  }

  // ------------------------------------------------------------------ billing

  var billingModule = {
    id: 'billing',
    page: 1,
    pageSize: 20,
    rows: [],
    total: null,
    loading: false,
    error: null,

    load: function (page) {
      var self = this;
      self.page = page || 1;
      self.loading = true;
      if (board.renderBilling) board.renderBilling();
      return scnet('billing.list', { page: self.page, pageSize: self.pageSize }).then(function (res) {
        self.loading = false;
        if (!res.ok) {
          self.error = describe(res.error);
          self.rows = [];
          if (board.renderBilling) board.renderBilling();
          return;
        }
        var value = res.value || {};
        var rows = value.items || value.records || value.list || value.rows || value.data || [];
        self.rows = Array.isArray(rows) ? rows : [];
        self.total = firstNumber(value.total, value.totalCount, value.count);
        self.error = null;
        if (board.renderBilling) board.renderBilling();
      });
    },

    exportCsv: function () {
      var self = this;
      if (!self.rows.length) return;
      var columns = [];
      self.rows.forEach(function (row) {
        Object.keys(row || {}).forEach(function (key) {
          if (columns.indexOf(key) < 0) columns.push(key);
        });
      });
      var lines = [columns.join(',')];
      self.rows.forEach(function (row) {
        lines.push(columns.map(function (key) {
          var cell = row[key];
          if (cell === null || cell === undefined) cell = '';
          if (typeof cell === 'object') cell = JSON.stringify(cell);
          return '"' + String(cell).replace(/"/g, '""') + '"';
        }).join(','));
      });
      var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = el('a', { href: url, download: 'scnet-bills.csv' });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },
  };

  // --------------------------------------------------------------------- jobs

  var jobsModule = {
    id: 'jobs',
    seen: {},
    timer: null,
    priming: true,

    start: function () {
      if (this.timer) return;
      var self = this;
      var tick = function () {
        // The first pass only records the current state; notifying for jobs that
        // were already finished would render the feature useless.
        scnet('jobs.list', { page: 1, pageSize: 50 }).then(function (res) {
          if (!res.ok) return;
          var value = res.value || {};
          var rows = value.records || value.list || value.rows || value.items || value.data || [];
          if (!Array.isArray(rows)) return;
          rows.forEach(function (job) {
            var id = job.jobId || job.id || job.name;
            var state = job.state || job.status;
            if (!id || !state) return;
            var previous = self.seen[id];
            self.seen[id] = state;
            if (self.priming || previous === state) return;
            if (!settings.notifications) return;
            if (!/^(completed|finished|failed|cancelled|canceled|timeout|succeeded)$/i.test(String(state))) return;
            self.notify(job, state);
          });
          self.priming = false;
        });
      };
      tick();
      this.timer = setInterval(tick, 60000);
    },

    notify: function (job, state) {
      var title = '作业 ' + (job.jobId || job.id || job.name || '') + ' ' + state;
      var body = [job.appName || job.name, job.queue, job.centerName].filter(Boolean).join(' · ');
      try {
        if (typeof Notification === 'undefined') return;
        if (Notification.permission === 'granted') new Notification(title, { body: body });
        else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(function (permission) {
            if (permission === 'granted') new Notification(title, { body: body });
          });
        }
      } catch (error) {
        /* notifications are optional */
      }
    },
  };

  // ----------------------------------------------------------------- transfers

  var transfersModule = {
    id: 'transfers',
    rows: [],
    loading: false,
    error: null,
    timer: null,

    load: function () {
      var self = this;
      self.loading = true;
      if (board.renderTransfers) board.renderTransfers();
      return Promise.all([
        scnet('transfers.list'),
        scnet('file-tasks.list'),
      ]).then(function (results) {
        self.loading = false;
        var transfer = results[0];
        var tasks = results[1];
        if (!transfer.ok && !tasks.ok) {
          self.error = describe(transfer.error || tasks.error);
          self.rows = [];
        } else {
          self.error = null;
          self.rows = collectRows(transfer).concat(collectRows(tasks));
        }
        if (board.renderTransfers) board.renderTransfers();
      });
    },

    watch: function () {
      if (this.timer) return;
      var self = this;
      this.timer = setInterval(function () {
        if (settings.panel === 'transfers') self.load();
      }, 15000);
    },
  };

  function collectRows(result) {
    if (!result.ok || !result.value) return [];
    var value = result.value;
    var rows = value.items || value.records || value.list || value.rows || value.data || [];
    return Array.isArray(rows) ? rows : [];
  }

  // -------------------------------------------------------------- connectivity

  var connectivityModule = {
    id: 'connectivity',
    rows: [],
    running: false,
    targets: [
      ['api.scnet.cn', 'https://api.scnet.cn'],
      ['www.scnet.cn', 'https://www.scnet.cn'],
      ['dlcdn.scnet.cn', 'https://dlcdn.scnet.cn'],
    ],

    run: function () {
      var self = this;
      self.running = true;
      if (board.renderConnectivity) board.renderConnectivity();
      return Promise.all(self.targets.map(function (pair) {
        return probeDetail(pair[1]).then(function (result) {
          return { name: pair[0], url: pair[1], status: result.status, ms: result.ms };
        });
      })).then(function (rows) {
        self.rows = rows;
        self.running = false;
        if (board.renderConnectivity) board.renderConnectivity();
      });
    },
  };

  function probeDetail(url) {
    var started = performance.now();
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 3000);
    return fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller ? controller.signal : undefined })
      .then(function () { return 'reachable'; }, function (error) { return 'unreachable (' + ((error && error.name) || 'error') + ')'; })
      .then(function (status) {
        clearTimeout(timer);
        return { status: status, ms: Math.round(performance.now() - started) };
      });
  }

  // ----------------------------------------------------------- console routes

  var consoleRoutes = [
    ['费用总览', '/ui/console6/index.html#/fee/fee-summary'],
    ['账单明细', '/ui/console6/index.html#/fee/fee-list/shareJob'],
    ['资源中心', '/ui/console6/index.html#/my-product/basic-resources/computing-cesource'],
    ['资源申请', '/ac/console3/index.html#/ware/apply-cluster'],
    ['反馈工单', '/ui/console6/index.html#/feedback/add'],
    ['个人信息', '/ui/console/index.html#/personal/base-info'],
  ];

  function openRoute(route) {
    return call('auth.open-authenticated-route', { route: route });
  }

  // -------------------------------------------------------------- diagnostics

  var diagnosticsModule = {
    id: 'diagnostics',

    collect: function () {
      var env = host.context || {};
      var report = [
        'SCNet client diagnostics',
        'time: ' + new Date().toISOString(),
        'platform: ' + (env.platform || '?') + '/' + (env.arch || '?'),
        'client: ' + instVersion,
        'shell: ' + (navigator.userAgent || '?'),
        'theme: ' + settings.theme,
        'sandbox: ' + (window.__scnetSandbox || 'unknown'),
        'protocol: ' + location.protocol,
      ];
      return call('app.get-version').then(function (res) {
        if (res.ok && res.value) report[4] = 'client: ' + JSON.stringify(res.value);
        return call('diagnostics.read-file', { domain: 'app', tailLines: 200 });
      }).then(function (res) {
        if (res.ok && res.value) {
          var text = typeof res.value === 'string' ? res.value : (res.value.content || res.value.text || '');
          if (text) report.push('', '--- log tail ---', text.slice(-12000));
        }
        return Promise.all([probe('https://api.scnet.cn'), probe('https://www.scnet.cn')]);
      }).then(function (probes) {
        report.push('', '--- connectivity ---');
        probes.forEach(function (line) { report.push(line); });
        return report.join('\n');
      });
    },

    copy: function () {
      return this.collect().then(function (text) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
        } catch (error) {
          /* fall through to the textarea path */
        }
        var area = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
        area.value = text;
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); } catch (error) { /* ignore */ }
        document.body.removeChild(area);
      });
    },
  };

  var instVersion = '?';

  function probe(url) {
    var started = performance.now();
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 3000);
    return Promise.resolve()
      .then(function () {
        return fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller ? controller.signal : undefined });
      })
      .then(function () { return 'reachable'; }, function (error) { return 'unreachable (' + (error && error.name || 'error') + ')'; })
      .then(function (result) {
        clearTimeout(timer);
        return url + ': ' + result + ' ' + Math.round(performance.now() - started) + ' ms';
      });
  }

  // ----------------------------------------------------------------- the board

  var board = {
    root: null,
    panel: null,

    mount: function () {
      var self = this;
      var root = el('div', { id: 'scnet-ext', class: 'sx-view', hidden: 'hidden' });

      var head = el('div', { class: 'sx-view-head' });
      head.appendChild(el('span', { class: 'sx-view-title', text: '资源用量' }));
      var tabs = el('div', { class: 'sx-tabs' });
      [['用量', 'usage'], ['账单', 'billing'], ['传输', 'transfers'], ['连接', 'connectivity'], ['设置', 'settings']]
        .forEach(function (pair) { tabs.appendChild(tab(pair[0], pair[1])); });
      head.appendChild(tabs);
      var close = el('button', { class: 'sx-close', type: 'button', title: '返回', text: '×' });
      close.addEventListener('click', function () { self.hide(); });
      head.appendChild(close);
      root.appendChild(head);

      var body = el('div', { class: 'sx-body' });
      root.appendChild(body);
      document.body.appendChild(root);
      this.root = root;
      this.body = body;

      root.addEventListener('click', function (event) {
        var target = event.target;
        if (target && target.dataset && target.dataset.tab) self.show(target.dataset.tab);
      });

      window.addEventListener('resize', function () {
        if (self.root && !self.root.hasAttribute('hidden')) self.place();
      });
    },

    /** Align the view with the content area, to the right of the sidebar. */
    place: function () {
      var anchor = document.querySelector('.sidebar-footer') || document.querySelector('.sidebar-primary-menu');
      if (!anchor) return;
      var box = anchor.getBoundingClientRect();
      this.root.style.left = Math.round(box.right) + 'px';
    },

    open: function (name) {
      this.show(name || settings.panel || 'usage');
    },

    hide: function () {
      this.root.setAttribute('hidden', 'hidden');
      var nav = document.querySelector('[data-scnet-ext="nav"]');
      if (nav) nav.classList.remove('sx-nav-active');
      var again = document.querySelector('[data-scnet-ext="nav"]');
      if (again) again.setAttribute('aria-current', 'false');
    },

    show: function (name) {
      settings.panel = name;
      writeSetting(STORE.panel, name);
      this.root.removeAttribute('hidden');
      this.place();
      var navButton = document.querySelector('[data-scnet-ext="nav"]');
      if (navButton) {
        navButton.classList.add('sx-nav-active');
        navButton.setAttribute('aria-current', 'true');
      }
      Array.prototype.forEach.call(this.root.querySelectorAll('[data-tab]'), function (node) {
        node.classList.toggle('sx-active', node.dataset.tab === name);
      });
      if (name === 'usage') { usageModule.refresh(usageModule.state.error !== null); this.renderUsage(); }
      if (name === 'billing') { billingModule.load(1); this.renderBilling(); }
      if (name === 'transfers') { transfersModule.load(); this.renderTransfers(); }
      if (name === 'connectivity') { if (!connectivityModule.rows.length) connectivityModule.run(); this.renderConnectivity(); }
      if (name === 'settings') this.renderSettings();
    },

    renderUsage: function () {
      if (!this.body || settings.panel !== 'usage') return;
      var state = usageModule.state;
      var body = this.body;
      body.textContent = '';
      if (state.loading) { body.appendChild(el('p', { class: 'sx-muted', text: '正在读取用量…' })); return; }
      if (state.error) { body.appendChild(el('p', { class: 'sx-error', text: state.error })); return; }

      if (state.wallet !== null || state.special !== null) {
        var summary = el('div', { class: 'sx-summary' }, [el('span', { class: 'sx-muted', text: '钱包余额' })]);
        summary.appendChild(el('strong', { text: money(state.wallet, state.currency) }));
        if (state.special !== null) {
          summary.appendChild(el('span', { class: 'sx-muted', text: '赠送余额' }));
          summary.appendChild(el('strong', { text: money(state.special, state.currency) }));
        }
        body.appendChild(summary);
      }

      if (!state.accounts.length) {
        body.appendChild(el('p', { class: 'sx-muted', text: '没有可显示的用量数据。' }));
        return;
      }

      var self = this;
      state.accounts.forEach(function (account) {
        var head = el('div', { class: 'sx-account' }, [
          el('strong', { text: account.account }),
          account.status ? el('span', { class: 'sx-tag', text: account.status }) : null,
          account.balance === null ? null : el('span', { class: 'sx-muted', text: '账户余额 ' + money(account.balance, state.currency) }),
          el('span', { class: 'sx-muted', text: account.centres.length + ' 个中心' }),
        ]);
        body.appendChild(head);

        var headers = state.hasConsumption
          ? ['中心', '集群', '核心时', '卡时', '存储']
          : ['中心', '集群'];
        var table = el('table', { class: 'sx-table' });
        table.appendChild(el('thead', {}, [el('tr', {}, headers.map(function (label) {
          return el('th', { text: label });
        }))]));
        var tbody = el('tbody');
        account.centres.forEach(function (centre) {
          var cells = [centre.name, centre.cluster || '—'];
          if (state.hasConsumption) {
            cells.push(centre.coreHours === null ? '—' : money(centre.coreHours));
            cells.push(centre.gpuHours === null ? '—' : money(centre.gpuHours));
            cells.push(centre.storage === null ? '—' : money(centre.storage));
          }
          tbody.appendChild(el('tr', {}, cells.map(function (value) { return el('td', { text: String(value) }); })));
        });
        table.appendChild(tbody);
        body.appendChild(table);
      });

      if (state.derived) {
        body.appendChild(el('p', {
          class: 'sx-muted',
          text: '分中心用量接口尚未开放：当前列出账户所属中心与集群，消耗数据待接口上线后显示。',
        }));
      }
      var actions = el('div', { class: 'sx-actions' });
      actions.appendChild(el('button', { class: 'sx-action', type: 'button', text: '刷新' }))
        .addEventListener('click', function () { usageModule.refresh(true); });
      body.appendChild(actions);

      body.appendChild(el('p', { class: 'sx-muted', text: '控制台页面在默认浏览器中打开，沿用当前登录态。' }));
      var consoleRow = el('div', { class: 'sx-actions sx-wrap' });
      consoleRoutes.forEach(function (pair) {
        consoleRow.appendChild(el('button', { class: 'sx-link', type: 'button', text: pair[0] }))
          .addEventListener('click', function () { openRoute(pair[1]); });
      });
      body.appendChild(consoleRow);
    },

    renderTransfers: function () {
      if (!this.body || settings.panel !== 'transfers') return;
      var body = this.body;
      body.textContent = '';
      if (transfersModule.loading) { body.appendChild(el('p', { class: 'sx-muted', text: '正在读取传输任务…' })); return; }
      if (transfersModule.error) { body.appendChild(el('p', { class: 'sx-error', text: transfersModule.error })); return; }
      if (!transfersModule.rows.length) {
        body.appendChild(el('p', { class: 'sx-muted', text: '没有进行中的传输或文件任务。' }));
        return;
      }
      var rows = transfersModule.rows;
      var columns = [];
      rows.forEach(function (row) {
        Object.keys(row || {}).forEach(function (key) {
          if (columns.indexOf(key) < 0 && columns.length < 5) columns.push(key);
        });
      });
      var table = el('table', { class: 'sx-table' });
      table.appendChild(el('thead', {}, [el('tr', {}, columns.map(function (key) { return el('th', { text: key }); }))]));
      var tbody = el('tbody');
      rows.forEach(function (row) {
        tbody.appendChild(el('tr', {}, columns.map(function (key) {
          var value = row[key];
          if (typeof value === 'object' && value !== null) value = JSON.stringify(value);
          return el('td', { text: value === null || value === undefined ? '—' : String(value) });
        })));
      });
      table.appendChild(tbody);
      body.appendChild(table);
      body.appendChild(el('button', { class: 'sx-action', type: 'button', text: '刷新' }))
        .addEventListener('click', function () { transfersModule.load(); });
    },

    renderConnectivity: function () {
      if (!this.body || settings.panel !== 'connectivity') return;
      var body = this.body;
      body.textContent = '';
      if (connectivityModule.running) { body.appendChild(el('p', { class: 'sx-muted', text: '正在探测…' })); return; }

      var table = el('table', { class: 'sx-table' });
      table.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', { text: '站点' }), el('th', { text: '结果' }), el('th', { text: '时延' }),
      ])]));
      var tbody = el('tbody');
      connectivityModule.rows.forEach(function (row) {
        tbody.appendChild(el('tr', {}, [
          el('td', { text: row.name }),
          el('td', { text: row.status }),
          el('td', { text: row.ms + ' ms' }),
        ]));
      });
      table.appendChild(tbody);
      body.appendChild(table);
      body.appendChild(el('p', { class: 'sx-muted', text: '探测以 HEAD 请求执行，各自三秒超时；no-cors 模式下无法读取状态码。' }));
      body.appendChild(el('button', { class: 'sx-action', type: 'button', text: '重新探测' }))
        .addEventListener('click', function () { connectivityModule.run(); });
    },

    renderBilling: function () {
      if (!this.body || settings.panel !== 'billing') return;
      var body = this.body;
      body.textContent = '';
      if (billingModule.loading) { body.appendChild(el('p', { class: 'sx-muted', text: '正在读取账单…' })); return; }
      if (billingModule.error) { body.appendChild(el('p', { class: 'sx-error', text: billingModule.error })); return; }
      if (!billingModule.rows.length) { body.appendChild(el('p', { class: 'sx-muted', text: '没有账单记录。' })); return; }

      var columns = ['title', 'billingPeriod', 'amount', 'id'].filter(function (key) {
        return key in billingModule.rows[0];
      });
      if (!columns.length) columns = Object.keys(billingModule.rows[0]).slice(0, 5);
      var table = el('table', { class: 'sx-table' });
      table.appendChild(el('thead', {}, [el('tr', {}, columns.map(function (key) { return el('th', { text: key }); }))]));
      var tbody = el('tbody');
      billingModule.rows.forEach(function (row) {
        tbody.appendChild(el('tr', {}, columns.map(function (key) {
          var value = row[key];
          if (typeof value === 'object' && value !== null) value = JSON.stringify(value);
          return el('td', { text: value === null || value === undefined ? '—' : String(value) });
        })));
      });
      table.appendChild(tbody);
      body.appendChild(table);

      var actions = el('div', { class: 'sx-actions' });
      actions.appendChild(el('button', { class: 'sx-action', type: 'button', text: '上一页' }))
        .addEventListener('click', function () { if (billingModule.page > 1) billingModule.load(billingModule.page - 1); });
      if (billingModule.total !== null) {
        actions.appendChild(el('span', { class: 'sx-muted', text: '共 ' + billingModule.total + ' 条' }));
      }
      actions.appendChild(el('button', { class: 'sx-action', type: 'button', text: '下一页' }))
        .addEventListener('click', function () { billingModule.load(billingModule.page + 1); });
      actions.appendChild(el('button', { class: 'sx-action', type: 'button', text: '导出 CSV' }))
        .addEventListener('click', function () { billingModule.exportCsv(); });
      body.appendChild(actions);
    },

    renderSettings: function () {
      if (!this.body || settings.panel !== 'settings') return;
      var body = this.body;
      body.textContent = '';

      var themeRow = el('div', { class: 'sx-row' }, [el('span', { text: '主题' })]);
      var select = el('select', { class: 'sx-select' });
      [['system', '跟随应用'], ['paper', '纸白'], ['claude', 'Claude']].forEach(function (pair) {
        var option = el('option', { value: pair[0], text: pair[1] });
        if (settings.theme === pair[0]) option.selected = 'selected';
        select.appendChild(option);
      });
      select.addEventListener('change', function () { themeModule.apply(select.value); });
      themeRow.appendChild(select);
      body.appendChild(themeRow);

      var notifyRow = el('div', { class: 'sx-row' }, [el('span', { text: '作业通知' })]);
      var notify = el('input', { type: 'checkbox', class: 'sx-check' });
      if (settings.notifications) notify.checked = 'checked';
      notify.addEventListener('change', function () {
        settings.notifications = notify.checked;
        writeSetting(STORE.notifications, notify.checked ? '1' : '0');
      });
      notifyRow.appendChild(notify);
      body.appendChild(notifyRow);

      var diagRow = el('div', { class: 'sx-actions' });
      var status = el('span', { class: 'sx-muted', text: '' });
      diagRow.appendChild(el('button', { class: 'sx-action', type: 'button', text: '复制诊断信息' }))
        .addEventListener('click', function () {
          status.textContent = '正在收集…';
          diagnosticsModule.copy().then(function () { status.textContent = '已复制'; },
            function () { status.textContent = '复制失败'; });
        });
      diagRow.appendChild(status);
      body.appendChild(diagRow);

      body.appendChild(el('p', { class: 'sx-muted sx-foot', text: '版本 ' + instVersion }));
    },

    refreshSettings: function () {
      if (settings.panel === 'settings') this.renderSettings();
    },
  };

  function tab(label, name) {
    var node = el('button', { class: 'sx-tab', type: 'button', 'data-tab': name, text: label });
    return node;
  }

  // ------------------------------------------------------------- sidebar entry

  /*
   * The extension takes a place in the application's own navigation: a sixth
   * item after 高性能计算, opening a full-height view in the content area rather
   * than a floating panel. The button copies the vendor's scoped data-v
   * attribute so the vendor stylesheet applies.
   */
  var navModule = {
    id: 'nav',
    label: '资源用量',
    icon: 'M3 3v18h18M7 15v3M12 9v9M17 5v13',

    start: function () {
      var self = this;
      this.inject();
      new MutationObserver(function () { self.inject(); })
        .observe(document.body, { childList: true, subtree: true });
    },

    inject: function () {
      var menu = document.querySelector('nav.sidebar-primary-menu');
      if (!menu || menu.querySelector('[data-scnet-ext="nav"]')) return;
      var template = menu.querySelector('button.sidebar-nav-button');
      if (!template) return;

      var scope = null;
      for (var i = 0; i < template.attributes.length; i += 1) {
        var attr = template.attributes[i];
        if (attr.name.indexOf('data-v-') === 0) { scope = { name: attr.name, value: attr.value }; break; }
      }

      var button = el('button', { class: 'sidebar-nav-button', type: 'button' });
      button.setAttribute('data-scnet-ext', 'nav');
      if (scope) button.setAttribute(scope.name, scope.value);

      var iconWrap = el('span', { class: 'sidebar-nav-button__icon' });
      if (scope) iconWrap.setAttribute(scope.name, scope.value);
      iconWrap.appendChild(svgIcon(this.icon, scope));
      button.appendChild(iconWrap);

      var label = el('span', { class: 'sidebar-nav-button__label', text: this.label });
      if (scope) label.setAttribute(scope.name, scope.value);
      button.appendChild(label);

      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        board.open(settings.panel || 'usage');
      });

      menu.appendChild(button);

      // A click on any vendor entry leaves the extension view.
      menu.addEventListener('click', function (event) {
        if (event.target && event.target.closest && event.target.closest('[data-scnet-ext="nav"]')) return;
        board.hide();
      });
    },
  };

  // ------------------------------------------------------------- account menu

  /*
   * Entry points live in the account menu that opens from the avatar, next to
   * 我的资源 and 费用中心. The menu is rendered by the vendor each time it opens
   * and its styles are scoped with a data-v attribute, so the injected items copy
   * that attribute from an existing item instead of hard-coding a hash.
   */
  var MENU_ITEMS = [
    { label: '用量与账单', panel: 'usage', icon: 'chart' },
    { label: '传输任务', panel: 'transfers', icon: 'transfer' },
    { label: '连接诊断', panel: 'connectivity', icon: 'pulse' },
    { label: '主题', panel: 'settings', icon: 'palette' },
  ];

  var ICONS = {
    chart: 'M3 3v18h18M7 15v3M12 9v9M17 5v13',
    transfer: 'M12 3v12m-5-5 5 5 5-5M5 21h14',
    pulse: 'M3 12h3l3-7 4 14 3-7h3',
    palette: 'M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h4a5 5 0 0 0 0-10z',
  };

  function svgIcon(path, scope) {
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
    if (scope) svg.setAttribute(scope.name, scope.value);
    var node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    node.setAttribute('d', path);
    svg.appendChild(node);
    return svg;
  }

  var menuModule = {
    id: 'account-menu',
    observer: null,

    start: function () {
      if (this.observer) return;
      var self = this;
      this.observer = new MutationObserver(function () { self.inject(); });
      this.observer.observe(document.body, { childList: true, subtree: true });
      this.inject();
    },

    inject: function () {
      var menu = document.querySelector('.account-menu');
      if (!menu || menu.querySelector('[data-scnet-ext]')) return;

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

      MENU_ITEMS.forEach(function (item) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'account-menu__item';
        button.setAttribute('data-scnet-ext', item.panel);
        button.setAttribute('data-testid', 'scnet-ext-' + item.panel);
        if (scope) button.setAttribute(scope.name, scope.value);
        button.appendChild(svgIcon(ICONS[item.icon], scope));
        var label = document.createElement('span');
        if (scope) label.setAttribute(scope.name, scope.value);
        label.className = 'grow basis-0 min-w-0';
        label.textContent = item.label;
        button.appendChild(label);
        button.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          board.open(item.panel);
          closeMenu();
        });
        if (danger && danger.parentElement === menu) menu.insertBefore(button, danger);
        else menu.appendChild(button);
      });
    },
  };

  function closeMenu() {
    var trigger = document.querySelector('.account-trigger');
    if (trigger) trigger.click();
  }

  // ------------------------------------------------------------------- startup

  function start() {
    call('app.get-version').then(function (res) {
      if (res.ok) {
        var value = res.value;
        instVersion = typeof value === 'string' ? value : (value && (value.version || value.appVersion)) || '?';
      }
      board.mount();
      board.hide();
      navModule.start();
      menuModule.start();
      themeModule.apply(settings.theme);
      jobsModule.start();
      transfersModule.watch();
    });
  }

  // Debug handle for the verification procedure; harmless in production.
  window.__scnetExt = {
    board: board,
    usage: usageModule,
    billing: billingModule,
    jobs: jobsModule,
    transfers: transfersModule,
    connectivity: connectivityModule,
    diagnostics: diagnosticsModule,
    menu: menuModule,
    nav: navModule,
    openRoute: openRoute,
    theme: themeModule,
    settings: settings,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
