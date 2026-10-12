// Shared on every page: the footer year, and the phone menu (the section links fold under a button below 900px).
(function () {
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  var nav = document.querySelector('.nav');
  var btn = nav && nav.querySelector('.nav__menu');
  if (!btn) return;
  function set(open) {
    nav.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
  }
  btn.addEventListener('click', function () { set(!nav.classList.contains('is-open')); });
  nav.querySelectorAll('.nav__links a').forEach(function (a) { a.addEventListener('click', function () { set(false); }); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { set(false); btn.focus(); }
  });
  document.addEventListener('click', function (e) { if (!nav.contains(e.target)) set(false); });
})();
