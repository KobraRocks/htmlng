// Arrow-key deck navigation. A body-end page script (issue 13), so the DOM is
// already parsed and document.body is available — no DOMContentLoaded needed.
(function () {
  var page = document.body.getAttribute('data-page') || '';
  var current = parseInt(page.replace('slide-', ''), 10);
  if (!current) return;

  var meta = document.querySelector('meta[name="deck-total"]');
  var total = meta ? parseInt(meta.getAttribute('content'), 10) : 0;
  if (!total) return;

  document.addEventListener('keydown', function (event) {
    var step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    var next = current + step;
    if (next < 1 || next > total) return;
    location.href = 'slide-' + next + '.html';
  });
})();
