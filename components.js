const toast = document.querySelector('#componentToast');
let toastTimer;

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1800);
}

document.querySelectorAll('.toast-trigger').forEach((button) => {
  button.addEventListener('click', () => showToast(button.dataset.toast));
});

document.querySelectorAll('.swatch').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      showToast(`已复制色值 ${button.dataset.copy}`);
    } catch {
      showToast(`色值 ${button.dataset.copy}`);
    }
  });
});

document.querySelectorAll('.diamond-nav button, .bottom-nav button').forEach((button) => {
  button.addEventListener('click', () => {
    [...button.parentElement.children].forEach((item) => item.classList.remove('is-active'));
    button.classList.add('is-active');
  });
});
