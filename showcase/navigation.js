(() => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#site-nav');
  if (!toggle || !nav) return;
  document.documentElement.classList.add('nav-ready');
  const close = () => { toggle.setAttribute('aria-expanded', 'false'); nav.classList.remove('is-open'); };
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open)); nav.classList.toggle('is-open', open);
  });
  document.addEventListener('keydown', event => { if(event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {close();toggle.focus();} });
  document.addEventListener('click', event => {if (!event.target.closest('header')) close();});
  nav.addEventListener('click', event => {if(event.target.closest('a')) close();});
  window.addEventListener('pageshow',close);
})();
