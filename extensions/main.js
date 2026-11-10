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

    refresh: function (force) {
      var now = Date.now();
      if (!force && this.cache && now - this.loadedAt < 60000) return Promise.resolve(this.cache);
      var self = this;
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
            self.state = { loading: false, error: describe(fallback.error), accounts: [], wallet: null, special: null, currency: '', derived: false, hasConsumption: false };
            return self.finish();
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
      var root = el('div', { id: 'scnet-ext', class: 'sx-root' });
      root.appendChild(el('button', {
        class: 'sx-launcher',
        type: 'button',
        title: 'SCNet 工具 / Utilities',
        text: '∑',
      }));
      root.firstChild.addEventListener('click', function () { self.toggle(); });

      var panel = el('div', { class: 'sx-panel', hidden: 'hidden' });
      panel.appendChild(el('div', { class: 'sx-tabs' }, [
        tab('用量', 'usage'),
        tab('账单', 'billing'),
        tab('设置', 'settings'),
      ]));
      var body = el('div', { class: 'sx-body' });
      panel.appendChild(body);
      root.appendChild(panel);
      document.body.appendChild(root);
      this.root = root;
      this.panel = panel;
      this.body = body;

      panel.addEventListener('click', function (event) {
        var target = event.target;
        if (target && target.dataset && target.dataset.tab) self.show(target.dataset.tab);
      });

      if (settings.panel) this.show(settings.panel);
    },

    toggle: function () {
      var hidden = this.panel.hasAttribute('hidden');
      if (hidden) this.show(settings.panel || 'usage');
      else this.hide();
    },

    hide: function () {
      this.panel.setAttribute('hidden', 'hidden');
    },

    show: function (name) {
      settings.panel = name;
      writeSetting(STORE.panel, name);
      this.panel.removeAttribute('hidden');
      Array.prototype.forEach.call(this.panel.querySelectorAll('[data-tab]'), function (node) {
        node.classList.toggle('sx-active', node.dataset.tab === name);
      });
      if (name === 'usage') { usageModule.refresh(); this.renderUsage(); }
      if (name === 'billing') { billingModule.load(1); this.renderBilling(); }
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
      body.appendChild(el('button', { class: 'sx-action', type: 'button', text: '刷新' }))
        .addEventListener('click', function () { usageModule.refresh(true); });
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

  // ------------------------------------------------------------------- startup

  function start() {
    call('app.get-version').then(function (res) {
      if (res.ok) {
        var value = res.value;
        instVersion = typeof value === 'string' ? value : (value && (value.version || value.appVersion)) || '?';
      }
      board.mount();
      themeModule.apply(settings.theme);
      usageModule.refresh();
      jobsModule.start();
    });
  }

  // Debug handle for the verification procedure; harmless in production.
  window.__scnetExt = {
    board: board,
    usage: usageModule,
    billing: billingModule,
    jobs: jobsModule,
    diagnostics: diagnosticsModule,
    theme: themeModule,
    settings: settings,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
