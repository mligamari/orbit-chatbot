(function () {
  "use strict";

  var MAX_CHARS = 4000;
  var MAX_HISTORY = 20; // messages sent as context (the server trims too)
  var CLIENT_TIMEOUT_MS = 30000;

  var messagesEl = document.getElementById("messages");
  var emptyEl = document.getElementById("empty-state");
  var form = document.getElementById("composer");
  var input = document.getElementById("composer-input");
  var sendBtn = document.getElementById("send-btn");
  var countEl = document.getElementById("char-count");
  var statusEl = document.getElementById("status");
  var newChatBtn = document.getElementById("new-chat");
  var themeBtn = document.getElementById("theme-toggle");

  var history = []; // { role: "user" | "assistant", content }
  var pending = null; // AbortController for the in-flight request

  // ---------- Theme ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var dark = theme === "dark";
    themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    themeBtn.setAttribute("aria-pressed", dark ? "false" : "true");
  }
  applyTheme(document.documentElement.getAttribute("data-theme") || "dark");
  themeBtn.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem("orbit-theme", next); } catch (e) {}
  });

  // ---------- Safe, minimal Markdown ----------
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function inline(s) {
    // s is already escaped
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  }
  function renderMarkdown(text) {
    var parts = text.split(/```/);
    var html = "";
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var code = parts[i].replace(/^[\w+-]*\n/, "");
        html += "<pre><code>" + escapeHtml(code.replace(/\n$/, "")) + "</code></pre>";
        continue;
      }
      var blocks = parts[i].split(/\n{2,}/);
      for (var b = 0; b < blocks.length; b++) {
        var block = blocks[b].trim();
        if (!block) continue;
        var lines = block.split("\n");
        if (lines.every(function (l) { return /^\s*[-*•]\s+/.test(l); })) {
          html += "<ul>" + lines.map(function (l) {
            return "<li>" + inline(escapeHtml(l.replace(/^\s*[-*•]\s+/, ""))) + "</li>";
          }).join("") + "</ul>";
        } else if (lines.every(function (l) { return /^\s*\d+[.)]\s+/.test(l); })) {
          html += "<ol>" + lines.map(function (l) {
            return "<li>" + inline(escapeHtml(l.replace(/^\s*\d+[.)]\s+/, ""))) + "</li>";
          }).join("") + "</ol>";
        } else if (lines.length === 1 && /^#{1,6}\s+/.test(block)) {
          html += "<h3>" + inline(escapeHtml(block.replace(/^#{1,6}\s+/, ""))) + "</h3>";
        } else {
          html += "<p>" + lines.map(function (l) { return inline(escapeHtml(l)); }).join("<br>") + "</p>";
        }
      }
    }
    return html;
  }

  // ---------- Rendering ----------
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(kind, text) {
    if (emptyEl) emptyEl.hidden = true;
    var wrap = document.createElement("div");
    wrap.className = "msg " + (kind === "user" ? "msg-user" : "msg-bot") + (kind === "error" ? " msg-error" : "");
    var label = document.createElement("span");
    label.className = "msg-label mono";
    label.textContent = kind === "user" ? "YOU" : kind === "error" ? "ERROR" : "ORBIT";
    var body = document.createElement("div");
    body.className = "msg-body";
    if (kind === "assistant") body.innerHTML = renderMarkdown(text);
    else body.textContent = text;
    wrap.appendChild(label);
    wrap.appendChild(body);
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function addTyping() {
    if (emptyEl) emptyEl.hidden = true;
    var wrap = document.createElement("div");
    wrap.className = "msg msg-bot";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = '<span class="msg-label mono">ORBIT</span><div class="msg-body"><span class="typing"><span></span><span></span><span></span></span></div>';
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function setBusy(busy) {
    sendBtn.disabled = busy || !input.value.trim();
    input.setAttribute("aria-busy", busy ? "true" : "false");
    statusEl.textContent = busy ? "Orbit is thinking…" : "";
    Array.prototype.forEach.call(document.querySelectorAll(".chip, .retry"), function (b) { b.disabled = busy; });
  }

  // ---------- Composer ----------
  function updateComposer() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight + 2, 180) + "px";
    var n = input.value.length;
    countEl.textContent = n + " / " + MAX_CHARS;
    countEl.classList.toggle("near", n > MAX_CHARS * 0.9);
    sendBtn.disabled = !!pending || !input.value.trim();
  }
  input.addEventListener("input", updateComposer);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || pending) return;
    if (text.length > MAX_CHARS) {
      statusEl.textContent = "Messages are limited to " + MAX_CHARS + " characters.";
      return;
    }
    input.value = "";
    updateComposer();
    send(text);
  });

  document.getElementById("suggestions").addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip || pending) return;
    send(chip.textContent.trim());
  });

  newChatBtn.addEventListener("click", function () {
    if (pending) pending.abort();
    pending = null;
    history = [];
    Array.prototype.slice.call(messagesEl.querySelectorAll(".msg")).forEach(function (m) { m.remove(); });
    if (emptyEl) emptyEl.hidden = false;
    input.value = "";
    updateComposer();
    setBusy(false);
    statusEl.textContent = "Started a new chat.";
    input.focus();
  });

  // ---------- Networking ----------
  function send(text) {
    // On phones the robot sits above the chat; bring the whole chat into view.
    if (window.matchMedia("(max-width: 619.98px)").matches) {
      document.querySelector(".chat").scrollIntoView({ block: "end" });
    }
    addMessage("user", text);
    history.push({ role: "user", content: text });
    request();
  }

  function request() {
    var controller = new AbortController();
    pending = controller;
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, CLIENT_TIMEOUT_MS);
    var typing = addTyping();
    setBusy(true);

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-MAX_HISTORY) }),
      signal: controller.signal,
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data.reply) {
            throw new Error(data.error || "Something went wrong (HTTP " + res.status + ").");
          }
          return data.reply;
        });
      })
      .then(function (reply) {
        if (pending !== controller) return;
        typing.remove();
        history.push({ role: "assistant", content: reply });
        addMessage("assistant", reply);
      })
      .catch(function (err) {
        if (pending !== controller) return; // chat was reset
        typing.remove();
        var msg = timedOut
          ? "Orbit took too long to answer. Please try again."
          : err.name === "TypeError"
            ? "Couldn’t reach the server. Check your connection and try again."
            : err.message;
        showError(msg);
      })
      .finally(function () {
        clearTimeout(timer);
        if (pending === controller) {
          pending = null;
          setBusy(false);
          input.focus();
        }
      });
  }

  function showError(msg) {
    var el = addMessage("error", msg);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "retry";
    btn.textContent = "Try again";
    btn.addEventListener("click", function () {
      if (pending) return;
      el.remove();
      request(); // the user's last message is still at the end of history
    });
    el.appendChild(btn);
  }

  updateComposer();
})();
