/* Vínculo Core v1.0 — cola offline para envíos a Google Apps Script.
   No requiere cambiar el código de la app: intercepta fetch() hacia script.google.com/macros
   y guarda cada envío hasta confirmar que salió de la red. */
(function () {
  "use strict";
  if (window.__vinculoCore) return;
  var VERSION = "1.0.0";
  var KEY = "vinculo_cola_v1";
  var DIAS_MAX = 30;                         // descarta envíos con más de 30 días
  var ENDPOINT_RE = /^https:\/\/script\.google\.com\/macros\//;
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!origFetch) return;
  window.__vinculoCore = VERSION;

  /* ---------- almacenamiento (localStorage con respaldo en memoria) ---------- */
  var mem = null;
  function leer() {
    if (mem) return mem;
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
  }
  function guardar(q) {
    try { localStorage.setItem(KEY, JSON.stringify(q)); mem = null; }
    catch (e) { mem = q; }                    // modo privado o cuota llena
  }
  function id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ---------- cola y envío ---------- */
  var enviando = false, espera = 5000, timer = null;
  function agregar(url, body) {
    var q = leer();
    q.push({ id: id(), url: url, body: body, ts: Date.now() });
    guardar(q); pintar();
  }
  function limpiarViejos(q) {
    var lim = Date.now() - DIAS_MAX * 864e5;
    return q.filter(function (x) { return x.ts > lim; });
  }
  function vaciar() {
    if (enviando) return Promise.resolve();
    var q = limpiarViejos(leer());
    if (!q.length) { guardar(q); pintar(); return Promise.resolve(); }
    enviando = true; pintar();
    var paso = function () {
      var q2 = leer();
      if (!q2.length) return Promise.resolve(true);
      var it = q2[0];
      return origFetch(it.url, { method: "POST", mode: "no-cors", body: it.body })
        .then(function () {
          guardar(leer().filter(function (x) { return x.id !== it.id; }));
          pintar(); return paso();
        })
        .catch(function () { return false; });
    };
    return paso().then(function (ok) {
      enviando = false;
      if (ok) { espera = 5000; pintar(true); }
      else { espera = Math.min(espera * 2, 120000); programar(); pintar(); }
    });
  }
  function programar() { clearTimeout(timer); timer = setTimeout(vaciar, espera); }

  /* ---------- intercepta fetch ---------- */
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var metodo = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (metodo === "POST" && ENDPOINT_RE.test(url) && init && typeof init.body === "string") {
      agregar(url, init.body);
      vaciar();
      return Promise.resolve(new Response(null, { status: 204 })); // la app sigue sin esperar
    }
    return origFetch(input, init);
  };

  /* ---------- indicador visual ---------- */
  var chip = null, ocultar = null;
  function pintar(recienEnviado) {
    if (!document.body) return;
    if (!chip) {
      chip = document.createElement("div");
      chip.setAttribute("role", "status");
      chip.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom,0px));" +
        "z-index:99999;font:700 13px/1.2 Nunito,'Segoe UI',system-ui,sans-serif;padding:9px 14px;border-radius:999px;" +
        "box-shadow:0 4px 14px rgba(0,0,0,.18);display:none;max-width:90vw;text-align:center";
      document.body.appendChild(chip);
    }
    var n = leer().length, off = navigator.onLine === false;
    clearTimeout(ocultar);
    if (n > 0) {
      chip.style.display = "block";
      chip.style.background = off ? "#FFF4E5" : "#E6F4FD";
      chip.style.color = off ? "#7a4a00" : "#006B7D";
      chip.textContent = (off ? "Sin conexión · " : (enviando ? "Enviando · " : "")) +
        n + (n === 1 ? " respuesta guardada" : " respuestas guardadas") + (off ? ". Se enviarán solas." : "");
    } else if (recienEnviado) {
      chip.style.display = "block"; chip.style.background = "#E6F4FD"; chip.style.color = "#006B7D";
      chip.textContent = "✓ Todo enviado";
      ocultar = setTimeout(function () { chip.style.display = "none"; }, 3000);
    } else { chip.style.display = "none"; }
  }

  /* ---------- disparadores ---------- */
  window.addEventListener("online", function () { espera = 5000; vaciar(); });
  window.addEventListener("offline", function () { pintar(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) vaciar(); });
  setInterval(function () { if (leer().length) vaciar(); }, 30000);
  function arrancar() { pintar(); vaciar(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar); else arrancar();

  /* ---------- utilidades para soporte ---------- */
  window.Vinculo = {
    version: VERSION,
    pendientes: function () { return leer().length; },
    enviarAhora: vaciar,
    exportarPendientes: function () { return JSON.stringify(leer()); }
  };
})();
