/**
 * Fallback window controls for Linux.
 *
 * The client draws its own minimize/maximize/close cluster, but only inside the
 * application shell that appears after sign-in; the sign-in window has no such
 * cluster and, because the window is frameless with `titleBarStyle: "hidden"`,
 * no window manager decoration either. This adds a small control cluster for
 * that case only: as soon as the shell renders its own `.window-tools`, this one
 * removes itself, so controls never appear twice.
 *
 * Loaded from dist/window-controls.js and dist/compat/window-controls.js by the
 * `login-window-controls` patch; it is inert on other platforms.
 */
(function () {
  'use strict';

  var host = window.host;
  if (!host || !host.context || host.context.platform !== 'linux') return;

  var ROOT_ID = 'scnet-linux-window-controls';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function icon(kind) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(SVG_NS, 'path');
    if (kind === 'minimize') path.setAttribute('d', 'M4 8h8');
    else path.setAttribute('d', 'M4.5 4.5l7 7M11.5 4.5l-7 7');
    svg.appendChild(path);
    return svg;
  }

  function button(kind, label, onClick) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'scnet-linux-window-control';
    el.title = label;
    el.setAttribute('aria-label', label);
    el.appendChild(icon(kind));
    el.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    // Keep the button clickable inside the drag strip.
    el.style.webkitAppRegion = 'no-drag';
    return el;
  }

  function build() {
    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('data-scnet-linux-controls', '');
    root.style.cssText = [
      'position:fixed',
      'top:0',
      'right:0',
      'height:32px',
      'display:flex',
      'align-items:center',
      'gap:2px',
      'padding-right:4px',
      'z-index:2147483647',
      '-webkit-app-region:no-drag',
    ].join(';');

    root.appendChild(button('minimize', '最小化 / Minimize', function () {
      host.invoke('window.minimize').catch(function () {});
    }));
    root.appendChild(button('close', '关闭 / Close', function () {
      host.invoke('window.request-main-close').catch(function () {});
    }));

    var style = document.createElement('style');
    style.textContent = [
      '#' + ROOT_ID + ' .scnet-linux-window-control{',
      'width:30px;height:30px;display:flex;align-items:center;justify-content:center;',
      'border:0;padding:0;margin:0;border-radius:6px;background:transparent;',
      'color:var(--text-secondary, #5a5f66);cursor:default;',
      '-webkit-app-region:no-drag;}',
      '#' + ROOT_ID + ' .scnet-linux-window-control:hover{background:rgba(127,127,127,.16);}',
      '#' + ROOT_ID + ' .scnet-linux-window-control:active{background:rgba(127,127,127,.28);}',
    ].join('');

    var wrapper = document.createElement('div');
    wrapper.appendChild(style);
    return [wrapper, root];
  }

  var mounted = false;

  function remove() {
    var existing = document.getElementById(ROOT_ID);
    if (existing) existing.remove();
    mounted = false;
  }

  function sync() {
    if (!document.body) return;
    // The application shell provides its own cluster once it renders.
    if (document.querySelector('.window-tools')) {
      remove();
      return;
    }
    if (mounted && document.getElementById(ROOT_ID)) return;
    var parts = build();
    document.body.appendChild(parts[0]);
    document.body.appendChild(parts[1]);
    mounted = true;
  }

  function start() {
    sync();
    var observer = new MutationObserver(function () {
      sync();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', sync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
