const scrollTopButton = document.querySelector(".scroll-top-button");
function updateScrollTopButton() {
  scrollTopButton.hidden = window.scrollY <= 0;
}
window.addEventListener("scroll", updateScrollTopButton, { passive: true });
scrollTopButton.addEventListener("click", () => {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  window.scrollTo({ top: 0, behavior });
  updateScrollTopButton();
});
updateScrollTopButton();
