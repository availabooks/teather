(function () {
  "use strict";
  var TOKEN_KEY = "teather-manage";
  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  // Host whose details are showing. A site can link straight to its own data
  // with /manage?site=<host>; that card opens and scrolls into view once.
  var openSite = null;
  var scrollTo = null;
  try { openSite = scrollTo = new URLSearchParams(location.search).get("site") || null; } catch (e) {}

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; });
  }
  function fmtTime(ms) { return ms ? new Date(ms).toLocaleString() : "—"; }
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  async function api(method, path, body) {
    var opts = { method: method, headers: { Authorization: "Bearer " + token } };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    var res = await fetch(path, opts);
    if (res.status === 401) { setToken(null); render(); throw new Error("Please sign in again."); }
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.message || "Error " + res.status);
    }
    return res;
  }
  async function apiJson(method, path, body) { return (await api(method, path, body)).json(); }

  function setToken(t) {
    token = t;
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // ---- sign in (same popup flow as teather.js) ----
  function signIn() {
    var poll = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(24)), function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
    var popup = window.open("/auth/start?origin=" + encodeURIComponent(location.origin) + "&poll=" + poll, "teather-signin", "width=520,height=680");
    if (!popup) return showSignInError("The sign-in window was blocked. Please allow pop-ups for this page.");
    var done = false;
    var started = Date.now();
    function finish(p) {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      if (p.error) return showSignInError(p.message || "Sign-in didn't finish.");
      setToken(p.token);
      render();
    }
    function onMessage(e) {
      if (e.origin === location.origin && e.data && e.data.type === "teather-auth") finish(e.data);
    }
    async function check() {
      if (done) return;
      if (Date.now() - started > 5 * 60 * 1000) return finish({ error: "timeout", message: "Sign-in took too long. Please try again." });
      try {
        var r = await fetch("/api/auth/result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ poll: poll }) });
        var b = await r.json();
        if (r.ok && !b.pending) return finish(b);
      } catch (e) {}
      setTimeout(check, 1500);
    }
    window.addEventListener("message", onMessage);
    setTimeout(check, 2000);
  }
  function showSignInError(msg) {
    $("signin-error").textContent = msg;
    $("signin-error").classList.remove("hidden");
  }

  // ---- views ----
  async function render() {
    var signedIn = !!token;
    $("signed-out").classList.toggle("hidden", signedIn);
    $("signed-in").classList.toggle("hidden", !signedIn);
    $("who").classList.toggle("hidden", !signedIn);
    if (!signedIn) return;
    $("signin-error").classList.add("hidden");
    try {
      var data = await apiJson("GET", "/api/sites");
      $("email").textContent = data.name ? data.name + " · " + data.email : data.email;
      $("avatar").src = data.picture ? data.picture.replace(/=s\d+(-[a-z]+)*$/, "=s64-c") : "/logo.svg";
      $("avatar").referrerPolicy = "no-referrer";
      renderSites(data.sites);
    } catch (e) {
      $("sites").innerHTML = '<p class="warn">' + esc(e.message) + "</p>";
    }
  }

  function renderSites(sites) {
    if (!sites.length) {
      $("sites").innerHTML = '<div class="card"><p class="muted" style="margin:0">No sites have saved anything yet.</p></div>';
      return;
    }
    $("sites").innerHTML = sites.map(function (s) {
      var warnings = s.warnings.map(function (w) { return '<p class="warn">' + esc(w) + "</p>"; }).join("");
      return '<div class="card" data-host="' + esc(s.host) + '">' +
        "<h3>" + esc(s.name) + "</h3>" +
        '<p class="muted small">' + esc(s.description) + (s.url ? ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + "</a>" : "") + "</p>" +
        warnings + (warnings ? '<p><button class="link" data-act="dismiss">Dismiss warnings</button></p>' : "") +
        (s.serverAccess
          ? '<p class="small">' + esc(s.name) + "'s server can read and write this folder while you are away. " +
            '<button class="link" data-act="revoke-server">Take back server access</button></p>'
          : "") +
        '<div class="row">' +
        (s.known ? '<button data-act="view">View data</button><button data-act="download">Download all</button>' : "") +
        '<a class="button" href="' + esc(s.folderUrl) + '" target="_blank" rel="noopener">Open in Drive</a>' +
        '<button class="danger" data-act="delete">Delete &amp; disconnect</button>' +
        "</div>" +
        '<div class="detail"></div>' +
        "</div>";
    }).join("");
    if (openSite) {
      var card = document.querySelector('.card[data-host="' + CSS.escape(openSite) + '"]');
      if (card) {
        showDetail(card, openSite);
        if (scrollTo === openSite) { card.scrollIntoView({ block: "start" }); scrollTo = null; }
      }
    }
  }

  async function showDetail(card, host) {
    openSite = host;
    var box = card.querySelector(".detail");
    box.innerHTML = '<p class="muted small">Loading…</p>';
    try {
      var d = await apiJson("GET", "/api/sites/" + encodeURIComponent(host));
      var keys = Object.keys(d.items).filter(function (k) { return d.items[k].value !== null; }).sort();
      var rows = keys.map(function (k) {
        var it = d.items[k];
        var text = JSON.stringify(it.value);
        return "<tr><td><code>" + esc(k) + '</code><div class="preview">' + esc(text.length > 120 ? text.slice(0, 120) + "…" : text) + "</div></td>" +
          '<td class="small">' + esc(fmtTime(it.updatedAt)) + "<br>" + fmtSize(new Blob([text]).size) + "</td>" +
          '<td class="actions"><button data-act="edit" data-key="' + esc(k) + '">Edit</button> <button class="danger" data-act="del-key" data-key="' + esc(k) + '">Delete</button></td></tr>';
      }).join("");
      var files = d.files.map(function (f) {
        return "<tr><td><code>" + esc(f.name) + "</code></td><td class=\"small\">" + esc(fmtTime(Date.parse(f.modifiedTime))) + "<br>" + fmtSize(f.size) + "</td>" +
          '<td class="actions"><button data-act="get-file" data-name="' + esc(f.name) + '">Download</button> <button class="danger" data-act="del-file" data-name="' + esc(f.name) + '">Delete</button></td></tr>';
      }).join("");
      box._items = d.items;
      box.innerHTML =
        '<h3 style="margin-top:16px">Saved items</h3>' +
        (rows ? '<div class="table-wrap"><table><thead><tr><th>Item</th><th>Updated</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : '<p class="muted small">None.</p>') +
        '<h3 style="margin-top:16px">Files</h3>' +
        (files ? '<div class="table-wrap"><table><thead><tr><th>File</th><th>Updated</th><th></th></tr></thead><tbody>' + files + "</tbody></table></div>" : '<p class="muted small">None.</p>') +
        '<p style="margin-top:12px"><button class="link" data-act="hide">Hide</button></p>';
    } catch (e) {
      box.innerHTML = '<p class="warn">' + esc(e.message) + "</p>";
    }
  }

  async function download(host) {
    var d = await apiJson("GET", "/api/sites/" + encodeURIComponent(host));
    var out = { site: host, exportedAt: new Date().toISOString(), items: {} };
    Object.keys(d.items).forEach(function (k) { if (d.items[k].value !== null) out.items[k] = d.items[k]; });
    out.files = d.files;
    saveBlob(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), host + "-teather.json");
  }

  function saveBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---- editing ----
  var editing = null;
  function openEditor(host, key, item) {
    editing = { host: host, key: key };
    $("edit-title").textContent = key;
    $("edit-value").value = JSON.stringify(item.value, null, 2);
    $("edit-error").classList.add("hidden");
    $("edit").showModal();
  }
  $("edit-cancel").onclick = function () { $("edit").close(); };
  $("edit-save").onclick = async function () {
    var value;
    try { value = JSON.parse($("edit-value").value); } catch (e) {
      $("edit-error").textContent = "That isn't valid JSON: " + e.message;
      $("edit-error").classList.remove("hidden");
      return;
    }
    try {
      var items = {};
      items[editing.key] = { value: value, updatedAt: Date.now() };
      await apiJson("PUT", "/api/sites/" + encodeURIComponent(editing.host), { items: items });
      $("edit").close();
      render();
    } catch (e) {
      $("edit-error").textContent = e.message;
      $("edit-error").classList.remove("hidden");
    }
  };

  // ---- clicks ----
  $("sites").addEventListener("click", async function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var card = btn.closest(".card");
    var host = card.getAttribute("data-host");
    var act = btn.getAttribute("data-act");
    var name = card.querySelector("h3").textContent;
    try {
      btn.disabled = true;
      if (act === "view") await showDetail(card, host);
      else if (act === "hide") { openSite = null; card.querySelector(".detail").innerHTML = ""; }
      else if (act === "download") await download(host);
      else if (act === "revoke-server") {
        if (!confirm(name + "'s server will no longer be able to read or write this folder. Your files stay where they are.")) return;
        await api("DELETE", "/api/sites/" + encodeURIComponent(host) + "/server-access");
        render();
      }
      else if (act === "dismiss") { await api("DELETE", "/api/sites/" + encodeURIComponent(host) + "/warnings"); render(); }
      else if (act === "delete") {
        if (!confirm("Delete everything " + name + " saved, and sign out of " + name + " on every device?\n\nThe folder goes to your Google Drive trash, where you can recover it for 30 days.")) return;
        await api("DELETE", "/api/sites/" + encodeURIComponent(host));
        if (openSite === host) openSite = null;
        render();
      } else if (act === "edit") {
        var items = card.querySelector(".detail")._items;
        openEditor(host, btn.getAttribute("data-key"), items[btn.getAttribute("data-key")]);
      } else if (act === "del-key") {
        var key = btn.getAttribute("data-key");
        if (!confirm('Delete "' + key + '" from ' + name + "?")) return;
        var del = {};
        del[key] = { value: null, updatedAt: Date.now() };
        await apiJson("PUT", "/api/sites/" + encodeURIComponent(host), { items: del });
        await showDetail(card, host);
      } else if (act === "get-file") {
        var fname = btn.getAttribute("data-name");
        var res = await api("GET", "/api/sites/" + encodeURIComponent(host) + "/files/" + encodeURIComponent(fname));
        saveBlob(await res.blob(), fname);
      } else if (act === "del-file") {
        var fn = btn.getAttribute("data-name");
        if (!confirm('Delete the file "' + fn + '"? It goes to your Google Drive trash.')) return;
        await api("DELETE", "/api/sites/" + encodeURIComponent(host) + "/files/" + encodeURIComponent(fn));
        await showDetail(card, host);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("signin").onclick = signIn;
  $("signout").onclick = async function () {
    await fetch("/api/auth/signout", { method: "POST", headers: { Authorization: "Bearer " + token } }).catch(function () {});
    setToken(null);
    render();
  };
  $("disconnect").onclick = async function () {
    if (!confirm("Sign out of every connected site on every device, and remove Teather's access to your Google Drive?\n\nYour files stay in Drive.")) return;
    try {
      await api("POST", "/api/disconnect");
    } catch (e) {
      return alert(e.message);
    }
    setToken(null);
    render();
  };

  render();
})();
