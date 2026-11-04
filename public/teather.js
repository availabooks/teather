/*!
 * teather.js: save a student's data in their own Google Drive, through Teather.
 * https://teather.pages.dev
 *
 *   <script defer src="https://teather.pages.dev/v1/teather.js"></script>
 *   Teather.init();                          // options: {pushDelay: ms (default 1000)}
 *   Teather.set("theme", "dark");            // saved locally at once, synced shortly after
 *   Teather.get("theme");                    // -> "dark"
 *   button.onclick = () => Teather.signIn(); // must be called from a click
 *
 * Works signed out too (data stays in this browser); on first sign-in it is uploaded.
 *
 * Local format (stable for v1, so a page can read it even if this script fails to load):
 * each item is localStorage["teather:i:" + key] = JSON {value, updatedAt}; value null means deleted.
 */
(function (global) {
  "use strict";

  var script = document.currentScript;
  var DEFAULT_BASE = script && script.src ? new URL(script.src).origin : "https://teather.pages.dev";
  var BATCH = 50;
  var pushDelay = 1000;
  var FOCUS_PULL_MS = 15000;
  var SIGNIN_TIMEOUT = 5 * 60 * 1000;

  var base = DEFAULT_BASE;
  var prefix = "teather:";
  var started = false;
  var meta = { token: null, email: null, name: null, picture: null, host: null, dirty: {}, lastPull: 0 };
  var status = "signed-out";
  var listeners = { change: [], auth: [], status: [] };
  var pushTimer = null;
  var pushing = null;
  var pulling = null;
  var readyPromise = Promise.resolve();
  var mem = {};

  // ---- local storage (falls back to memory when blocked) ----
  function lsGet(k) {
    try { return global.localStorage.getItem(k); } catch (e) { return k in mem ? mem[k] : null; }
  }
  function lsSet(k, v) {
    try { global.localStorage.setItem(k, v); } catch (e) { mem[k] = v; }
  }
  function lsDel(k) {
    try { global.localStorage.removeItem(k); } catch (e) { delete mem[k]; }
  }
  function lsKeys() {
    var out = [];
    try {
      for (var i = 0; i < global.localStorage.length; i++) out.push(global.localStorage.key(i));
    } catch (e) {
      out = Object.keys(mem);
    }
    return out;
  }

  function itemKey(key) { return prefix + "i:" + key; }
  function metaKey() { return prefix + "meta"; }

  function readItem(key) {
    var raw = lsGet(itemKey(key));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function writeItem(key, item) { lsSet(itemKey(key), JSON.stringify(item)); }

  function loadMeta() {
    try {
      var m = JSON.parse(lsGet(metaKey()) || "null");
      if (m && typeof m === "object") {
        meta = {
          token: m.token || null, email: m.email || null, name: m.name || null, picture: m.picture || null,
          host: m.host || null, dirty: m.dirty || {}, lastPull: m.lastPull || 0,
        };
      }
    } catch (e) { /* keep defaults */ }
  }
  function saveMeta() { lsSet(metaKey(), JSON.stringify(meta)); }

  function localKeys() {
    var p = prefix + "i:";
    return lsKeys().filter(function (k) { return k && k.indexOf(p) === 0; }).map(function (k) { return k.slice(p.length); });
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // ---- events ----
  function on(type, fn) {
    listeners[type].push(fn);
    return function () { listeners[type] = listeners[type].filter(function (f) { return f !== fn; }); };
  }
  function emit(type, arg) {
    listeners[type].slice().forEach(function (fn) {
      try { fn(arg); } catch (e) { setTimeout(function () { throw e; }); }
    });
  }
  function setStatus(s) {
    if (s !== status) { status = s; emit("status", s); }
  }

  // ---- network ----
  function TeatherError(code, message, status) {
    var e = new Error(message || code);
    e.code = code;
    e.status = status;
    return e;
  }

  async function api(method, path, body, opts) {
    opts = opts || {};
    var headers = {};
    if (meta.token) headers.Authorization = "Bearer " + meta.token;
    var init = { method: method, headers: headers, keepalive: !!opts.keepalive };
    if (opts.raw !== undefined) {
      init.body = opts.raw;
      if (opts.contentType) headers["Content-Type"] = opts.contentType;
      if (opts.ifUnmodifiedSince) headers["If-Unmodified-Since"] = opts.ifUnmodifiedSince;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    var res;
    try {
      res = await fetch(base + path, init);
    } catch (e) {
      setStatus("offline");
      throw TeatherError("offline", "Can't reach Teather");
    }
    if (res.status === 401 && meta.token) {
      // Session ended or was disconnected from /manage: forget this browser's copy,
      // so data the student deleted is not uploaded again.
      endSession(false);
      throw TeatherError("signed_out", "Signed out of Teather", 401);
    }
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw TeatherError(err.error || "http_" + res.status, err.message || "Teather error " + res.status, res.status);
    }
    return opts.response ? res : res.json();
  }

  // ---- sync ----
  function schedulePush() {
    if (!meta.token) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { push().catch(noop); }, pushDelay);
  }

  function push(keepalive) {
    if (!meta.token) return Promise.resolve();
    if (pushing) return pushing.then(function () { return push(keepalive); });
    pushing = (async function () {
      // Never finish synchronously: with nothing to send, `finally` would clear `pushing`
      // before this assignment stores the promise, leaving it set forever, and the
      // `pushing.then(push)` above would then loop without end (tab runs out of memory).
      await null;
      try {
        var keys = Object.keys(meta.dirty);
        for (var i = 0; i < keys.length && meta.token; i += BATCH) {
          var chunk = keys.slice(i, i + BATCH);
          var items = {};
          chunk.forEach(function (k) { items[k] = readItem(k) || { value: null, updatedAt: Date.now() }; });
          setStatus("syncing");
          var res = await api("PUT", "/api/state", { items: items }, { keepalive: keepalive });
          chunk.forEach(function (k) {
            var sent = items[k];
            var local = readItem(k);
            if (local && local.updatedAt !== sent.updatedAt) return; // changed again meanwhile; stays dirty
            delete meta.dirty[k];
            var server = res.items[k];
            if (server && server.updatedAt > sent.updatedAt) applyRemote(k, server, local);
          });
          saveMeta();
        }
        if (meta.token) setStatus("synced");
      } catch (e) {
        if (meta.token && e.code !== "offline") setStatus("error");
        throw e;
      } finally {
        pushing = null;
      }
    })();
    return pushing;
  }

  function applyRemote(key, server, local) {
    writeItem(key, server);
    var before = local && local.value !== null ? local.value : undefined;
    var after = server.value !== null ? server.value : undefined;
    if (!same(before, after)) emit("change", { key: key, value: after, source: "remote" });
  }

  function pull() {
    if (!meta.token) return Promise.resolve();
    if (pulling) return pulling;
    pulling = (async function () {
      await null; // never finish synchronously, so `finally` runs after `pulling` is set (see push)
      try {
        setStatus("syncing");
        var res = await api("GET", "/api/state");
        var server = res.items || {};
        Object.keys(server).forEach(function (k) {
          var s = server[k];
          var local = readItem(k);
          if (!local || s.updatedAt > local.updatedAt) {
            delete meta.dirty[k];
            applyRemote(k, s, local);
          } else if (local.updatedAt > s.updatedAt || !same(local.value, s.value)) {
            meta.dirty[k] = 1;
          }
        });
        // Anything only in this browser (for example saved before signing in) is uploaded.
        localKeys().forEach(function (k) { if (!(k in server)) meta.dirty[k] = 1; });
        meta.lastPull = Date.now();
        saveMeta();
        await push();
        if (meta.token) setStatus("synced");
      } catch (e) {
        if (meta.token && e.code !== "offline") setStatus("error");
        throw e;
      } finally {
        pulling = null;
      }
    })();
    return pulling;
  }

  function endSession(keepLocal) {
    var hadUser = !!meta.token;
    clearTimeout(pushTimer);
    if (!keepLocal) {
      localKeys().forEach(function (k) {
        lsDel(itemKey(k));
        emit("change", { key: k, value: undefined, source: "signout" });
      });
    }
    meta = { token: null, email: null, name: null, picture: null, host: null, dirty: keepLocal ? meta.dirty : {}, lastPull: 0 };
    saveMeta();
    setStatus("signed-out");
    if (hadUser) emit("auth", null);
  }

  /** Pick up a changed Google name or photo. */
  async function refreshProfile() {
    if (!meta.token) return;
    var me = await api("GET", "/api/me");
    if (!meta.token) return;
    if (me.email !== meta.email || me.name !== meta.name || me.picture !== meta.picture) {
      meta.email = me.email;
      meta.name = me.name || null;
      meta.picture = me.picture || null;
      saveMeta();
      emit("auth", Teather.user());
    }
  }

  var COLORS = ["#2f6f5e", "#3b5b92", "#8a4f7d", "#9a5b2e", "#4d7a2f", "#2f6f8a", "#7a3e3e", "#5b4a8a"];

  /** A Google photo URL at `size` pixels, or an initial on a colored circle. */
  function pictureFor(user, size) {
    size = Math.max(16, Math.min(512, Math.round(size || 64)));
    if (!user) return null;
    if (user.picture) {
      return /=s\d+(-[a-z]+)*$/.test(user.picture)
        ? user.picture.replace(/=s\d+(-[a-z]+)*$/, "=s" + size + "-c")
        : user.picture;
    }
    var label = String(user.name || user.email || "?").trim();
    var initial = (label.match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase();
    var hash = 0;
    var key = String(user.email || label);
    for (var i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    var color = COLORS[hash % COLORS.length];
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 100 100">' +
      '<circle cx="50" cy="50" r="50" fill="' + color + '"/>' +
      '<text x="50" y="50" dy=".35em" text-anchor="middle" fill="#fff" font-family="system-ui, sans-serif" font-size="48" font-weight="600">' +
      initial.replace(/[&<>"]/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }) +
      "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function noop() {}

  function randomId() {
    var bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  // ---- public API ----
  var Teather = {
    /** Options: {base: "https://teather.pages.dev", prefix: "teather:", pushDelay: 1000} */
    init: function (opts) {
      opts = opts || {};
      if (opts.base) base = opts.base.replace(/\/$/, "");
      if (opts.prefix) prefix = opts.prefix;
      if (opts.pushDelay >= 0) pushDelay = Math.min(60000, Number(opts.pushDelay));
      if (started) return Teather;
      started = true;
      loadMeta();
      if (meta.token) {
        setStatus("syncing");
        readyPromise = pull().catch(noop);
        refreshProfile().catch(noop);
      }
      global.addEventListener("focus", function () {
        if (meta.token && Date.now() - meta.lastPull > FOCUS_PULL_MS) pull().catch(noop);
      });
      global.addEventListener("online", function () { if (meta.token) pull().catch(noop); });
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden" && Object.keys(meta.dirty).length) push(true).catch(noop);
      });
      global.addEventListener("storage", function (e) {
        if (!e.key || e.key.indexOf(prefix) !== 0) return;
        if (e.key === metaKey()) {
          var wasSignedIn = !!meta.token;
          loadMeta();
          if (wasSignedIn !== !!meta.token) {
            setStatus(meta.token ? "synced" : "signed-out");
            emit("auth", Teather.user());
          }
          return;
        }
        var k = e.key.slice((prefix + "i:").length);
        var item = readItem(k);
        emit("change", { key: k, value: item && item.value !== null ? item.value : undefined, source: "other-tab" });
      });
      return Teather;
    },

    /** Resolves after the first sync on page load (immediately when signed out). */
    ready: function () { ensure(); return readyPromise; },

    get: function (key, fallback) {
      ensure();
      var item = readItem(key);
      return item && item.value !== null && item.value !== undefined ? item.value : fallback;
    },

    set: function (key, value) {
      ensure();
      if (value === undefined) value = null;
      var prev = readItem(key);
      writeItem(key, { value: value, updatedAt: Math.max(Date.now(), prev ? prev.updatedAt + 1 : 0) });
      if (meta.token) { meta.dirty[key] = 1; saveMeta(); schedulePush(); }
      emit("change", { key: key, value: value === null ? undefined : value, source: "local" });
    },

    remove: function (key) { Teather.set(key, null); },

    keys: function () {
      ensure();
      return localKeys().filter(function (k) { var it = readItem(k); return it && it.value !== null; });
    },

    all: function () {
      var out = {};
      Teather.keys().forEach(function (k) { out[k] = Teather.get(k); });
      return out;
    },

    /** fn({key, value, source}); source is "local", "remote", "other-tab" or "signout". Returns an unsubscribe function. */
    onChange: function (fn) { return on("change", fn); },
    /** fn(user or null) */
    onAuthChange: function (fn) { return on("auth", fn); },
    /** fn(status): "signed-out" | "syncing" | "synced" | "offline" | "error" */
    onStatus: function (fn) { return on("status", fn); },
    status: function () { return status; },

    isSignedIn: function () { ensure(); return !!meta.token; },
    /** {email, name, picture, host} or null. `picture` is a Google photo URL, or null if there isn't one. */
    user: function () {
      ensure();
      return meta.token ? { email: meta.email, name: meta.name, picture: meta.picture, host: meta.host } : null;
    },

    /**
     * An image URL for the signed-in student, for an <img>: their Google photo at `size`
     * pixels (default 64), or their initial on a colored circle. Null when signed out.
     * Pass a user object as the second argument to draw someone else.
     */
    pictureUrl: function (size, user) {
      if (user === undefined) { ensure(); user = Teather.user(); }
      return pictureFor(user, size);
    },

    /** Push and pull now. */
    sync: function () { ensure(); return pull(); },

    /**
     * Open Google sign-in in a popup. Call it directly from a click handler, or the
     * browser may block the popup. Resolves with the user once data has synced.
     */
    signIn: function () {
      ensure();
      var poll = randomId();
      var url = base + "/auth/start?origin=" + encodeURIComponent(location.origin) + "&poll=" + poll;
      var popup = global.open(url, "teather-signin", "width=520,height=680");
      if (!popup) return Promise.reject(TeatherError("popup_blocked", "The sign-in window was blocked. Please allow pop-ups for this site."));
      return new Promise(function (resolve, reject) {
        var done = false;
        var started = Date.now();
        var timer = null;
        function finish(payload) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          global.removeEventListener("message", onMessage);
          if (payload.error) return reject(TeatherError(payload.error, payload.message));
          meta.token = payload.token;
          meta.email = payload.email;
          meta.name = payload.name || null;
          meta.picture = payload.picture || null;
          meta.host = payload.host;
          saveMeta();
          setStatus("syncing");
          emit("auth", Teather.user());
          pull().catch(noop).then(function () { resolve(Teather.user()); });
        }
        function onMessage(e) {
          if (e.origin === base && e.data && e.data.type === "teather-auth") finish(e.data);
        }
        // Google's pages often cut the popup's link back to this page, so also collect the result from Teather.
        async function check() {
          if (done) return;
          if (Date.now() - started > SIGNIN_TIMEOUT) return finish({ error: "timeout", message: "Sign-in took too long. Please try again." });
          try {
            var r = await fetch(base + "/api/auth/result", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ poll: poll }),
            });
            var body = await r.json();
            if (r.ok && !body.pending) return finish(body);
          } catch (e) { /* try again */ }
          timer = setTimeout(check, 1500);
        }
        global.addEventListener("message", onMessage);
        timer = setTimeout(check, 2000);
      });
    },

    /** Sign out of Teather on this site. Clears this browser's copy unless {keepLocal: true}. */
    signOut: async function (opts) {
      ensure();
      opts = opts || {};
      if (meta.token) await push().catch(noop);
      if (meta.token) await api("POST", "/api/auth/signout").catch(noop);
      endSession(!!opts.keepLocal);
    },

    /** Other files in this site's folder (for example encrypted work). Signed-in only. */
    files: {
      list: async function () { requireSignIn(); return (await api("GET", "/api/files")).files; },
      /** Resolves to a Blob. */
      get: async function (name) {
        requireSignIn();
        var res = await api("GET", "/api/files/" + encodeURIComponent(name), undefined, { response: true });
        return res.blob();
      },
      /** data: Blob, ArrayBuffer, typed array or string. opts: {contentType, ifUnmodifiedSince} */
      put: async function (name, data, opts) {
        requireSignIn();
        opts = opts || {};
        var type = opts.contentType || (data && data.type) || (typeof data === "string" ? "text/plain" : "application/octet-stream");
        return (await api("PUT", "/api/files/" + encodeURIComponent(name), undefined, {
          raw: data, contentType: type, ifUnmodifiedSince: opts.ifUnmodifiedSince,
        })).file;
      },
      remove: async function (name) { requireSignIn(); await api("DELETE", "/api/files/" + encodeURIComponent(name)); },
    },
  };

  function ensure() { if (!started) Teather.init(); }
  function requireSignIn() {
    ensure();
    if (!meta.token) throw TeatherError("signed_out", "Sign in to Teather first");
  }

  global.Teather = Teather;
})(typeof window !== "undefined" ? window : this);
