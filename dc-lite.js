/*!
 * dc-lite — a tiny runtime that runs the *.dc.html page files in a normal browser.
 *
 * The page files (*.dc.html) are written in the Claude Design "Design Component" format:
 *   - {{path}}                      dotted lookups into the values returned by renderVals()
 *   - <sc-if value="{{flag}}">      conditional block
 *   - <sc-for list="{{items}}" as="item">   repeated block
 *   - onClick="{{handler}}"         event handlers returned from renderVals()
 *   - <script type="text/x-dc">     `class Component extends DCLogic` with state + renderVals()
 *
 * This file implements just that subset (no dependencies), so the exact same page
 * files that live on the design canvas also run as a static website (GitHub Pages).
 * Links such as <a href="App.dc.html"> switch pages without a reload.
 */
(function () {
  'use strict';

  var XHTML = 'http://www.w3.org/1999/xhtml';
  var WHOLE = /^\{\{\s*([^{}]*?)\s*\}\}$/;
  var HOLE = /\{\{\s*([^{}]*?)\s*\}\}/g;

  var PAGES = {
    Landing: 'Landing.dc.html',
    App: 'App.dc.html',
    Main: 'Main.dc.html'
  };

  /* ---------- values and templates ---------- */

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.');
    var cur = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function interpolate(str, scope) {
    return str.replace(HOLE, function (_, p) {
      var v = lookup(p, scope);
      return v == null || v === false ? '' : String(v);
    });
  }

  function evalAttr(val, scope) {
    if (val == null) return undefined;
    var m = WHOLE.exec(val);
    return m ? lookup(m[1], scope) : val;
  }

  function attachListener(el, ev) {
    el.__l[ev] = true;
    el.addEventListener(ev, function (e) {
      var f = el.__h[ev];
      if (f) f(e);
    });
  }

  function buildChildren(node, scope) {
    var out = [];
    for (var c = node.firstChild; c; c = c.nextSibling) {
      var built = build(c, scope);
      for (var i = 0; i < built.length; i++) out.push(built[i]);
    }
    return out;
  }

  function build(node, scope) {
    if (node.nodeType === 3) return [document.createTextNode(interpolate(node.nodeValue, scope))];
    if (node.nodeType !== 1) return [];

    var tag = node.localName;
    if (tag === 'helmet') return [];

    if (tag === 'sc-if') {
      return evalAttr(node.getAttribute('value'), scope) ? buildChildren(node, scope) : [];
    }

    if (tag === 'sc-for') {
      var list = evalAttr(node.getAttribute('list'), scope) || [];
      var as = node.getAttribute('as') || 'item';
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var inner = Object.create(scope);
        inner[as] = list[i];
        inner.$index = i;
        var kids = buildChildren(node, inner);
        for (var k = 0; k < kids.length; k++) out.push(kids[k]);
      }
      return out;
    }

    var ns = node.namespaceURI;
    var el = ns && ns !== XHTML ? document.createElementNS(ns, tag) : document.createElement(tag);
    el.__h = {};
    el.__l = {};

    for (var a = 0; a < node.attributes.length; a++) {
      var name = node.attributes[a].name;
      var val = node.attributes[a].value;
      if (name.indexOf('hint-') === 0) continue;
      var m = WHOLE.exec(val);

      if (/^on[a-z]+$/.test(name)) {
        if (m) {
          var fn = lookup(m[1], scope);
          if (typeof fn === 'function') {
            el.__h[name.slice(2)] = fn;
            attachListener(el, name.slice(2));
          }
        }
        continue;
      }

      var v;
      if (m) {
        v = lookup(m[1], scope);
        if (v === true) v = name.indexOf('aria-') === 0 ? 'true' : '';
        else if (v === false) { if (name.indexOf('aria-') === 0) v = 'false'; else continue; }
        else if (v == null) continue;
      } else {
        v = interpolate(val, scope);
      }
      el.setAttribute(name, String(v));
    }

    var children = buildChildren(node, scope);
    for (var j = 0; j < children.length; j++) el.appendChild(children[j]);
    return [el];
  }

  /* ---------- patch the live DOM instead of replacing it (keeps focus and scroll) ---------- */

  function patch(o, n) {
    if (o.nodeType === 3) {
      if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
      return;
    }
    var i;
    for (i = o.attributes.length - 1; i >= 0; i--) {
      var an = o.attributes[i].name;
      if (!n.hasAttribute(an)) o.removeAttribute(an);
    }
    for (i = 0; i < n.attributes.length; i++) {
      var at = n.attributes[i];
      if (o.getAttribute(at.name) !== at.value) o.setAttribute(at.name, at.value);
    }
    o.__h = n.__h;
    for (var ev in n.__h) if (!o.__l[ev]) attachListener(o, ev);
    if (o.tagName === 'INPUT' && o !== document.activeElement && o.value !== n.value) o.value = n.value;
    morph(o, Array.prototype.slice.call(n.childNodes));
  }

  function morph(parent, nodes) {
    var old = parent.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var o = old[i];
      if (!o) parent.appendChild(n);
      else if (o.nodeType === n.nodeType && o.nodeName === n.nodeName) patch(o, n);
      else parent.replaceChild(n, o);
    }
    while (old.length > nodes.length) parent.removeChild(parent.lastChild);
  }

  /* ---------- component base class ---------- */

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
    this.__render = null;
  }
  DCLogic.prototype.setState = function (patchOrFn) {
    var next = typeof patchOrFn === 'function' ? patchOrFn(this.state, this.props) : patchOrFn;
    this.state = Object.assign({}, this.state, next);
    this.forceUpdate();
  };
  DCLogic.prototype.forceUpdate = function () {
    if (this.__render) this.__render();
  };
  DCLogic.prototype.renderVals = function () {
    return {};
  };
  window.DCLogic = DCLogic;

  /* ---------- page loading ---------- */

  var root = document.getElementById('root');
  var pageStyleNodes = [];

  function applyHelmet(helmet) {
    pageStyleNodes.forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); });
    pageStyleNodes = [];
    if (!helmet) return;
    Array.prototype.slice.call(helmet.children).forEach(function (child) {
      if (child.localName === 'link') {
        var href = child.getAttribute('href');
        if (document.querySelector('link[href="' + href + '"]')) return;
        var link = document.createElement('link');
        link.rel = child.getAttribute('rel') || 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
      } else if (child.localName === 'style') {
        var style = document.createElement('style');
        style.textContent = child.textContent;
        document.head.appendChild(style);
        pageStyleNodes.push(style);
      }
    });
  }

  function loadPage(name) {
    return fetch(PAGES[name])
      .then(function (res) {
        if (!res.ok) throw new Error('Could not load ' + PAGES[name] + ' (' + res.status + ')');
        return res.text();
      })
      .then(function (text) {
        var doc = new DOMParser().parseFromString(text, 'text/html');
        var tpl = doc.querySelector('x-dc');
        var scriptEl = doc.querySelector('script[type="text/x-dc"]');
        if (!tpl || !scriptEl) throw new Error(PAGES[name] + ' is not a valid .dc.html page');

        var preview = { width: 1280 };
        try {
          var props = JSON.parse(scriptEl.getAttribute('data-props') || '{}');
          if (props.$preview) preview = props.$preview;
        } catch (e) { /* ignore bad data-props */ }

        var Component = new Function('DCLogic', scriptEl.textContent + '\nreturn Component;')(DCLogic);
        applyHelmet(tpl.querySelector('helmet'));

        document.title = (doc.title || 'Thala');
        document.body.classList.toggle('phone', preview.width <= 500);

        var inst = new Component({});
        inst.__render = function () {
          morph(root, buildChildren(tpl, inst.renderVals()));
        };
        root.textContent = '';
        inst.__render();
      });
  }

  function currentPage() {
    var p = new URLSearchParams(location.search).get('page');
    return PAGES[p] ? p : 'Landing';
  }

  function show(name) {
    loadPage(name).catch(function (err) {
      root.textContent = '';
      var box = document.createElement('pre');
      box.style.cssText = 'padding:24px;white-space:pre-wrap;color:#9B2C22';
      box.textContent = String(err && err.message ? err.message : err) +
        '\n\nOpen this site through a web server (for example: python3 -m http.server), not file://';
      root.appendChild(box);
    });
  }

  function navigate(name) {
    history.pushState({}, '', '?page=' + name);
    window.scrollTo(0, 0);
    show(name);
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var m = /^(?:\.\/)?([A-Za-z0-9_-]+)\.dc\.html$/.exec(a.getAttribute('href'));
    if (m && PAGES[m[1]]) {
      e.preventDefault();
      navigate(m[1]);
    }
  });

  window.addEventListener('popstate', function () { show(currentPage()); });

  show(currentPage());
})();
